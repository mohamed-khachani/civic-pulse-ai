import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = async (file) => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const config = await read('datos/_etl_/paths.json');
const coverage = await read('datos/_etl_/output/coverage_report.json');
const old = await read('presentation/facts.json').catch(() => ({}));
const names = {
  census_topojson: 'Secciones censales', districts: 'Distritos', neighbourhoods: 'Barrios',
  padron: 'Padrón', district_study_2026: 'Estudio de distritos y barrios 2026',
  rental_section_2024: 'Referencia de alquiler por sección 2024', rental_district_2024: 'Referencia de alquiler por distrito 2024',
  rental_postal_2023: 'Alquiler por código postal 2023', schools: 'Centros educativos', medical_centres: 'Centros sanitarios',
  sports_facilities: 'Instalaciones deportivas', libraries: 'Bibliotecas', parks: 'Parques y jardines',
  park_area_catalogue: 'Catálogo de superficie de parques', traffic_accidents: 'Accidentes de tráfico',
  bike_accidents: 'Accidentes de bicicleta', noise: 'Contaminación acústica', air_quality: 'Calidad del aire', traffic_zip: 'Tráfico octubre 2026',
};
const referenceKeys = new Set(['section_postal_crosswalk', 'traffic_sensor_locations', 'air_station_locations', 'noise_station_locations']);
const metrics = coverage.metrics || {};
const hasValues = (prefix) => Object.entries(metrics).some(([key, entry]) => key.startsWith(prefix) && entry.non_null_sections > 0);
const joined = {
  census_topojson: coverage.rows_written > 0, districts: hasValues('district_name'), neighbourhoods: hasValues('barrio_name'),
  padron: hasValues('population_total'), district_study_2026: hasValues('district_study_'),
  rental_section_2024: hasValues('section_2024_'), rental_district_2024: hasValues('district_2024_'),
  rental_postal_2023: hasValues('section_est_2023_postal_'),
  schools: hasValues('education_'), medical_centres: hasValues('health_'), sports_facilities: hasValues('sports_'),
  libraries: hasValues('libraries_'), parks: hasValues('parks_count_'), park_area_catalogue: hasValues('parks_catalogued_area_'),
  traffic_accidents: hasValues('road_accidents_'), bike_accidents: hasValues('bike_accidents_'),
  noise: (coverage.monitoring?.noise?.sections_near_monitor || 0) > 0,
  air_quality: (coverage.monitoring?.air?.sections_near_monitor || 0) > 0,
  traffic_zip: coverage.traffic?.status === 'ok',
};
const datasets = Object.entries(config.files).filter(([id, file]) => file && !referenceKeys.has(id)).map(([id, file]) => {
  const integrated = joined[id] === true;
  const known = Object.hasOwn(joined, id);
  return {
    id, name: names[id] || path.basename(file), file: path.posix.normalize('datos/_etl_/' + file),
    integrated, status: integrated ? 'integrated' : known ? 'pending' : 'unverified',
    reason: id === 'rental_postal_2023' && !integrated ? 'Falta correspondencia sección/código postal' : id === 'traffic_zip' && !integrated ? 'Faltan coordenadas verificadas de sensores' : !known ? 'Fuente nueva pendiente de revisar en el informe de cobertura' : null,
  };
});
const metadataKeys = ['air_station_locations', 'noise_station_locations', 'traffic_sensor_locations'].filter((key) => config.files[key]);
const nonNumericFields = new Set(['section_code', 'district_code', 'district_name', 'barrio_code', 'barrio_name', 'padron_reference_date']);
const numericFields = Object.keys(metrics).filter((key) => !nonNumericFields.has(key) && !key.endsWith('_nearest_station_id'));
const facts = {
  ...old,
  updated: new Date().toISOString(),
  project: 'Atlas',
  data_generated_at: coverage.generated_at_utc,
  counts: {
    listings: old.counts?.listings ?? 10610,
    fotocasa: old.counts?.fotocasa ?? 7628,
    pisoscom: old.counts?.pisoscom ?? 2982,
    census_sections: coverage.rows_written,
    fields_per_section: coverage.columns_written,
    metric_definitions: numericFields.length,
    metric_rows: numericFields.length * coverage.rows_written,
    available_local_datasets: datasets.length,
    integrated_local_datasets: datasets.filter((d) => d.integrated).length,
    station_metadata_references: metadataKeys.length,
    air_sections: coverage.monitoring.air.sections_near_monitor,
    noise_sections: coverage.monitoring.noise.sections_near_monitor,
  },
  dataset_count_definition: 'Se cuentan los ficheros locales configurados, excluyendo correspondencias y referencias de estaciones. Solo se consideran integrados si el informe de cobertura confirma valores o una etapa completada. Las referencias de estaciones y los portales de anuncios se cuentan por separado.',
  metric_count_basis: 'Campos numéricos del informe de cobertura. Filas largas esperadas: campos numéricos × secciones, incluidos NULLs. Revisar contra PostgreSQL cuando cambie el importador.',
  datasets,
  station_metadata: metadataKeys.map((key) => ({name: key, provenance: path.posix.normalize('datos/_etl_/' + config.files[key]) + '.source.json'})),
  sources: [
    'datos/_etl_/output/coverage_report.json', 'datos/_etl_/output/validation_report.json',
    'datos/alquileres/ingest.log', 'datos/alquileres/ingest-fotocasa.log', 'db/README.md', 'backend/README.md',
  ],
  integration_status: old.integration_status ?? 'Datos reales conectados. Validación final del chat Claude en curso.',
};
if (process.argv.includes('--live')) {
  const base = process.env.API_URL || 'http://127.0.0.1:8000';
  const get = async (route) => {
    const response = await fetch(base + route, {signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`No se pudo verificar ${route}: HTTP ${response.status}`);
    return response.json();
  };
  const [health, catalog] = await Promise.all([get('/health'), get('/api/geo/metric-catalog')]);
  const totals = await Promise.all(['Fotocasa', 'pisos.com'].map(async (source) => {
    const data = await get('/api/listings?source=' + encodeURIComponent(source) + '&page_size=1');
    return {source, total: data.total};
  }));
  facts.live_searchable_counts = totals;
  facts.counts.listings = health.listings;
  facts.counts.metric_definitions = catalog.length;
  facts.live_checked_at = new Date().toISOString();
  // Keep imported totals separate from the API's searchable totals.
  const localEnv = await fs.readFile(path.join(root, 'backend/.env'), 'utf8').catch(() => '');
  const databaseUrl = process.env.DATABASE_URL || localEnv.split(/\r?\n/).find((line) => line.startsWith('DATABASE_URL='))?.slice('DATABASE_URL='.length);
  if (databaseUrl) {
    const requireBackend = createRequire(path.join(root, 'backend/package.json'));
    const { Pool } = requireBackend('pg');
    const pool = new Pool({connectionString: databaseUrl, connectionTimeoutMillis: 10000, statement_timeout: 30000});
    try {
      const portals = await pool.query('SELECT portal, count(*)::int AS count FROM housing.listings GROUP BY portal');
      for (const row of portals.rows) if (['fotocasa', 'pisoscom'].includes(row.portal)) facts.counts[row.portal] = row.count;
      const totals = await pool.query('SELECT (SELECT count(*)::int FROM madrid.metrics) AS metric_definitions, (SELECT count(*)::int FROM madrid.section_metrics) AS metric_rows');
      Object.assign(facts.counts, totals.rows[0]);
      facts.database_checked_at = new Date().toISOString();
      facts.metric_count_basis = 'Recuento verificado en PostgreSQL, incluidos valores NULL en las filas largas.';
    } finally {
      await pool.end();
    }
  }

}
await fs.writeFile(path.join(here, 'facts.json'), JSON.stringify(facts, null, 2) + '\n');
console.log(JSON.stringify({sections: facts.counts.census_sections, fields: facts.counts.fields_per_section, datasets: facts.counts.integrated_local_datasets}));
