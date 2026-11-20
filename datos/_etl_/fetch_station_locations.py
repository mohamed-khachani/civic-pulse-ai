"""Fetch verified Madrid Open Data station location CSVs/API.

This script accesses the public Madrid open-data portal *only when explicitly run*.
It writes standardized station_id/sensor_id,lat,lon CSVs and updates paths.json.
No guessed coordinates. Requires network access on your computer/server.

Run: python fetch_station_locations.py --config paths.json
"""
from __future__ import annotations
import argparse
import csv
import io
import json
import ssl
import re
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from common import read_config, point_of, normalized, write_csv

USER_AGENT = 'HabitatAI-MadridCensusETL/1.0 (public open-data integration)'
# October 2026 locations match the supplied October traffic readings.
TRAFFIC_RESOURCE = '202468-309-intensidad-trafico'
TRAFFIC_CSV = f'https://datos.madrid.es/dataset/202468-0-intensidad-trafico/resource/{TRAFFIC_RESOURCE}/download/{TRAFFIC_RESOURCE}.csv'
AIR_CSV = 'https://datos.madrid.es/dataset/212629-0-estaciones-control-aire/resource/212629-0-estaciones-control-aire-csv/download/212629-0-estaciones-control-aire-csv.csv'
NOISE_CSV = 'https://datos.madrid.es/dataset/211346-0-estaciones-acusticas/resource/211346-4-estaciones-acusticas-csv/download/211346-4-estaciones-acusticas-csv.csv'


def get(url: str) -> bytes:
    req = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': '*/*'})
    system_ca = Path('/etc/ssl/cert.pem')
    context = ssl.create_default_context(cafile=str(system_ca)) if system_ca.exists() else ssl.create_default_context()
    with urlopen(req, timeout=30, context=context) as response:
        return response.read()


def download_traffic() -> list[dict]:
    rows = parse_csv(get(TRAFFIC_CSV))
    print(f'[FETCH] Official traffic sensor locations: {len(rows)} source records')
    return rows


def parse_csv(data: bytes) -> list[dict]:
    for encoding in ('utf-8-sig', 'cp1252'):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            pass
    else:
        text = data.decode('utf-8', errors='replace')
    first = text.splitlines()[0]
    delimiter = ';' if first.count(';') > first.count(',') else ','
    return list(csv.DictReader(io.StringIO(text), delimiter=delimiter))


def download_air():
    try:
        return parse_csv(get(AIR_CSV)), AIR_CSV
    except Exception as exc:
        print(f'[FETCH] Municipal air download unavailable ({type(exc).__name__}); trying official EEA station metadata')
    endpoint = 'https://air.discomap.eea.europa.eu/arcgis/rest/services/AirQuality/AirQualityDownloadServiceEUMonitoringStations/MapServer/0/query'
    url = endpoint + '?' + urlencode({
        'where': "CountryCode='ES'", 'geometry': '-3.9,40.30,-3.5,40.65',
        'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
        'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'outSR': 4326, 'f': 'json',
    })
    features = json.loads(get(url)).get('features', [])
    rows = []
    for feature in features:
        # National station ID comes from the EEA sampling-point link, never from name matching.
        codes = set(re.findall(r'SP_(28079\d{3})_', feature['attributes'].get('PopupInfo', '')))
        if len(codes) != 1:
            continue
        point = feature['geometry']
        rows.append({'station_id': next(iter(codes))[-3:].lstrip('0'),
                     'lat': point['y'], 'lon': point['x']})
    if not rows:
        raise ValueError('EEA metadata contains no verified Madrid municipal station IDs')
    return rows, url


def standardize(rows, kind: str):
    result = []
    dedup = set()
    for row in rows:
        folded = {normalized(k): str(v or '').strip() for k, v in row.items() if k}
        if kind == 'traffic':
            code = folded.get('id') or folded.get('sensor_id')
        elif kind == 'air':
            code = folded.get('codigo_corto') or folded.get('station_id') or folded.get('estacion')
        else:
            code = (folded.get('estacion') or folded.get('numero') or
                    folded.get('codigo') or folded.get('id') or folded.get('station_id'))
        point = point_of(row)
        if not code or point is None:
            continue
        code = code.lstrip('0') or '0'
        if code in dedup:
            continue
        dedup.add(code)
        result.append({'sensor_id' if kind == 'traffic' else 'station_id': code,
                       'lat': point.y, 'lon': point.x})
    if not result:
        raise ValueError(f'Official {kind} response has no usable locations; check its CSV schema')
    return result


def run(config_file, kinds):
    cfg = read_config(config_file)
    out = Path(cfg['_base']) / 'reference_data'
    out.mkdir(exist_ok=True, parents=True)
    paths = {
        'traffic': ('traffic_sensor_locations', 'traffic_stations.csv',
                    lambda: download_traffic()),
        'air': ('air_station_locations', 'air_stations.csv', download_air),
        'noise': ('noise_station_locations', 'noise_stations.csv',
                  lambda: parse_csv(get(NOISE_CSV))),
    }
    succeeded = []
    for kind in kinds:
        key, filename, loader = paths[kind]
        try:
            downloaded = loader()
            rows, source_url = downloaded if isinstance(downloaded, tuple) else (downloaded, TRAFFIC_CSV if kind == 'traffic' else NOISE_CSV)
            data = standardize(rows, kind)
            result = out / filename
            id_col = 'sensor_id' if kind == 'traffic' else 'station_id'
            write_csv(result, data, [id_col, 'lat', 'lon'])
            (out / (filename + '.source.json')).write_text(json.dumps({
                'source_url': source_url, 'records': len(data),
                'notes': 'Official station metadata. EEA fallback retains original national sampling-point IDs. Station locations can change over time; historical exposure is not reconstructed.',
            }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            # Store a relative path, so relocating the whole project still works.
            cfg['files'][key] = f'reference_data/{filename}'
            succeeded.append(kind)
            print(f'[FETCH] {kind}: {len(data)} located stations, saved to {result}')
        except Exception as exc:
            print(f'[FETCH] {kind}: failed ({type(exc).__name__}: {exc}); config unchanged')
    # Do not persist injected _file / _base private config keys.
    original = Path(config_file).expanduser().resolve()
    edited = {k: v for k, v in cfg.items() if not k.startswith('_')}
    original.write_text(json.dumps(edited, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Successfully fetched:', ', '.join(succeeded) or 'none')
    return succeeded


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--config', default=str(Path(__file__).with_name('paths.json')))
    p.add_argument('--kinds', nargs='+', choices=['traffic', 'air', 'noise'],
                   default=['traffic', 'air', 'noise'])
    args = p.parse_args()
    run(args.config, args.kinds)
