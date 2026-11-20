import { pool } from "./db.js";
import { HttpError } from "./log.js";
import type { Assessment, Filters, Plan, Sort } from "./contracts.js";

export function searchMetric(id: string) {
  return !/population|padron|poblacion|nacionalidad|migrante|extranj|hombres|mujeres|envejec|dependencia|discapacidad|enfermedad|diabetes|obesidad|salud|autopercepcion|medicamentos|tabaco|sedentarismo|hipertension|sobrepeso|mental|renta_media|renta_neta|pension|paro|desempleo|prestacion|renta_minima/i.test(
    id,
  );
}
export const joins = `FROM housing.listings l
LEFT JOIN madrid.census_sections cs ON cs.dataset_id=l.census_dataset_id AND cs.cusec=l.census_section_id
LEFT JOIN madrid.districts d ON d.municipality_code=cs.municipality_code AND d.code=cs.district_code
LEFT JOIN madrid.neighborhoods n ON n.municipality_code=cs.municipality_code AND n.code=cs.neighborhood_code
LEFT JOIN madrid.section_data sd ON sd.census_dataset_id=cs.dataset_id AND sd.cusec=cs.cusec`;
export const listingColumns = `l.id::text,l.portal,l.url,l.title,l.description,l.property_type,l.price_amount::float8 AS price,
COALESCE(l.built_sqm,l.usable_sqm)::float8 AS surface_m2,l.bedrooms,l.bathrooms,l.latitude,l.longitude,
COALESCE(d.name,l.district) AS district,COALESCE(n.name,l.neighborhood) AS neighborhood,
l.furnished,l.elevator,l.parking,l.air_conditioning,l.terrace,
COALESCE(l.raw_data #> '{media,images}',l.raw_data #> '{media,photos}','[]'::jsonb) AS images,
l.updated_at,l.portal_created_at,l.census_section_id,l.coordinates_exact,sd.data AS area_data`;
export const displayColumns = listingColumns.replace(
  "sd.data AS area_data",
  `jsonb_build_object(
'education_nearest_m',sd.data->'education_nearest_m','health_nearest_m',sd.data->'health_nearest_m',
'parks_nearest_m',sd.data->'parks_nearest_m','section_2024_rent_collective_month_eur_p50',sd.data->'section_2024_rent_collective_month_eur_p50',
'air_nearest_station_distance_m',sd.data->'air_nearest_station_distance_m','noise_nearest_station_distance_m',sd.data->'noise_nearest_station_distance_m') AS area_data,
(SELECT jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'unit',m.unit,'value',sm.value,'source',source.source,'year',source.reference_year,'description',m.description) ORDER BY m.id)
 FROM madrid.section_metrics sm JOIN madrid.metrics m ON m.id=sm.metric_id JOIN madrid.datasets source ON source.id=sm.source_id
 WHERE sm.census_dataset_id=cs.dataset_id AND sm.cusec=cs.cusec AND sm.value IS NOT NULL
 AND (m.id ~ '^noise_laeq_[td]_.*mean' OR m.id ~ '^air_magnitude_8_.*mean')) AS environmental_metrics`,
);
export function buildSearch(
  filters: Filters,
  sort: Sort = "recommended",
  plan?: Plan,
) {
  const values: unknown[] = [];
  const param = (v: unknown) => {
    values.push(v);
    return "$" + values.length;
  };
  const conditions = [
    `l.transaction_type='rent'`,
    `l.price_amount > 0`,
    `(l.price_period IS NULL OR l.price_period='month')`,
  ];
  for (const [key, column, op] of [
    ["min_price", "l.price_amount", ">="],
    ["max_price", "l.price_amount", "<="],
    ["min_bedrooms", "l.bedrooms", ">="],
    ["min_bathrooms", "l.bathrooms", ">="],
    ["min_surface", "COALESCE(l.built_sqm,l.usable_sqm)", ">="],
  ] as const)
    if (filters[key] !== undefined)
      conditions.push(`${column} ${op} ${param(filters[key])}`);
  for (const key of [
    "furnished",
    "elevator",
    "parking",
    "air_conditioning",
    "terrace",
  ] as const)
    if (filters[key] !== undefined)
      conditions.push(`l.${key}=${param(filters[key])}`);
  if (filters.district)
    conditions.push(
      `lower(COALESCE(d.name,l.district,''))=lower(${param(filters.district)})`,
    );
  if (filters.neighborhood)
    conditions.push(
      `cs.dataset_id='madrid-municipal' AND cs.cusec IN (
        SELECT scope.cusec FROM madrid.census_sections scope
        JOIN madrid.neighborhoods neighborhood ON neighborhood.municipality_code=scope.municipality_code AND neighborhood.code=scope.neighborhood_code
        WHERE scope.dataset_id='madrid-municipal' AND lower(neighborhood.name)=lower(${param(filters.neighborhood)})
      )`,
    );
  if (filters.source)
    conditions.push(
      `l.portal=${param(filters.source === "Fotocasa" ? "fotocasa" : "pisoscom")}`,
    );
  if (filters.census_section)
    conditions.push(
      `l.census_section_id=${param(filters.census_section.length === 5 ? "28079" + filters.census_section : filters.census_section)}`,
    );
  if (filters.bounds) {
    const [w, s, e, n] = filters.bounds;
    conditions.push(
      `l.geom && ST_MakeEnvelope(${param(w)},${param(s)},${param(e)},${param(n)},4326)`,
    );
  }
  if (filters.near_metro !== undefined)
    throw new HttpError(
      400,
      "La proximidad al metro todavía no dispone de una medición verificada. Usa la conversación para obtener una estimación.",
      "UNSUPPORTED_FILTER",
    );
  const numericMetric = (id: string) =>
    `CASE WHEN jsonb_typeof(sd.data -> ${param(id)})='number' THEN (sd.data ->> ${param(id)})::float8 END`;
  for (const f of plan?.area_filters || []) {
    if (!searchMetric(f.metric))
      throw new HttpError(
        400,
        "Ese indicador no está disponible para filtrar viviendas.",
      );
    conditions.push(
      `(${numericMetric(f.metric)}) ${f.operator === "lte" ? "<=" : ">="} ${param(f.value)}`,
    );
  }
  const whereValues = [...values];
  const orders: string[] = [];
  if (sort === "recommended" || sort === "compatibility")
    for (const order of [...(plan?.area_order || [])].sort(
      (a, b) => b.weight - a.weight,
    )) {
      if (!searchMetric(order.metric)) continue;
      orders.push(
        `(${numericMetric(order.metric)}) ${order.direction === "desc" ? "DESC" : "ASC"} NULLS LAST`,
      );
    }
  const standard: Record<Sort, string> = {
    recommended: "l.price_amount ASC",
    price_asc: "l.price_amount ASC",
    price_desc: "l.price_amount DESC",
    surface_desc: "COALESCE(l.built_sqm,l.usable_sqm) DESC NULLS LAST",
    compatibility: "l.price_amount ASC",
    updated:
      "COALESCE(l.updated_at,l.published_at,l.portal_created_at::date) DESC NULLS LAST",
  };
  orders.push(standard[sort], "l.id ASC");
  return {
    where: "WHERE " + conditions.join(" AND "),
    order: "ORDER BY " + orders.join(", "),
    values,
    whereValues,
  };
}
export function isRoomListing(row: Record<string, any>): boolean {
  const fold = (value: unknown) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  if (/room|habitacion/.test(fold(row.property_type))) return true;
  const title = fold(row.title),
    text = fold(row.description).slice(0, 1800);
  if (/^(habitacion|room)\b/.test(title)) return true;
  if (
    /piso completo|vivienda completa|no se alquila.{0,20}habitacion/.test(text)
  )
    return false;
  return (
    /(?:alquilo|alquilamos|alquila|alquilan|alquilar|alquiler de)\s+(?:(?:una|la|esta|amplia|bonita|doble|individual)\s+){0,3}habitacion/.test(
      text,
    ) ||
    /habitaciones\s+(?:son\s+|estan\s+)?(?:para alquilar|en alquiler|disponibles)/.test(
      text,
    ) ||
    /habitacion.{0,100}en alquiler|piso compartido|compartir piso|dejo mi habitacion|para una habitacion|alquiler por habitaciones/.test(
      text,
    ) ||
    /^[^a-z]*habitacion\b/.test(text)
  );
}
export function toListing(row: Record<string, any>, assessment?: Assessment) {
  const images = Array.isArray(row.images)
    ? row.images.filter(
        (v: unknown) =>
          typeof v === "string" && /^https?:\/\//.test(v as string),
      )
    : [];
  const metrics: any[] = [];
  for (const [key, label, unit] of [
    ["education_nearest_m", "Centro educativo más cercano", "m"],
    ["health_nearest_m", "Centro sanitario más cercano", "m"],
    ["parks_nearest_m", "Parque más cercano", "m"],
    [
      "section_2024_rent_collective_month_eur_p50",
      "Alquiler de referencia · mediana 2024",
      "€/mes",
    ],
  ]) {
    const v = row.area_data?.[key];
    if (typeof v === "number")
      metrics.push({
        label,
        value: `${Math.round(v)} ${unit}`,
        detail: key.includes("nearest")
          ? "Distancia en línea recta desde el punto representativo de la sección."
          : "Referencia histórica, no precio de mercado actual.",
        kind: key.includes("nearest") ? "estimated" : "observed",
        scope: "census",
      });
  }
  for (const metric of row.environmental_metrics || []) {
    const prefix = metric.id.startsWith("noise_") ? "noise" : "air";
    const distance = row.area_data?.[prefix + "_nearest_station_distance_m"];
    metrics.push({
      label: metric.name,
      value: `${Number(metric.value).toFixed(1)} ${metric.unit}`,
      detail: `Estimación mediante la estación más cercana${typeof distance === "number" ? `, a ${Math.round(distance)} m del punto representativo de la sección` : ""}. Fuente: ${metric.source}${metric.year ? ` (${metric.year})` : ""}. ${metric.description || "No es una medición de exposición dentro de la vivienda."}`,
      kind: "estimated",
      scope: "census",
    });
  }
  for (const route of assessment?.routes || [])
    metrics.push({
      label: `Trayecto a ${route.destination}`,
      value: `≈ ${route.minutes_min}–${route.minutes_max} min`,
      detail: `${route.overview}. ${route.schedule}. Estimación de Claude sin horarios ni rutas verificados.`,
      kind: "estimated",
      scope: "listing",
    });
  const updated = row.updated_at || row.portal_created_at;
  return {
    id: String(row.id),
    source: row.portal === "fotocasa" ? "Fotocasa" : "pisos.com",
    url: row.url,
    title: row.title || "Vivienda en alquiler",
    description: row.description,
    price: Number(row.price),
    surface_m2: row.surface_m2,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    latitude: row.latitude,
    longitude: row.longitude,
    district: row.district,
    neighborhood: row.neighborhood,
    images,
    furnished: row.furnished,
    elevator: row.elevator,
    parking: row.parking,
    air_conditioning: row.air_conditioning,
    terrace: row.terrace,
    ...(updated ? { updated_at: new Date(updated).toISOString() } : {}),
    ...(assessment && assessment.score >= 0
      ? {
          compatibility: {
            score: assessment.score,
            explanation: assessment.reasons,
          },
        }
      : {}),
    insights: {
      metrics,
      note: row.census_section_id
        ? "Información vinculada a la sección censal; los datos pueden corresponder a distintos años."
        : "No se ha podido asignar una sección censal a estas coordenadas.",
    },
  };
}
export async function getResultSet(id?: string) {
  if (!id) return undefined;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new HttpError(400, "Identificador de resultados no válido.");
  const { rows } = await pool.query(
    "SELECT * FROM housing.result_sets WHERE id=$1 AND expires_at>now()",
    [id],
  );
  if (!rows[0])
    throw new HttpError(
      410,
      "La búsqueda ha caducado. Envía tu consulta de nuevo.",
      "RESULT_SET_EXPIRED",
    );
  return rows[0];
}
export async function listRows(
  filters: Filters,
  sort: Sort,
  page: number,
  pageSize: number,
  resultSetId?: string,
  all = false,
) {
  const result = await getResultSet(resultSetId);
  const query = buildSearch(filters, sort);
  let where = query.where;
  const values = query.values;
  if (result) {
    values.push(result.listing_ids);
    where += ` AND l.id::text=ANY($${values.length}::text[])`;
  }
  let order = query.order;
  if (result && (sort === "recommended" || sort === "compatibility")) {
    values.push(result.listing_ids);
    order = `ORDER BY array_position($${values.length}::text[],l.id::text)`;
  }
  const countValues =
    result && (sort === "recommended" || sort === "compatibility")
      ? values.slice(0, -1)
      : values;
  const count = await pool.query(
    `SELECT count(*)::int AS total ${joins} ${where}`,
    countValues,
  );
  let limit = "";
  if (!all) {
    values.push(pageSize, (page - 1) * pageSize);
    limit = `LIMIT $${values.length - 1} OFFSET $${values.length}`;
  }
  const data = await pool.query(
    `SELECT ${displayColumns} ${joins} ${where} ${order} ${limit}`,
    values,
  );
  return { rows: data.rows, total: count.rows[0].total, result };
}
export function csvEscape(v: unknown) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}
