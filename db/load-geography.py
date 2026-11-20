#!/usr/bin/env python3
"""Print SQL to load the existing Madrid boundaries and match listing coordinates."""
import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_csv(path):
    with path.open(encoding='utf-8-sig', newline='') as file:
        return list(csv.DictReader(file, delimiter=';'))


def area_km2(value):
    return float(value.replace(',', '.')) / 1_000_000


def sql_json(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def build_sql():
    districts = [
        {'code': row['COD_DIS'].zfill(2), 'name': row['NOMBRE'], 'area_km2': area_km2(row['AREA'])}
        for row in read_csv(ROOT / 'datos/geografia/distritos.csv')
    ]
    neighborhoods = [
        {'code': row['COD_BAR'].zfill(3), 'district_code': row['CODDIS'].zfill(2),
         'name': row['NOMBRE'], 'area_km2': area_km2(row['AREA'])}
        for row in read_csv(ROOT / 'datos/geografia/Barrios.csv')
    ]
    sections = json.loads((ROOT / 'datos/_etl_/output/sections.geojson').read_text())['features']
    topology = json.loads((ROOT / 'datos/geografia/seccionado-censa.json').read_text(encoding='utf-8-sig'))
    source_codes = {
        item['properties']['COD_SECCIO'].zfill(5)
        for item in topology['objects']['Secciones_Censales']['geometries']
    }
    section_codes = [item['properties']['section_code'] for item in sections]
    if len(section_codes) != len(set(section_codes)) or set(section_codes) != source_codes:
        raise ValueError('Generated sections do not match the municipal source. Check the geometry output first.')

    frontend = json.loads((ROOT / 'front-end/public/geo/madrid-census-2025.geojson').read_text())
    frontend_codes = {item['properties']['id'] for item in frontend['features']
                      if item['properties']['id'].startswith('28079')}
    if {'28079' + code for code in section_codes} != frontend_codes:
        raise ValueError('Municipal and frontend census identifiers differ. Review their vintages before loading.')

    # CSV names/areas and section geometry come from the existing local datasets.
    return f"""\
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL standard_conforming_strings = on;

INSERT INTO madrid.districts (municipality_code, code, name, area_km2)
SELECT '28079', code, name, area_km2
FROM jsonb_to_recordset({sql_json(districts)}) AS r(code text, name text, area_km2 float8)
ON CONFLICT (municipality_code, code) DO UPDATE
SET name = EXCLUDED.name, area_km2 = EXCLUDED.area_km2;

INSERT INTO madrid.neighborhoods (municipality_code, code, district_code, name, area_km2)
SELECT '28079', code, district_code, name, area_km2
FROM jsonb_to_recordset({sql_json(neighborhoods)}) AS r(code text, district_code text, name text, area_km2 float8)
ON CONFLICT (municipality_code, code) DO UPDATE
SET district_code = EXCLUDED.district_code, name = EXCLUDED.name, area_km2 = EXCLUDED.area_km2;

INSERT INTO madrid.census_sections (dataset_id, municipality_code, section_code, neighborhood_code, geom)
SELECT 'madrid-municipal', '28079', feature->'properties'->>'section_code',
       feature->'properties'->>'barrio_code',
       ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(feature->'geometry')), 3))
FROM jsonb_array_elements({sql_json(sections)}) AS item(feature)
ON CONFLICT (dataset_id, cusec) DO UPDATE
SET neighborhood_code = EXCLUDED.neighborhood_code, geom = EXCLUDED.geom;

DO $$
BEGIN
    IF (SELECT count(*) FROM madrid.census_sections WHERE dataset_id = 'madrid-municipal') <> {len(sections)} THEN
        RAISE EXCEPTION 'Unexpected sections already exist in the municipal dataset. Review before replacing boundaries.';
    END IF;
END
$$;

-- Recalculate existing listings; the trigger also handles future imports and coordinate changes.
UPDATE housing.listings SET latitude = latitude;

COMMIT;

SELECT section_match_status, count(*) FROM housing.listings GROUP BY section_match_status ORDER BY section_match_status;
"""


if __name__ == '__main__':
    print(build_sql())
