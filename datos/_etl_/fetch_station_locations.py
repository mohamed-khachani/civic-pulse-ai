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
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from common import read_config, point_of, normalized, write_csv

USER_AGENT = 'HabitatAI-MadridCensusETL/1.0 (public open-data integration)'
# Official Madrid city public datasets; Sept 2026 traffic sensor location snapshot.
TRAFFIC_RESOURCE = '202468-306-intensidad-trafico'
TRAFFIC_API = 'https://datos.madrid.es/api/3/action/datastore_search'
AIR_CSV = 'https://datos.madrid.es/dataset/212629-0-estaciones-control-aire/resource/212629-0-estaciones-control-aire-csv/download/212629-0-estaciones-control-aire-csv.csv'
NOISE_CSV = 'https://datos.madrid.es/dataset/211346-0-estaciones-acusticas/resource/211346-4-estaciones-acusticas-csv/download/211346-4-estaciones-acusticas-csv.csv'


def get(url: str) -> bytes:
    req = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': '*/*'})
    with urlopen(req, timeout=60) as response:
        return response.read()


def download_traffic() -> list[dict]:
    rows = []
    offset = 0
    while True:
        url = TRAFFIC_API + '?' + urlencode({'resource_id': TRAFFIC_RESOURCE,
                                             'limit': 1000, 'offset': offset})
        data = json.loads(get(url))
        if not data.get('success'):
            raise RuntimeError('Traffic station metadata API returned success=false')
        result = data['result']
        page = result['records']
        rows.extend(page)
        offset += len(page)
        if offset >= result['total'] or not page:
            break
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


def standardize(rows, kind: str):
    result = []
    dedup = set()
    for row in rows:
        folded = {normalized(k): str(v or '').strip() for k, v in row.items() if k}
        if kind == 'traffic':
            code = folded.get('id') or folded.get('sensor_id')
        elif kind == 'air':
            code = folded.get('estacion') or folded.get('station_id')
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
        'air': ('air_station_locations', 'air_stations.csv',
                lambda: parse_csv(get(AIR_CSV))),
        'noise': ('noise_station_locations', 'noise_stations.csv',
                  lambda: parse_csv(get(NOISE_CSV))),
    }
    succeeded = []
    for kind in kinds:
        key, filename, loader = paths[kind]
        try:
            data = standardize(loader(), kind)
            result = out / filename
            id_col = 'sensor_id' if kind == 'traffic' else 'station_id'
            write_csv(result, data, [id_col, 'lat', 'lon'])
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
