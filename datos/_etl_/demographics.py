"""Aggregate 2026 padrón at the section level, never replicate raw person-age rows."""
from collections import defaultdict
from common import source, iter_csv, section_code, as_int


def enrich(cfg, records):
    file = source(cfg, 'padron')
    if not file:
        return
    totals = defaultdict(lambda: defaultdict(int))
    dates = defaultdict(set)
    unique_ages = defaultdict(set)
    for row in iter_csv(file):
        code = section_code(row.get('COD_DISTRITO'), row.get('COD_SECCION'))
        if code not in records:
            continue
        t = totals[code]
        es_h = as_int(row.get('ESPANOLESHOMBRES')) or 0
        es_m = as_int(row.get('ESPANOLESMUJERES')) or 0
        ex_h = as_int(row.get('EXTRANJEROSHOMBRES')) or 0
        ex_m = as_int(row.get('EXTRANJEROSMUJERES')) or 0
        count = es_h + es_m + ex_h + ex_m
        t['population_total'] += count
        t['population_men'] += es_h + ex_h
        t['population_women'] += es_m + ex_m
        # Aggregate age groups for demographic context, not as scoring proxies.
        age = as_int(row.get('COD_EDAD_INT'))
        if age is not None:
            band = '0_17' if age < 18 else '18_34' if age < 35 else '35_64' if age < 65 else '65_plus'
            t['population_age_' + band] += count
            unique_ages[code].add(age)
        date = (row.get('FX_DATOS_INI') or '').strip()
        if date:
            dates[code].add(date)
    for code, agg in totals.items():
        records[code].update(agg)
        records[code]['population_density_km2'] = agg['population_total'] / records[code]['section_area_km2'] if records[code]['section_area_km2'] else None
        records[code]['padron_reference_date'] = max(dates[code]) if dates[code] else ''
        records[code]['padron_distinct_ages'] = len(unique_ages[code])
    print(f'[PADRON] matched {len(totals)} census sections')
