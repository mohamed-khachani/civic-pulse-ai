"""End-to-end HABITAT AI census-section CSV builder."""
from __future__ import annotations
import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from common import read_config, output_path, write_csv, CensusIndex, scalar, source
import geo
import demographics
import housing
import study
import facilities
import accidents
import monitoring
import traffic

BASE_FIELDS = [
    'section_code', 'district_code', 'district_name', 'barrio_code', 'barrio_name',
    'section_area_km2', 'section_centroid_lat', 'section_centroid_lon',
    'district_area_km2', 'barrio_area_km2',
]


def build(config_file: str, steps: list[str] | None = None):
    cfg = read_config(config_file)
    out = output_path(cfg)
    records, features = geo.build_sections(cfg)
    index = CensusIndex(features)
    steps = set(steps or ['padron', 'housing', 'study', 'facilities', 'accidents', 'monitoring', 'traffic'])
    coverage = {'census_section_count': len(records)}
    if 'padron' in steps:
        demographics.enrich(cfg, records)
    if 'housing' in steps:
        housing.enrich(cfg, records)
    catalog = study.extract(cfg, records) if 'study' in steps else []
    if 'facilities' in steps:
        coverage['facilities'] = facilities.enrich(cfg, records, index)
    if 'accidents' in steps:
        coverage['accidents'] = accidents.enrich(cfg, records, index)
    if 'monitoring' in steps:
        coverage['monitoring'] = monitoring.enrich(cfg, records, index)
    if 'traffic' in steps:
        coverage['traffic'] = traffic.enrich(cfg, records, index)
    fields = BASE_FIELDS + sorted(set().union(*(rec.keys() for rec in records.values())) - set(BASE_FIELDS))
    # Explicit missing-value sentinel blank: 0 means a verified zero, not missing.
    sorted_records = [records[k] for k in sorted(records)]
    master = out / 'sections_master.csv'
    write_csv(master, sorted_records, fields)
    by_section = out / 'by_section'
    by_section.mkdir(parents=True, exist_ok=True)
    for record in sorted_records:
        write_csv(by_section / (record['section_code'] + '.csv'), [record], fields)
    (out / 'sections.geojson').write_text(json.dumps({
        'type': 'FeatureCollection', 'features': features}, ensure_ascii=False), encoding='utf-8')
    if catalog:
        write_csv(out / 'study_metric_dictionary.csv', catalog,
                  ['field', 'metric', 'year', 'description', 'source', 'file', 'level'])
    # Each section code in this index resolves to the same file basename.
    index_rows = [{'section_code': code, 'relative_file': f'by_section/{code}.csv'}
                  for code in sorted(records)]
    write_csv(out / 'section_index.csv', index_rows, ['section_code', 'relative_file'])
    metric_cov = {}
    for field in fields:
        count = sum(1 for record in sorted_records if record.get(field) is not None and record.get(field) != '')
        metric_cov[field] = {'non_null_sections': count, 'fraction': round(count / len(records), 4)}
    coverage['metrics'] = metric_cov
    coverage['rows_written'] = len(sorted_records)
    coverage['columns_written'] = len(fields)
    coverage['generated_at_utc'] = datetime.now(timezone.utc).isoformat()
    coverage['sources'] = {k: str(source(cfg, k)) if source(cfg, k) else None
                           for k in cfg.get('files', {})}
    (out / 'coverage_report.json').write_text(json.dumps(coverage, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'[DONE] {len(records)} per-section CSV files, {len(fields)} columns each: {out}')
    return coverage


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Build one enriched CSV for each census section')
    p.add_argument('--config', default=str(Path(__file__).with_name('paths.json')))
    p.add_argument('--steps', nargs='*', choices=['padron', 'housing', 'study', 'facilities', 'accidents', 'monitoring', 'traffic'],
                   help='Optional subset of stages to run; default all')
    args = p.parse_args()
    build(args.config, args.steps)
