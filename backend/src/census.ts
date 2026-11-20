import { pool } from "./db.js";
import { searchMetric } from "./search.js";
export type Metric = {
  id: string;
  name: string;
  unit: string;
  scope: string;
  description: string | null;
  source: string;
  year: number | null;
  kind: "observed" | "estimated";
};
let catalogCache: { until: number; metrics: Metric[] } | undefined;
export function environmentalMetric(id: string) {
  return /^air_magnitude_(8|9|10|14)_\d{4}_nearest_station_daily_mean$/.test(id)
    || /^noise_laeq_(t|n)_\d{4}_nearest_station_db_energy_mean$/.test(id);
}
export async function catalog(): Promise<Metric[]> {
  if (catalogCache && catalogCache.until > Date.now())
    return catalogCache.metrics;
  const { rows } =
    await pool.query(`SELECT DISTINCT ON (m.id) m.id,m.name,m.unit,m.scope,m.description,d.source AS source,d.reference_year AS year,sm.kind
    FROM madrid.metrics m JOIN madrid.section_metrics sm ON sm.metric_id=m.id
    JOIN madrid.datasets d ON d.id=sm.source_id ORDER BY m.id,d.reference_year DESC NULLS LAST`);
  catalogCache = { until: Date.now() + 30000, metrics: rows };
  return rows;
}
export async function sectionInfo(id: string) {
  const section = await pool.query(
    `SELECT municipality_code FROM madrid.census_sections WHERE cusec=$1 AND dataset_id='madrid-municipal'`,
    [id],
  );
  if (!section.rowCount) return null;
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (m.id) m.id,m.name,m.unit,sm.value,sm.kind,d.source AS source,m.description,d.reference_year AS year
    FROM madrid.section_metrics sm JOIN madrid.metrics m ON m.id=sm.metric_id JOIN madrid.datasets d ON d.id=sm.source_id
    WHERE sm.cusec=$1 AND sm.census_dataset_id='madrid-municipal'
      AND m.id = ANY($2::text[]) ORDER BY m.id,d.reference_year DESC NULLS LAST`,
    [id, (await catalog()).filter((m) => environmentalMetric(m.id)).map((m) => m.id)],
  );
  return {
    id,
    municipality: "Madrid",
    metrics: rows.map(({ year, description, ...metric }) => ({
      ...metric,
      ...(year === null ? {} : { year }),
      ...(description === null ? {} : { description }),
    })),
  };
}
export async function censusGeometry() {
  const { rows } =
    await pool.query(`SELECT jsonb_build_object('type','FeatureCollection','features',jsonb_agg(jsonb_build_object(
    'type','Feature','id',s.cusec,'geometry',ST_AsGeoJSON(s.geom)::jsonb,
    'properties',jsonb_build_object('id',s.cusec,'municipality','Madrid','population',sd.data->'population_total')) ORDER BY s.cusec)) AS data
    FROM madrid.census_sections s LEFT JOIN madrid.section_data sd ON sd.cusec=s.cusec AND sd.census_dataset_id=s.dataset_id WHERE s.dataset_id='madrid-municipal'`);
  return rows[0].data;
}
export async function mapMetrics() {
  const all = await catalog();
  const selected = all.filter((m) => environmentalMetric(m.id));
  const { rows: sections } = await pool.query(
    `SELECT cusec FROM madrid.census_sections WHERE dataset_id='madrid-municipal' ORDER BY cusec`,
  );
  const ids = sections.map((r) => r.cusec as string);
  const { rows } = selected.length
    ? await pool.query(
        `SELECT DISTINCT ON (cusec,metric_id) cusec,metric_id,value FROM madrid.section_metrics WHERE census_dataset_id='madrid-municipal' AND metric_id=ANY($1::text[]) ORDER BY cusec,metric_id,source_id`,
        [selected.map((m) => m.id)],
      )
    : { rows: [] };
  const lookup = new Map(
    rows.map((r) => [r.metric_id + ":" + r.cusec, r.value]),
  );
  return {
    sections: ids,
    metrics: selected.map((m) => {
      const values = ids.map((id) => lookup.get(m.id + ":" + id) ?? null);
      const finite = values
        .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
        .sort((a, b) => a - b);
      const low = finite[0] ?? 0;
      const high = finite.at(-1) ?? 1;
      const max = high > low ? high : low + 1;
      return {
        ...m,
        description: m.description || undefined,
        year: m.year ?? undefined,
        stops: [
          { value: low, color: "#c9e8d4" },
          { value: low + (max - low) / 2, color: "#f3d67a" },
          { value: max, color: "#dd7a65" },
        ],
        values,
      };
    }),
  };
}
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export async function areaContext(
  message: string,
  previous?: {
    area_filters?: { metric: string }[];
    area_order?: { metric: string }[];
  },
  geography: { neighborhood?: string; district?: string } = {},
) {
  const all = (await catalog()).filter((m) => searchMetric(m.id));
  const text = fold(message);
  const tokens = text.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const patterns: string[] = [];
  if (/ruido|tranquil|silenc|noise|quiet/.test(text))
    patterns.push("noise_laeq");
  if (/aire|contamin|air|pollut/.test(text))
    patterns.push("air_magnitude_8", "air_magnitude_10", "air_magnitude_1");
  if (/parque|verde|jardin|park/.test(text)) patterns.push("parks_");
  if (/coleg|escuel|educ|school/.test(text)) patterns.push("education_");
  if (/salud|hospital|medic|health/.test(text)) patterns.push("health_");
  if (/deport|gimnas|sport/.test(text)) patterns.push("sports_");
  if (/trafico|traffic/.test(text)) patterns.push("traffic_");
  if (/biblioteca|librar/.test(text)) patterns.push("libraries_");
  const wantsCoverage =
    /cobertura|observaciones|dias validos|coverage|samples/.test(text);
  const required = new Set(
    [...(previous?.area_filters || []), ...(previous?.area_order || [])].map(
      (m) => m.metric,
    ),
  );
  const ranked = all
    .map((m) => ({
      m,
      score:
        (required.has(m.id) ? 100 : 0) +
        patterns.filter((p) => m.id.startsWith(p)).length * 30 +
        (patterns.length === 0
          ? tokens.filter((w) => fold(m.name + " " + m.id).includes(w)).length
          : 0),
    }))
    .filter(
      (x) =>
        x.score > 0 &&
        (wantsCoverage ||
          !/valid_days|observations|sample_count|nearest_station_id|nearest_station_distance_m/.test(
            x.m.id,
          )),
    )
    .sort((a, b) => b.score - a.score || a.m.id.localeCompare(b.m.id));
  const selected: Metric[] = [];
  const add = (metric: Metric | undefined) => {
    if (
      metric &&
      !selected.some((m) => m.id === metric.id) &&
      selected.length < 8
    )
      selected.push(metric);
  };
  for (const id of required) add(all.find((m) => m.id === id));
  // Give each requested topic its useful measurements before adding counts/coverage fields.
  const priorities: [boolean, RegExp[]][] = [
    [
      /ruido|tranquil|silenc|noise|quiet/.test(text),
      [/^noise_laeq_t_.*mean/, /^noise_laeq_n_.*mean/],
    ],
    [
      /aire|contamin|air|pollut/.test(text),
      [/^air_magnitude_8_.*mean/, /^air_magnitude_10_.*mean/],
    ],
    [
      /parque|verde|jardin|park/.test(text),
      [/^parks_nearest_m$/, /^parks_count_500m$/],
    ],
    [
      /coleg|escuel|educ|school/.test(text),
      [/^education_nearest_m$/, /^education_count_500m$/],
    ],
    [
      /salud|hospital|medic|health/.test(text),
      [/^health_nearest_m$/, /^health_count_500m$/],
    ],
    [/deport|gimnas|sport/.test(text), [/^sports_nearest_m$/]],
    [/trafico|traffic/.test(text), [/^traffic_.*mean_reported_intensity/]],
  ];
  for (const [wanted, patterns] of priorities)
    if (wanted)
      for (const pattern of patterns) add(all.find((m) => pattern.test(m.id)));
  for (const { m } of ranked) add(m);
  const { rows } = await pool.query(
    `SELECT sd.cusec,jsonb_build_object('district_code',sd.data->'district_code','barrio_code',sd.data->'barrio_code')
      || COALESCE((SELECT jsonb_object_agg(key,sd.data->key) FROM unnest($3::text[]) AS key),'{}'::jsonb) AS data
      FROM madrid.section_data sd
      JOIN madrid.census_sections cs ON cs.dataset_id=sd.census_dataset_id AND cs.cusec=sd.cusec
      LEFT JOIN madrid.neighborhoods n ON n.municipality_code=cs.municipality_code AND n.code=cs.neighborhood_code
      LEFT JOIN madrid.districts d ON d.municipality_code=cs.municipality_code AND d.code=cs.district_code
      WHERE sd.census_dataset_id='madrid-municipal'
      AND ($1::text IS NULL OR lower(n.name)=lower($1))
      AND ($2::text IS NULL OR lower(d.name)=lower($2)) ORDER BY sd.cusec`,
    [geography.neighborhood || null, geography.district || null, selected.map((m) => m.id)],
  );
  const groups = new Map<string, { ids: string[]; values: unknown[] }>();
  if (selected.length) for (const row of rows) {
    const values = [row.data.district_code, row.data.barrio_code, ...selected.map((m) => compactNumber(row.data[m.id]))];
    const key = JSON.stringify(values);
    const group = groups.get(key);
    if (group) group.ids.push(row.cusec);
    else groups.set(key, { ids: [row.cusec], values });
  }
  return {
    section_count: rows.length,
    geography,
    available_metrics: all.filter((m) => selected.some((item) => item.id === m.id) || /nearest_m$|count_500m$/.test(m.id) || environmentalMetric(m.id)).map((m) => [m.id, m.name, m.unit, m.scope]),
    columns: [
      "cusecs",
      "district_code",
      "neighborhood_code",
      ...selected.map((m) => m.id),
    ],
    metric_metadata: selected.map((m) => [
      m.id,
      m.name,
      m.unit,
      m.scope,
      m.kind,
      m.year,
      m.description,
    ]),
    rows: [...groups.values()].map((group) => [group.ids, ...group.values]),
    selected,
  };
}

export function compactNumber(value: unknown): unknown {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : (value ?? null);
}
