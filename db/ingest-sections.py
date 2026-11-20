#!/usr/bin/env python3
"""Load the complete ETL output and its numeric metric catalog into PostgreSQL."""
import argparse
import csv
import json
import math
import os
import re
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
TEXT_FIELDS = {
    'section_code', 'district_code', 'district_name', 'barrio_code', 'barrio_name',
    'padron_reference_date', 'air_nearest_station_id', 'noise_nearest_station_id',
}
AIR_MAGNITUDES = {
    '1': ('SO₂', 'µg/m³'), '6': ('CO', 'mg/m³'), '7': ('NO', 'µg/m³'),
    '8': ('NO₂', 'µg/m³'), '9': ('PM2.5', 'µg/m³'), '10': ('PM10', 'µg/m³'),
    '12': ('NOₓ', 'µg/m³'), '14': ('O₃', 'µg/m³'), '20': ('Tolueno', 'µg/m³'),
    '30': ('Benceno', 'µg/m³'), '35': ('Etilbenceno', 'µg/m³'),
    '37': ('Metaxileno', 'µg/m³'), '38': ('Paraxileno', 'µg/m³'), '39': ('Ortoxileno', 'µg/m³'),
}


def typed_value(field, value):
    if value == '':
        return None
    if field in TEXT_FIELDS:
        return value
    try:
        number = float(value)
        if math.isfinite(number):
            return int(number) if number.is_integer() else number
    except ValueError:
        pass
    return value


def metric_metadata(field, dictionary):
    scope = 'district' if field.startswith('district_') else 'neighborhood' if field.startswith('barrio_') else 'section'
    kind = 'observed'
    source = 'datos/_etl_/'
    year = None
    source_url = None
    description = 'Variable derivada de los datos municipales; consultar el campo original y su fuente.'
    label = field.replace('_', ' ')
    unit = 'valor'

    if '_study_' in field:
        item = dictionary.get(field.split('_study_', 1)[1], {})
        label = item.get('metric') or label
        description = item.get('description') or 'Indicador heredado de distrito/barrio del estudio municipal; no es una observación específica de la sección.'
        source = item.get('source') or 'datos/padron/estudio-2026.xlsx'
        if source.startswith('http'):
            source_url = source
        years = re.findall(r'\b(?:19|20)\d{2}\b', item.get('year') or '')
        year = int(years[0]) if len(set(years)) == 1 else None
        # This workbook cell is an Excel percentage stored as a fraction.
        if 'autopercepcion_de_buen_estado_de_salud' in field:
            unit = 'proporción (0–1)'
        elif '%' in label or 'porcentaje' in label.lower():
            unit = '%'
        elif 'renta' in label.lower() and '€' in label:
            unit = 'EUR'
    elif field.startswith('air_'):
        source = 'datos/calidad-vida/calidad-aire.csv'
        source_url = 'https://datos.madrid.es/dataset/201410-0-calidad-aire-diario'
        scope, kind = 'station', 'estimated'
        description = 'Proxy de la estación más cercana al punto representativo de la sección, a un máximo de 2000 m. No mide exposición en toda la sección.'
        magnitude = re.search(r'air_magnitude_(\d+)', field)
        if magnitude:
            pollutant, pollutant_unit = AIR_MAGNITUDES.get(magnitude[1], ('Magnitud ' + magnitude[1], 'unidad de la fuente'))
            label = f'Calidad del aire · {pollutant}'
            unit = pollutant_unit
    elif field.startswith('noise_'):
        source = 'datos/calidad-vida/contaminacion-acustica.csv'
        source_url = 'https://datos.madrid.es/dataset/215885-0-contaminacion-ruido'
        scope, kind, unit = 'station', 'estimated', 'dB'
        description = 'Proxy de la estación acústica más cercana a menos de 2000 m. Media energética de LAeq de intervalos de igual duración, agrupada por periodo y año; no representa un mapa de exposición.'
        period = re.search(r'noise_laeq_([dent])_', field)
        periods = {'d': 'día', 'e': 'tarde', 'n': 'noche', 't': 'total diario'}
        if period:
            label = 'Ruido LAeq · ' + periods[period[1]]
    elif field.startswith('traffic_'):
        source = 'datos/accidentes/trafico-2026.zip'
        source_url = 'https://datos.madrid.es/dataset/208627-0-trafico-intensidad'
        year = 2026
        description = 'Agregación de sensores ubicados dentro de la sección. Observaciones de octubre de 2026, no total anual de vehículos.'
        if 'intensity' in field:
            unit = 'vehículos/h'
        elif 'speed_kmh' in field:
            unit = 'km/h'
        elif 'occupancy' in field:
            unit = '%'
    elif field.startswith(('road_accidents_', 'bike_accidents_')):
        source = 'datos/accidentes/accidentes-bici.xlsx' if field.startswith('bike') else 'datos/accidentes/accidentes-trafico.xlsx'
        year, unit = 2026, 'accidentes'
        description = 'Incidentes únicos geolocalizados dentro de la sección; no número de personas implicadas. Puede ser un periodo parcial del año.'
    elif field.startswith(('population_', 'padron_')):
        source = 'datos/padron/padron.csv'
        year, unit = 2026, 'personas'
        description = 'Padrón municipal agregado por sección. Contexto demográfico; no usar características protegidas para recomendar viviendas.'
        if 'density' in field:
            unit = 'personas/km²'
        elif field == 'padron_distinct_ages':
            unit = 'edades'
    elif '_2024_' in field:
        source = 'datos/alquiler/referencias-precio-alquiler-distrito.xlsx' if scope == 'district' else 'datos/alquiler/referencia-precio-alquiler-seccion-censa;.xlsx'
        year = 2024
        description = 'Referencia oficial histórica de alquiler de 2024; no precio actual de los anuncios.'
        if 'month_eur' in field:
            unit = 'EUR/mes'
        elif 'eur_m2' in field:
            unit = 'EUR/m²'
        elif 'size_m2' in field:
            unit = 'm²'
        else:
            unit = 'viviendas'
    elif field.startswith(('education_', 'health_', 'sports_', 'libraries_', 'parks_')):
        files = {'education': 'calidad-vida/centros-educativos.csv', 'health': 'calidad-vida/centros-atencion-medica.csv',
                 'sports': 'calidad-vida/instalaciones-deportivas.csv', 'libraries': 'calidad-vida/bibliotecas.csv',
                 'parks': 'zonas_verdes/parques-y-jardines.csv'}
        source = 'datos/' + files[field.split('_')[0]]
        unit = 'lugares'
        description = 'Lugares municipales geolocalizados. Distancias y radios se calculan desde un punto representativo de sección, en línea recta, no andando.'
        if '_count_500m' in field or '_count_1000m' in field:
            kind = 'estimated'
        if 'area_ha' in field:
            source, unit = 'datos/zonas_verdes/arbolado-superficie.csv', 'ha'
            description = 'Área del catálogo atribuida al marcador del parque; no superficie verde recortada dentro de la sección.'
    elif field.endswith('area_km2'):
        source, unit, kind = 'datos/geografia/', 'km²', 'estimated'
    elif 'centroid_' in field:
        source, unit, kind = 'datos/geografia/seccionado-censa.json', 'grados', 'estimated'
        description = 'Punto representativo interior de la sección; no necesariamente su centroide geométrico.'

    match = re.search(r'_(20\d{2})_', field)
    if match and year is None:
        year = int(match[1])
    if 'nearest_station_distance_m' in field or field.endswith('_nearest_m'):
        unit, kind = 'm', 'estimated'
    if 'valid_days' in field:
        label, unit = label + ' · días válidos', 'días'
    elif 'observations' in field or 'sample_count' in field:
        label, unit = label + ' · observaciones', 'observaciones'
    elif 'sensors_in_section' in field:
        unit = 'sensores'
    return {'id': field, 'name': label, 'unit': unit, 'scope': scope, 'description': description,
            'source': source, 'source_url': source_url, 'year': year, 'kind': kind}


def connect(database_url):
    if database_url:
        return psycopg.connect(database_url)
    env = {}
    env_path = ROOT / 'db/.env'
    if env_path.is_file():
        env = dict(line.split('=', 1) for line in env_path.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
    return psycopg.connect(host='127.0.0.1', port=env.get('POSTGRES_PORT', '5432'),
                           user=env.get('POSTGRES_USER', 'habitat_admin'),
                           password=env.get('POSTGRES_PASSWORD'), dbname=env.get('POSTGRES_DB', 'habitat_ai'))


def ingest(output_dir, database_url=None):
    with (output_dir / 'sections_master.csv').open(encoding='utf-8-sig', newline='') as file:
        reader = csv.DictReader(file)
        fields = reader.fieldnames
        rows = [{field: typed_value(field, value) for field, value in row.items()} for row in reader]
    dictionary = {}
    with (output_dir / 'study_metric_dictionary.csv').open(encoding='utf-8-sig', newline='') as file:
        dictionary = {row['field'].removeprefix('study_'): row for row in csv.DictReader(file)}
    metrics = [metric_metadata(field, dictionary) for field in fields if field not in TEXT_FIELDS
               and any(isinstance(row[field], (int, float)) for row in rows)]
    if len({row['section_code'] for row in rows}) != len(rows):
        raise ValueError('Duplicate census sections in ETL output')

    with connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute((ROOT / 'db/migrations/003_section_data.sql').read_text())
            cur.execute('SELECT cusec FROM madrid.census_sections WHERE dataset_id=%s', ('madrid-municipal',))
            expected = {row[0] for row in cur.fetchall()}
            if {'28079' + row['section_code'] for row in rows} != expected:
                raise ValueError('ETL section coverage differs from the loaded geography')
            cur.execute('CREATE TEMP TABLE incoming_sections (cusec text, data jsonb) ON COMMIT DROP')
            with cur.copy('COPY incoming_sections (cusec, data) FROM STDIN') as copy:
                for row in rows:
                    copy.write_row(('28079' + row['section_code'], Jsonb(row)))
            cur.execute('''INSERT INTO madrid.section_data (census_dataset_id,cusec,data)
                           SELECT 'madrid-municipal',cusec,data FROM incoming_sections
                           ON CONFLICT (census_dataset_id,cusec) DO UPDATE SET data=EXCLUDED.data,updated_at=now()''')
            cur.executemany('''INSERT INTO madrid.metrics (id,name,unit,scope,description) VALUES (%s,%s,%s,%s,%s)
                               ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,unit=EXCLUDED.unit,scope=EXCLUDED.scope,description=EXCLUDED.description''',
                            [(m['id'], m['name'], m['unit'], m['scope'], m['description']) for m in metrics])
            cur.executemany('''INSERT INTO madrid.datasets (id,name,source,source_url,reference_year,notes) VALUES (%s,%s,%s,%s,%s,%s)
                               ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,source=EXCLUDED.source,source_url=EXCLUDED.source_url,reference_year=EXCLUDED.reference_year,notes=EXCLUDED.notes''',
                            [('etl:' + m['id'], m['name'], m['source'], m['source_url'], m['year'], m['description']) for m in metrics])
            cur.execute('CREATE TEMP TABLE incoming_metrics (cusec text, metric_id text, source_id text, value float8, kind text, source_area_code text) ON COMMIT DROP')
            with cur.copy('COPY incoming_metrics FROM STDIN') as copy:
                for row in rows:
                    cusec = '28079' + row['section_code']
                    for m in metrics:
                        source_area = cusec
                        if m['scope'] == 'district':
                            source_area = '28079' + row['district_code']
                        elif m['scope'] == 'neighborhood':
                            source_area = '28079' + row['barrio_code']
                        elif m['scope'] == 'station':
                            source_area = row.get('air_nearest_station_id' if m['id'].startswith('air_') else 'noise_nearest_station_id') or 'unavailable'
                        copy.write_row((cusec, m['id'], 'etl:' + m['id'], row[m['id']], m['kind'], source_area))
            # Replace only rows owned by this importer, keeping unrelated/manual datasets intact.
            cur.execute("DELETE FROM madrid.section_metrics WHERE census_dataset_id='madrid-municipal' AND source_id LIKE 'etl:%'")
            cur.execute('''INSERT INTO madrid.section_metrics (census_dataset_id,cusec,metric_id,source_id,value,kind,source_area_code)
                           SELECT 'madrid-municipal',cusec,metric_id,source_id,value,kind,source_area_code FROM incoming_metrics''')
            metric_rows = cur.rowcount
    print(json.dumps({'sections_imported': len(rows), 'columns_per_section': len(fields),
                      'metrics': len(metrics), 'metric_rows': metric_rows}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'datos/_etl_/output')
    parser.add_argument('--database-url', default=os.environ.get('DATABASE_URL'))
    args = parser.parse_args()
    ingest(args.output, args.database_url)
