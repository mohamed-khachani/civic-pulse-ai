"""Spatial point-of-interest counts, walk-radius proxies, nearest straight-line distance."""
from collections import defaultdict
from common import source, iter_csv, point_of, PointIndex, normalized, as_number

SOURCES = {
    'education': 'schools',
    'health': 'medical_centres',
    'sports': 'sports_facilities',
    'libraries': 'libraries',
    'parks': 'parks',
}


def enrich(cfg, records, census):
    stats = {}
    park_areas = {}
    area_file = source(cfg, 'park_area_catalogue')
    if area_file:
        for row in iter_csv(area_file):
            name = normalized(row.get('NOMBRE PARQUE', ''))
            if name and (area := as_number(row.get('Área (ha) '))) is not None:
                park_areas[name] = area
    for prefix, key in SOURCES.items():
        f = source(cfg, key)
        if not f:
            continue
        points, identifiers = [], set()
        skipped_coords = skipped_dupes = 0
        park_areas_from_points = defaultdict(float)
        for row in iter_csv(f):
            marker_id = row.get('PK', '').strip()
            if marker_id and marker_id in identifiers:
                skipped_dupes += 1
                continue
            p = point_of(row)
            if p is None:
                skipped_coords += 1
                continue
            if marker_id:
                identifiers.add(marker_id)
            points.append(p)
            if prefix == 'parks':
                name = normalized(row.get('NOMBRE', ''))
                area = park_areas.get(name)
                sec = census.for_point(p)
                if sec and area:
                    park_areas_from_points[sec] += area
        if not points:
            print(f'[POI] {prefix}: zero geocoded points; missing data retained as blanks')
            stats[prefix] = {'geocoded': 0, 'missing_coords': skipped_coords}
            continue
        index = PointIndex(points)
        count_in_section = defaultdict(int)
        for p in points:
            code = census.for_point(p)
            if code:
                count_in_section[code] += 1
        for code, row in records.items():
            c = census.centroids[census.by_code[code]]
            row[f'{prefix}_count_in_section'] = count_in_section.get(code, 0)
            for meters in (500, 1000):
                row[f'{prefix}_count_{meters}m'] = index.count_within(c, meters)
            nearest = index.nearest(c)
            if nearest:
                row[f'{prefix}_nearest_m'] = nearest[1]
            if prefix == 'parks' and code in park_areas_from_points:
                # Catalog total at park marker; NOT a spatially clipped park area.
                row['parks_catalogued_area_ha_at_points'] = park_areas_from_points[code]
        stats[prefix] = {'geocoded': len(points), 'missing_coords': skipped_coords,
                         'duplicate_ids': skipped_dupes, 'assigned_inside_madrid': sum(count_in_section.values())}
        print(f'[POI] {prefix}: {len(points)} points; {skipped_coords} without coordinates')
    if park_areas and not source(cfg, 'parks'):
        print('[POI] Park catalogue has names+areas only, cannot locate parks without parks.csv')
    return stats
