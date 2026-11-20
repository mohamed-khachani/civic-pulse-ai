import assert from 'node:assert/strict';

const api = process.env.API_URL || 'http://127.0.0.1:8000';
const web = process.env.WEB_URL || 'http://127.0.0.1:3000';

async function json(base, path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(45000) });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response.json();
}

const query = '/api/listings?max_price=1200&min_bedrooms=2&sort=price_asc&page_size=8';
const [health, direct, forwarded, options, geometry, thematic] = await Promise.all([
  json(api, '/health'),
  json(api, query),
  json(web, query),
  json(web, '/api/filters/options'),
  json(web, '/api/geo/census-sections'),
  json(web, '/api/geo/census-metrics'),
]);

assert.equal(health.status, 'ok');
assert.ok(health.listings > 0 && health.enriched_sections > 0);
assert.equal(direct.total, forwarded.total);
assert.deepEqual(direct.listings.map((listing) => listing.id), forwarded.listings.map((listing) => listing.id));
assert.ok(forwarded.listings.length > 0);
for (const listing of forwarded.listings) {
  assert.ok(listing.price > 0 && listing.price <= 1200);
  assert.ok(listing.bedrooms >= 2);
  assert.ok(['pisos.com', 'Fotocasa'].includes(listing.source));
}
assert.ok(options.sources.length > 0 && !options.sources.includes('demo'));
assert.equal(geometry.type, 'FeatureCollection');
assert.equal(geometry.features.length, health.enriched_sections);
assert.equal(new Set(thematic.sections).size, health.enriched_sections);
assert.ok(thematic.metrics.some((metric) => metric.id.startsWith('air_magnitude_8_')));
assert.ok(thematic.metrics.some((metric) => metric.id.startsWith('noise_laeq_t_')));
for (const metric of thematic.metrics) assert.equal(metric.values.length, thematic.sections.length);

const noise = thematic.metrics.find((metric) => metric.id.startsWith('noise_laeq_t_'));
const index = noise.values.findIndex((value) => value !== null);
assert.ok(index >= 0);
const sectionId = thematic.sections[index];
const firstId = forwarded.listings[0].id;
const [section, full, detail] = await Promise.all([
  json(web, `/api/geo/census-sections/${sectionId}/insights`),
  json(web, `/api/geo/census-sections/${sectionId}/data`),
  json(web, `/api/listings/${firstId}`),
]);
assert.equal(section.id, sectionId);
assert.equal(section.metrics.find((metric) => metric.id === noise.id).value, noise.values[index]);
for (const metric of section.metrics) assert.ok(metric.year === undefined || Number.isInteger(metric.year));
assert.equal(full.rows.length, 1);
assert.equal(full.rows[0].length, full.columns.length);
assert.ok(full.columns.length > 400);
assert.equal(typeof full.rows[0][full.columns.indexOf('section_code')], 'string');
assert.equal(detail.id, firstId);
assert.ok(detail.url.startsWith('https://'));

const invalid = await fetch(web + '/api/listings?max_price=invalid');
assert.equal(invalid.status, 400);
const unsupported = await fetch(web + '/api/not-a-route');
assert.equal(unsupported.status, 404);

console.log(JSON.stringify({
  status: 'passed',
  listings: health.listings,
  census_sections: health.enriched_sections,
  fields_per_section: full.columns.length,
  environmental_metrics: thematic.metrics.length,
  filtered_results: forwarded.total,
  claude_calls: 0,
}, null, 2));
