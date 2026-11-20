import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "./db.js";
import { chat } from "./chat.js";
import { censusGeometry, mapMetrics, sectionInfo, catalog } from "./census.js";
import { parseSearch, sortSchema } from "./contracts.js";
import {
  csvEscape,
  displayColumns,
  getResultSet,
  joins,
  listRows,
  toListing,
} from "./search.js";
import { HttpError, log } from "./log.js";

export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  const requestId = randomUUID(),
    controller = new AbortController(),
    started = Date.now();
  res.locals.requestId = requestId;
  res.locals.signal = controller.signal;
  res.setHeader("X-Request-Id", requestId);
  req.on("aborted", () => controller.abort());
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  res.on("finish", () =>
    log("http_request", {
      request_id: requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      elapsed_ms: Date.now() - started,
    }),
  );
  next();
});
app.get("/health", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM housing.listings) AS listings,(SELECT count(*)::int FROM madrid.census_sections) AS sections,(SELECT count(*)::int FROM madrid.section_data) AS enriched_sections`,
  );
  res.json({ status: "ok", ...rows[0] });
});
app.post("/api/chat", async (req, res) => {
  const result = await chat(req.body, res.locals.requestId, res.locals.signal);
  res.json(result);
});
app.get("/api/listings", async (req, res) => {
  const filters = parseSearch(req.query);
  const sort = sortSchema.parse(req.query.sort || "recommended");
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(req.query.page || 1);
  const pageSize = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(req.query.page_size || 8);
  const resultId =
    typeof req.query.result_set_id === "string"
      ? req.query.result_set_id
      : undefined;
  const data = await listRows(filters, sort, page, pageSize, resultId);
  res.json({
    listings: data.rows.map((r) =>
      toListing(r, data.result?.assessments?.[r.id]),
    ),
    total: data.total,
    page,
    page_size: pageSize,
    ...(resultId ? { result_set_id: resultId } : {}),
  });
});
app.get("/api/listings/geo", async (req, res) => {
  const filters = parseSearch(req.query),
    result = await getResultSet(
      typeof req.query.result_set_id === "string"
        ? req.query.result_set_id
        : undefined,
    );
  const { buildSearch } = await import("./search.js");
  const query = buildSearch(filters);
  let where = query.where;
  if (result) {
    query.values.push(result.listing_ids);
    where += ` AND l.id::text=ANY($${query.values.length}::text[])`;
  }
  const { rows } = await pool.query(
    `SELECT l.id::text,l.price_amount::float8 AS price,l.latitude,l.longitude ${joins} ${where} AND l.geom IS NOT NULL ORDER BY l.id`,
    query.values,
  );
  res.json({
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
      properties: { id: r.id, price: r.price },
    })),
  });
});
app.get("/api/listings/export", async (req, res) => {
  const filters = parseSearch(req.query),
    sort = sortSchema.parse(req.query.sort || "recommended");
  const data = await listRows(
    filters,
    sort,
    1,
    8,
    typeof req.query.result_set_id === "string"
      ? req.query.result_set_id
      : undefined,
    true,
  );
  const columns = [
    "id",
    "source",
    "url",
    "title",
    "description",
    "price",
    "surface_m2",
    "bedrooms",
    "bathrooms",
    "latitude",
    "longitude",
    "district",
    "neighborhood",
    "furnished",
    "elevator",
    "parking",
    "air_conditioning",
    "terrace",
    "compatibility_score",
  ];
  const rows = data.rows.map((r) => {
    const l: any = toListing(r, data.result?.assessments?.[r.id]);
    return columns
      .map((k) =>
        csvEscape(k === "compatibility_score" ? l.compatibility?.score : l[k]),
      )
      .join(",");
  });
  res
    .type("text/csv; charset=utf-8")
    .setHeader(
      "Content-Disposition",
      'attachment; filename="atlas-listings.csv"',
    );
  res.send("\uFEFF" + [columns.join(","), ...rows].join("\r\n"));
});
app.get("/api/listings/:id", async (req, res) => {
  if (!/^\d+$/.test(req.params.id))
    throw new HttpError(400, "Identificador de vivienda no válido.");
  const { rows } = await pool.query(
    `SELECT ${displayColumns} ${joins} WHERE l.id=$1`,
    [req.params.id],
  );
  if (!rows[0]) throw new HttpError(404, "No se encontró la vivienda.");
  const result = await getResultSet(
    typeof req.query.result_set_id === "string"
      ? req.query.result_set_id
      : undefined,
  );
  res.json(toListing(rows[0], result?.assessments?.[req.params.id]));
});
app.get("/api/listings/:id/insights", async (req, res) => {
  if (!/^\d+$/.test(req.params.id))
    throw new HttpError(400, "Identificador de vivienda no válido.");
  const { rows } = await pool.query(
    `SELECT ${displayColumns} ${joins} WHERE l.id=$1`,
    [req.params.id],
  );
  if (!rows[0]) throw new HttpError(404, "No se encontró la vivienda.");
  const result = await getResultSet(
    typeof req.query.result_set_id === "string"
      ? req.query.result_set_id
      : undefined,
  );
  res.json(toListing(rows[0], result?.assessments?.[req.params.id]).insights);
});
app.get("/api/filters/options", async (_req, res) => {
  const { rows } =
    await pool.query(`SELECT DISTINCT COALESCE(d.name,l.district) AS district,COALESCE(n.name,l.neighborhood) AS neighborhood,l.portal
    FROM housing.listings l LEFT JOIN madrid.census_sections cs ON cs.dataset_id=l.census_dataset_id AND cs.cusec=l.census_section_id
    LEFT JOIN madrid.districts d ON d.municipality_code=cs.municipality_code AND d.code=cs.district_code
    LEFT JOIN madrid.neighborhoods n ON n.municipality_code=cs.municipality_code AND n.code=cs.neighborhood_code WHERE l.transaction_type='rent' AND l.price_amount > 0`);
  res.json({
    districts: [...new Set(rows.map((r) => r.district).filter(Boolean))].sort(),
    neighborhoods: [
      ...new Set(rows.map((r) => r.neighborhood).filter(Boolean)),
    ].sort(),
    sources: [
      ...new Set(
        rows.map((r) => (r.portal === "fotocasa" ? "Fotocasa" : "pisos.com")),
      ),
    ],
    features: [
      "furnished",
      "elevator",
      "parking",
      "air_conditioning",
      "terrace",
    ],
    sorts: [
      "recommended",
      "price_asc",
      "price_desc",
      "surface_desc",
      "compatibility",
      "updated",
    ],
  });
});
app.get("/api/geo/census-sections", async (_req, res) =>
  res.json(await censusGeometry()),
);
app.get("/api/geo/census-metrics", async (_req, res) =>
  res.json(await mapMetrics()),
);
app.get("/api/geo/metric-catalog", async (_req, res) =>
  res.json(await catalog()),
);
app.get("/api/geo/census-sections/:id/insights", async (req, res) => {
  if (!/^28079\d{5}$/.test(req.params.id))
    throw new HttpError(404, "No hay datos enriquecidos para esta sección.");
  const info = await sectionInfo(req.params.id);
  if (!info) throw new HttpError(404, "No se encontró la sección.");
  res.json(info);
});
app.get("/api/geo/census-sections/:id/data", async (req, res) => {
  if (!/^28079\d{5}$/.test(req.params.id))
    throw new HttpError(404, "No hay datos enriquecidos para esta sección.");
  const { rows } = await pool.query(
    `SELECT data FROM madrid.section_data WHERE census_dataset_id='madrid-municipal' AND cusec=$1`,
    [req.params.id],
  );
  if (!rows[0]) throw new HttpError(404, "No se encontró la sección.");
  const columns = Object.keys(rows[0].data).sort();
  res.json({
    columns,
    rows: [[...columns.map((c) => rows[0].data[c])]],
    section_id: req.params.id,
  });
});
app.get("/api/geo/districts", async (_req, res) =>
  res.json(
    (
      await pool.query("SELECT name FROM madrid.districts ORDER BY name")
    ).rows.map((r) => r.name),
  ),
);
app.get("/api/geo/layers", (_req, res) => res.json([]));
app.use((_req, _res, next) => next(new HttpError(404, "Ruta no disponible.")));
app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    let status =
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError ||
            error instanceof SyntaxError ||
            error.message?.startsWith("Invalid") ||
            error.message === "Empty number"
          ? 400
          : 500;
    if (res.locals.signal?.aborted) status = 504;
    const message =
      status === 504
        ? "La consulta ha tardado demasiado. Inténtalo de nuevo."
        : error instanceof HttpError
          ? error.message
          : status === 400
            ? "Parámetros no válidos."
            : "No se pudo completar la consulta. Inténtalo de nuevo.";
    log("http_error", {
      request_id: res.locals.requestId,
      status,
      code: error.code || error.name,
    });
    if (!res.headersSent)
      res.status(status).json({
        error: message,
        code: error.code || "REQUEST_FAILED",
        request_id: res.locals.requestId,
      });
  },
);
