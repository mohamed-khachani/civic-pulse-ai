"""Lookup a listing by lon/lat (or latitude/longitude) and return section features."""
import argparse
import csv
import json
from pathlib import Path
from shapely.geometry import shape
from common import CensusIndex, read_config, output_path, as_number


def find_section(output_dir, lon, lat):
    boundaries = json.loads((output_dir / 'sections.geojson').read_text(encoding='utf-8'))
    index = CensusIndex(boundaries['features'])
    code = index.locate(lon, lat)
    if code is None:
        return {'matched': False, 'reason': 'Outside Madrid municipal census polygons or coordinates invalid'}
    with (output_dir / 'by_section' / (code + '.csv')).open(encoding='utf-8-sig', newline='') as f:
        data = next(csv.DictReader(f))
    result = {k: as_number(v) if k not in ('section_code','district_code','district_name','barrio_code','barrio_name','padron_reference_date') and as_number(v) is not None else v
              for k, v in data.items()}
    return {'matched': True, 'section_code': code, 'section_data': result}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Find HABITAT AI census section for a listing location')
    p.add_argument('--config', default=str(Path(__file__).with_name('paths.json')))
    p.add_argument('--lat', type=float, required=True)
    p.add_argument('--lon', type=float, required=True)
    p.add_argument('--rent', type=float, help='Listing monthly rent, for comparison to 2024 median (not a fit score)')
    args = p.parse_args()
    result = find_section(output_path(read_config(args.config)), args.lon, args.lat)
    if args.rent is not None and result.get('matched'):
        baseline = result['section_data'].get('section_2024_rent_collective_month_eur_p50')
        if isinstance(baseline, (float, int)) and baseline > 0:
            result['listing_rent_vs_section_reference_median_pct'] = round(100 * (args.rent / baseline - 1), 1)
            result['reference_year'] = 2024
    print(json.dumps(result, ensure_ascii=False, indent=2))
