"""Unique accident counts by census polygon (XLSX has multiple persons per crash)."""
from collections import defaultdict
from common import source, iter_xlsx, as_number, UTM_TO_WGS84


def enrich(cfg, records, census):
    stats = {}
    for prefix, key in [('road_accidents', 'traffic_accidents'),
                        ('bike_accidents', 'bike_accidents')]:
        file = source(cfg, key)
        if not file:
            continue
        accidents = defaultdict(set)
        seen = set()
        valid_events = 0
        missing_geo = 0
        for row in iter_xlsx(file):
            incident = (row.get('A') or '').strip()
            if not incident or incident == 'num_expediente' or incident in seen:
                continue
            seen.add(incident)
            x, y = as_number(row.get('P')), as_number(row.get('Q'))
            if x is None or y is None or not (350000 < x < 550000 and 4400000 < y < 4550000):
                missing_geo += 1
                continue
            code = census.locate_utm(x, y)
            if code:
                accidents[code].add(incident)
                valid_events += 1
        for code, rec in records.items():
            rec[f'{prefix}_2026_count'] = len(accidents[code])
        stats[prefix] = {'unique_incident_ids': len(seen), 'assigned': valid_events,
                         'missing_coordinates': missing_geo,
                         'unassigned_coordinates': len(seen) - valid_events - missing_geo}
        print(f'[ACCIDENTS] {prefix}: {len(seen)} unique incidents, {valid_events} assigned')
    return stats
