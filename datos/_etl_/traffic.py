"""Stream 800MB+ CSV from ZIP and aggregate by traffic sensor then census section.

Do not aggregate unlocated sensor IDs to fictitious polygons. Only execute when
sensor_locations.csv has actual geographic coordinates. Filter error!='N'.
"""
from __future__ import annotations
import csv
import zipfile
from collections import defaultdict
from common import source, iter_csv, as_number, point_of


def enrich(cfg, records, census):
    zip_path = source(cfg, 'traffic_zip')
    locations_path = source(cfg, 'traffic_sensor_locations')
    if zip_path is None:
        return {'status': 'traffic_zip_missing'}
    if locations_path is None:
        print('[TRAFFIC] Skipped 815MB ZIP: requires traffic_sensor_locations CSV')
        return {'status': 'sensor_locations_missing'}
    locations = {}
    for row in iter_csv(locations_path):
        sensor = str(row.get('sensor_id') or row.get('id') or '').strip()
        point = point_of(row)
        if sensor and point:
            locations[sensor] = point
    if not locations:
        return {'status': 'no_valid_sensor_locations'}
    sensors_by_section = defaultdict(list)
    id_to_section = {}
    for sensor, point in locations.items():
        section = census.for_point(point)
        if section:
            id_to_section[sensor] = section
    # Aggregate each known sensor over timestamps. Sensor sample count is NOT a
    # vehicle count; intensidad is a supplied rate and must remain a mean.
    stats = defaultdict(lambda: {'n': 0, 'intensity_sum': 0., 'speed_sum': 0.,
                                 'speed_n': 0, 'occupancy_sum': 0., 'occupancy_n': 0})
    processed = 0
    with zipfile.ZipFile(zip_path) as z:
        candidates = [x for x in z.namelist() if x.lower().endswith('.csv')]
        if not candidates:
            raise ValueError('Traffic ZIP contains no CSV')
        for name in candidates:
            with z.open(name) as fh:
                import io
                reader = csv.DictReader(io.TextIOWrapper(fh, encoding='utf-8-sig', errors='replace'), delimiter=';')
                for row in reader:
                    sensor = str(row.get('id', '')).strip()
                    if sensor not in id_to_section or row.get('error', '').strip().upper() != 'N':
                        continue
                    intensity = as_number(row.get('intensidad'))
                    if intensity is None or intensity < 0:
                        continue
                    d = stats[sensor]
                    d['intensity_sum'] += intensity
                    d['n'] += 1
                    v = as_number(row.get('vmed'))
                    if v is not None and v >= 0:
                        d['speed_sum'] += v
                        d['speed_n'] += 1
                    occ = as_number(row.get('ocupacion'))
                    if occ is not None and occ >= 0:
                        d['occupancy_sum'] += occ
                        d['occupancy_n'] += 1
                    processed += 1
    for sensor, d in stats.items():
        section = id_to_section[sensor]
        sensors_by_section[section].append(d)
    for code, samples in sensors_by_section.items():
        records[code]['traffic_sensors_in_section'] = len(samples)
        # Weighted over recorded samples: not estimated network vehicle flow.
        obs = sum(s['n'] for s in samples)
        records[code]['traffic_2026_sample_count'] = obs
        if obs:
            records[code]['traffic_2026_mean_reported_intensity'] = sum(s['intensity_sum'] for s in samples) / obs
        speed_n = sum(s['speed_n'] for s in samples)
        if speed_n:
            records[code]['traffic_2026_mean_reported_speed_kmh'] = sum(s['speed_sum'] for s in samples) / speed_n
        occ_n = sum(s['occupancy_n'] for s in samples)
        if occ_n:
            records[code]['traffic_2026_mean_reported_occupancy'] = sum(s['occupancy_sum'] for s in samples) / occ_n
    print(f'[TRAFFIC] processed {processed} valid located rows, {len(sensors_by_section)} sections')
    return {'status': 'ok', 'valid_located_measurements': processed,
            'located_sensors': len(id_to_section), 'sections_with_sensors': len(sensors_by_section)}
