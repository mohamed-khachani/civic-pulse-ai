"""Load 2024 official rental reference indices and optional 2023 postal-code data."""
import re
from collections import defaultdict
from common import source, iter_xlsx, iter_csv, as_number, district_code, section_code

# XLSX 2024 published column definitions from provided sheets.
METRICS = {
 'C': 'rental_units', 'D': 'rental_collective_units', 'E': 'rental_single_family_units',
 'F': 'rent_collective_size_m2_p50', 'G': 'rent_collective_size_m2_p25', 'H': 'rent_collective_size_m2_p75',
 'I': 'rent_collective_eur_m2_p50', 'J': 'rent_collective_eur_m2_p25', 'K': 'rent_collective_eur_m2_p75',
 'L': 'rent_collective_month_eur_p50', 'M': 'rent_collective_month_eur_p25', 'N': 'rent_collective_month_eur_p75',
 'O': 'rent_house_size_m2_p50', 'P': 'rent_house_size_m2_p25', 'Q': 'rent_house_size_m2_p75',
 'R': 'rent_house_eur_m2_p50', 'S': 'rent_house_eur_m2_p25', 'T': 'rent_house_eur_m2_p75',
 'U': 'rent_house_month_eur_p50', 'V': 'rent_house_month_eur_p25', 'W': 'rent_house_month_eur_p75',
}


def enrich(cfg, records):
    section_file = source(cfg, 'rental_section_2024')
    district_file = source(cfg, 'rental_district_2024')
    district = {}
    if district_file:
        for row in iter_xlsx(district_file):
            label = (row.get('B') or '').strip()
            match = re.match(r'^(\d\d)\s*[-–]', label)
            if not match:
                continue
            code = district_code(match.group(1))
            if code:
                district[code] = {f'district_2024_{col}': as_number(row.get(letter)) for letter, col in METRICS.items()}
    joined_sec = 0
    section = {}
    if section_file:
        for row in iter_xlsx(section_file):
            label = (row.get('B') or '').strip()
            if not re.fullmatch(r'\d{5}', label):
                continue
            code = section_code(label)
            section[code] = {f'section_2024_{col}': as_number(row.get(letter)) for letter, col in METRICS.items()}
    for code, record in records.items():
        record.update(district.get(record['district_code'], {}))
        if code in section:
            joined_sec += 1
            record.update(section[code])
    print(f'[RENT] 2024 matched {joined_sec} sections, {len(district)} districts')

    # 2023 dataset refers to POSTAL CODES, not census polygons. Never join via name.
    postal = source(cfg, 'rental_postal_2023')
    crosswalk = source(cfg, 'section_postal_crosswalk')
    if postal and not crosswalk:
        print('[RENT] 2023 postcode dataset not assigned: supply section_postal_crosswalk.csv')
        return
    if not postal or not crosswalk:
        return
    value_by_postcode = {}
    for row in iter_csv(postal):
        m = re.search(r'\b(28\d{3})\b', row.get('Concepto', ''))
        val = as_number(row.get('Valor'))
        if m and val is not None:
            value_by_postcode[m.group(1)] = val
    # Crosswalk should have fractions of each section within a postal-code area.
    groups = defaultdict(list)
    for row in iter_csv(crosswalk):
        code = section_code(row.get('section_code'))
        cp = (row.get('postal_code') or '').strip()
        weight = as_number(row.get('weight'))
        if code in records and cp in value_by_postcode and weight is not None and 0 < weight <= 1:
            groups[code].append((weight, value_by_postcode[cp]))
    for code, vals in groups.items():
        total = sum(w for w, _ in vals)
        if total > 0:
            records[code]['section_est_2023_postal_rent_eur_m2'] = sum(w * v for w, v in vals) / total
            records[code]['section_est_2023_postal_coverage_weight'] = total
    print(f'[RENT] 2023 postal estimates for {len(groups)} sections (crosswalk-weighted)')
