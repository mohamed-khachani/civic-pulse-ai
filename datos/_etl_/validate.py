"""Data integrity checks for section coverage, IDs, counts and rent quantiles."""
import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from common import read_config, output_path, as_number


def validate(out: Path):
    file = out / 'sections_master.csv'
    with file.open(encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    ids = [r['section_code'] for r in rows]
    dupes = [key for key, count in Counter(ids).items() if count > 1]
    invalid_codes = [code for code in ids if len(code) != 5 or not code.isdigit()]
    absent_files = [code for code in ids if not (out / 'by_section' / (code + '.csv')).is_file()]
    invalid_population = [r['section_code'] for r in rows
                          if as_number(r.get('population_total')) is not None
                          and as_number(r['population_total']) < 0]
    inversions = []
    for r in rows:
        p25 = as_number(r.get('section_2024_rent_collective_month_eur_p25'))
        p50 = as_number(r.get('section_2024_rent_collective_month_eur_p50'))
        p75 = as_number(r.get('section_2024_rent_collective_month_eur_p75'))
        if all(x is not None for x in (p25,p50,p75)) and not p25 <= p50 <= p75:
            inversions.append(r['section_code'])
    report = {'section_count': len(rows), 'unique_sections': len(set(ids)),
              'duplicate_codes': dupes[:20], 'invalid_codes': invalid_codes[:20],
              'missing_files': absent_files[:20], 'negative_population': invalid_population[:20],
              'rent_quantile_inversions': inversions[:20],
              'pass': not any((dupes, invalid_codes, absent_files, invalid_population, inversions))}
    (out / 'validation_report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--config', default=str(Path(__file__).with_name('paths.json')))
    args = p.parse_args()
    rep = validate(output_path(read_config(args.config)))
    print(json.dumps(rep, indent=2))
    if not rep['pass']:
        raise SystemExit(1)
