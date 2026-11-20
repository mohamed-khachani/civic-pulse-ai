import importlib.util
import math
from pathlib import Path

from common import CensusIndex, point_of
from fetch_station_locations import standardize
from monitoring import enrich


def test_station_reference_uses_numeric_air_code_and_decimal_coordinates():
    rows = [{'CODIGO_CORTO': '008', 'ESTACION': 'Escuelas Aguirre',
             'LATITUD_ETRS89': '40.42156', 'LONGITUD_ETRS89': '-3.68232',
             'LATITUD': '40º25\'17"N', 'LONGITUD': '3º40\'56"O'}]
    result = standardize(rows, 'air')
    assert result == [{'station_id': '8', 'lat': 40.42156, 'lon': -3.68232}]
    assert point_of({'LATITUD': 'not a coordinate', 'lat': '40.42', 'lon': '-3.70'}).y == 40.42


def test_noise_combines_equal_duration_levels_as_energy(tmp_path):
    noise = tmp_path / 'noise.csv'
    noise.write_text('Estación;Año;Mes;Día;Periodo;LAeq\n2;2026;1;1;T;60\n2;2026;1;2;T;70\n')
    stations = tmp_path / 'stations.csv'
    stations.write_text('station_id,lat,lon\n2,40.415,-3.705\n')
    cfg = {'_base': str(tmp_path), 'files': {'noise': str(noise), 'noise_station_locations': str(stations)},
           'max_monitor_distance_m': 2000}
    feature = {'properties': {'section_code': '01001'}, 'geometry': {'type': 'Polygon',
               'coordinates': [[[-3.71, 40.41], [-3.70, 40.41], [-3.70, 40.42], [-3.71, 40.42], [-3.71, 40.41]]]}}
    records = {'01001': {}}
    report = enrich(cfg, records, CensusIndex([feature]))
    value = records['01001']['noise_laeq_t_2026_nearest_station_db_energy_mean']
    assert math.isclose(value, 10 * math.log10((10 ** 6 + 10 ** 7) / 2))
    assert not math.isclose(value, 65)
    assert report['noise']['sections_near_monitor'] == 1
    assert records['01001']['noise_nearest_station_id'] == '2'


def test_database_import_preserves_codes_nulls_and_metric_provenance():
    path = Path(__file__).resolve().parents[3] / 'db/ingest-sections.py'
    spec = importlib.util.spec_from_file_location('ingest_sections', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.typed_value('section_code', '01001') == '01001'
    assert module.typed_value('noise_nearest_station_id', '02') == '02'
    assert module.typed_value('population_total', '0') == 0
    assert module.typed_value('population_total', '') is None
    air = module.metric_metadata('air_magnitude_8_2026_nearest_station_daily_mean', {})
    assert (air['name'], air['unit'], air['scope'], air['kind'], air['year']) == (
        'Calidad del aire · NO₂', 'µg/m³', 'station', 'estimated', 2026)
    study = module.metric_metadata('district_study_rent_123', {
        'rent_123': {'metric': 'Renta', 'year': '2024', 'source': 'local workbook'}})
    assert study['scope'] == 'district'
    assert study['year'] == 2024
    fraction = module.metric_metadata(
        'district_study_autopercepcion_de_buen_estado_de_salud_respuesta_muy_buena_buena_464c05', {})
    assert fraction['unit'] == 'proporción (0–1)'
