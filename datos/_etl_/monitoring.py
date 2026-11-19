"""Air and noise monitoring observations associated with NEAREST stations only.

Measurements are point observations, not measured section-wide exposure. Requires
optional station-location CSVs. No fabricated station geocoding.
"""
from collections import defaultdict
from common import source, iter_csv, as_number, as_int, point_of, PointIndex


def station_lookup(path, names):
    locations = {}
    if not path:
        return locations
    for row in iter_csv(path):
        code = next((str(row.get(k, '')).strip().lstrip('0') for k in names if row.get(k)), '')
        p = point_of(row)
        if code and p:
            locations[code] = p
    return locations


def assign_station_metrics(records, census, locations, station_metrics, prefix, max_distance):
    ids = [station for station in locations if station in station_metrics]
    if not ids:
        return 0
    index = PointIndex([locations[i] for i in ids])
    assigned = 0
    for code, rec in records.items():
        center = census.centroids[census.by_code[code]]
        hit = index.nearest(center)
        if hit is None:
            continue
        ix, dist = hit
        if dist > max_distance:
            continue
        station_id = ids[ix]
        rec[prefix + '_nearest_station_id'] = station_id
        rec[prefix + '_nearest_station_distance_m'] = dist
        rec.update(station_metrics[station_id])
        assigned += 1
    return assigned


def enrich(cfg, records, census):
    report = {}
    max_distance = float(cfg.get('max_monitor_distance_m', 2000))
    air_file = source(cfg, 'air_quality')
    air_geo = station_lookup(source(cfg, 'air_station_locations'),
                             ('station_id', 'ESTACION', 'estacion', 'id'))
    if air_file and air_geo:
        # Madrid 2025 monthly archive; V means validated. Group by station/magnitude/year.
        aggregate = defaultdict(lambda: [0., 0])
        latest_year = 0
        for row in iter_csv(air_file):
            year = as_int(row.get('ANO')) or 0
            station = str(row.get('ESTACION', '')).strip().lstrip('0')
            magn = str(row.get('MAGNITUD', '')).strip().lstrip('0')
            if station not in air_geo or not magn or year < 2020:
                continue
            latest_year = max(latest_year, year)
            for d in range(1, 32):
                key = f'{d:02d}'
                if row.get('V' + key, '').strip().upper() != 'V':
                    continue
                n = as_number(row.get('D' + key))
                if n is not None and n >= 0:
                    acc = aggregate[(station, magn, year)]
                    acc[0] += n
                    acc[1] += 1
        readings = defaultdict(dict)
        for (station, magn, year), (total, count) in aggregate.items():
            if year == latest_year and count:
                readings[station][f'air_magnitude_{magn}_{year}_nearest_station_daily_mean'] = total / count
                readings[station][f'air_magnitude_{magn}_{year}_nearest_station_valid_days'] = count
        report['air'] = {'stations_with_locations': len(air_geo), 'latest_year': latest_year,
                         'sections_near_monitor': assign_station_metrics(
                             records, census, air_geo, readings, 'air', max_distance)}
        print('[AIR]', report['air'])
    elif air_file:
        print('[AIR] Skipped: air_station_locations CSV required for geographic joins')
        report['air'] = {'status': 'missing_station_locations'}
    noise_file = source(cfg, 'noise')
    noise_geo = station_lookup(source(cfg, 'noise_station_locations'),
                               ('station_id', 'Estación', 'Estacion', 'estacion', 'id'))
    if noise_file and noise_geo:
        aggregate = defaultdict(lambda: [0., 0])
        latest_year = 0
        for row in iter_csv(noise_file):
            year = as_int(row.get('Año')) or 0
            station = (row.get('Estación') or '').strip().lstrip('0')
            period = (row.get('Periodo') or '').strip().upper()
            value = as_number(row.get('LAeq'))
            if station not in noise_geo or period not in ('D', 'E', 'N', 'T') or value is None:
                continue
            latest_year = max(latest_year, year)
            agg = aggregate[(station, period, year)]
            agg[0] += value
            agg[1] += 1
        readings = defaultdict(dict)
        for (station, period, year), (total, n) in aggregate.items():
            if year == latest_year and n:
                readings[station][f'noise_laeq_{period.lower()}_{year}_nearest_station_db_arithmetic_mean'] = total / n
                readings[station][f'noise_laeq_{period.lower()}_{year}_nearest_station_observations'] = n
        report['noise'] = {'stations_with_locations': len(noise_geo), 'latest_year': latest_year,
                           'sections_near_monitor': assign_station_metrics(
                               records, census, noise_geo, readings, 'noise', max_distance)}
        print('[NOISE]', report['noise'])
    elif noise_file:
        print('[NOISE] Skipped: noise_station_locations CSV required for geographic joins')
        report['noise'] = {'status': 'missing_station_locations'}
    return report
