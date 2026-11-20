"""Extract usable numeric 2026 district/neighbourhood study metrics.

The district workbook stores Madrid at C, district at E, and each neighbourhood at
G, I, K, ...; the second row gives 3-digit neighbourhood codes.
"""
from __future__ import annotations
import hashlib
import re
from collections import defaultdict
from common import source, iter_xlsx, as_number, normalized, district_code


def extract(cfg, records):
    workbook = source(cfg, 'district_study_2026')
    if not workbook:
        return []
    from zipfile import ZipFile
    with ZipFile(workbook) as z:
        sheet_count = sum(x.startswith('xl/worksheets/sheet') and x.endswith('.xml')
                          and '/' not in x[len('xl/worksheets/'):]
                          for x in z.namelist())
    # Sheet 0 cover; 1 introduction; 2 indicator dictionary; 3-23 district sheets.
    metadata = {}
    for row in iter_xlsx(workbook, 2):
        name = (row.get('A') or '').strip()
        if name and row.get('C'):
            metadata[normalized(name)] = {'year': row.get('C', '').strip(),
                                          'source': row.get('D', '').strip(),
                                          'description': row.get('B', '').strip()}
    catalog = {}
    included = cfg.get('study_metric_regex', '')
    compiled = re.compile(included, re.I) if included else None
    for sheet in range(3, sheet_count):
        district = None
        barrios = {}
        district_values = {}
        barrio_values = defaultdict(dict)
        for row in iter_xlsx(workbook, sheet):
            index = int(row.get('_row', '0'))
            if index == 1:
                match = re.search(r'\b(\d{2})\.', str(row.get('G', '')))
                if match:
                    district = district_code(match.group(1))
            if index == 2:
                for col, val in row.items():
                    if not re.fullmatch(r'[G-Z]+', col):
                        continue
                    m = re.match(r'\s*(\d{3})\s*\.', str(val))
                    if m:
                        barrios[col] = m.group(1)
                continue
            if index <= 3 or not district:
                continue
            title = (row.get('B') or '').strip()
            if not title or len(title) < 5:
                continue
            if compiled and not compiled.search(title):
                continue
            nums = {'district': as_number(row.get('E')),
                    **{col: as_number(row.get(col)) for col in barrios}}
            if all(value is None for value in nums.values()):
                continue
            # Hash avoids accidental collisions between similarly normalized labels.
            key = normalized(title)[:73] + '_' + hashlib.md5(title.encode()).hexdigest()[:6]
            m = 'study_' + key
            if nums['district'] is not None:
                district_values['district_' + m] = nums['district']
            for col, value in nums.items():
                if col in barrios and value is not None:
                    barrio_values[barrios[col]]['barrio_' + m] = value
            # Workbook values add chapter numbers absent from the indicator dictionary.
            unnumbered = re.sub(r'^\d+(?:\.\d+)*\.?\s*', '', title)
            details = metadata.get(normalized(title), metadata.get(normalized(unnumbered), {}))
            catalog[m] = {'metric': title, **details,
                          'file': 'estudio-2026.xlsx', 'level': 'district/barrio'}
        if district:
            for record in records.values():
                if record['district_code'] == district:
                    record.update(district_values)
                    record.update(barrio_values.get(record['barrio_code'], {}))
    print(f'[STUDY] extracted {len(catalog)} named metrics from {sheet_count - 3} district sheets')
    return [{'field': key, **value} for key, value in sorted(catalog.items())]
