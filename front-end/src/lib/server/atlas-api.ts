import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  filtersSchema,
  censusCollectionSchema,
  censusSectionInfoSchema,
  type CensusCollection,
  type SortOrder,
} from "@/types";
import { sectionMetrics } from "@/lib/census";
import { mockApi } from "@/lib/mock/adapter";
import { mockCensusMetrics } from "@/lib/mock/census";
const demo = () =>
  process.env.NEXT_PUBLIC_USE_MOCK_API === "true" ||
  (process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_USE_MOCK_API === undefined);
const sortSchema = z.enum([
  "recommended",
  "price_asc",
  "price_desc",
  "surface_desc",
  "compatibility",
  "updated",
]);
const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation_id: z.string().optional(),
  filters: filtersSchema,
  selected_listing_id: z.string().optional(),
  result_set_id: z.string().optional(),
});
let censusSnapshot: Promise<CensusCollection> | undefined;
export function getCensusSnapshot() {
  return (censusSnapshot ??= readFile(
    join(process.cwd(), "public/geo/madrid-census-2025.geojson"),
    "utf8",
  ).then((text) => censusCollectionSchema.parse(JSON.parse(text))));
}
function parseSearch(params: URLSearchParams) {
  const numeric = new Set([
    "min_price",
    "max_price",
    "min_bedrooms",
    "min_bathrooms",
    "min_surface",
  ]);
  const booleans = new Set([
    "furnished",
    "elevator",
    "parking",
    "air_conditioning",
    "terrace",
    "near_metro",
  ]);
  const raw: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (numeric.has(key)) raw[key] = Number(value);
    else if (booleans.has(key)) {
      if (value !== "true" && value !== "false")
        throw new Error("INVALID_FILTER");
      raw[key] = value === "true";
    } else if (key === "bounds") raw[key] = value.split(",").map(Number);
    else raw[key] = value;
  }
  const parsed = filtersSchema.safeParse(raw);
  if (!parsed.success) throw new Error("INVALID_FILTER");
  return parsed.data;
}
const supported = (path: string, method: string) =>
  method === "POST"
    ? path === "chat"
    : method === "GET" &&
      /^(listings(\/(geo|export|[^/]+)(\/insights)?)?|filters\/options|geo\/(layers|districts|census-metrics|census-sections(\/28\d{8}\/insights)?))$/.test(
        path,
      );
export async function handleAtlasRequest(
  request: Request,
  segments: string[],
): Promise<Response> {
  if (
    segments.some((part) => part === "." || part === ".." || part.includes("/"))
  )
    return Response.json({ error: "Ruta no disponible." }, { status: 404 });
  const path = segments.join("/"),
    url = new URL(request.url);
  if (!supported(path, request.method))
    return Response.json({ error: "Ruta no disponible." }, { status: 404 });
  const sectionMatch = path.match(
    /^geo\/census-sections\/(28\d{8})\/insights$/,
  );
  if (sectionMatch)
    console.log(
      "[Atlas API] census section reached",
      JSON.stringify({
        section_id: sectionMatch[1],
        interaction: url.searchParams.get("interaction") ?? "hover",
        metric: url.searchParams.get("metric"),
      }),
    );
  try {
    // Public geometry has an explicit local snapshot unless a server-side override is configured.
    if (path === "geo/census-sections") {
      const geometryUrl =
        process.env.ATLAS_CENSUS_GEOJSON_URL ??
        process.env.NEXT_PUBLIC_CENSUS_GEOJSON_URL;
      if (!geometryUrl) return Response.json(await getCensusSnapshot());
      const response = await fetch(geometryUrl, { signal: request.signal });
      if (!response.ok)
        return Response.json(
          { error: "No se pudo cargar la cartografía." },
          { status: 502 },
        );
      return Response.json(censusCollectionSchema.parse(await response.json()));
    }
    if (!demo()) return await proxy(request, path, url.search);
    const signal = request.signal;
    if (path === "chat")
      return Response.json(
        await mockApi.chat(
          chatRequestSchema.parse(await request.json()),
          signal,
        ),
      );
    if (path === "geo/census-metrics")
      return Response.json(mockCensusMetrics(await getCensusSnapshot()));
    if (sectionMatch) {
      const sections = await getCensusSnapshot(),
        id = sectionMatch[1];
      const section = sections.features.find((f) => f.properties.id === id);
      if (!section)
        return Response.json(
          { error: "Sección no encontrada." },
          { status: 404 },
        );
      // Integration point: replace this fixture lookup with your section/environment service.
      return Response.json(
        censusSectionInfoSchema.parse({
          id,
          municipality: section.properties.municipality,
          metrics: sectionMetrics(mockCensusMetrics(sections), id),
        }),
      );
    }
    if (path === "filters/options")
      return Response.json(await mockApi.options(signal));
    if (path === "geo/layers")
      return Response.json(await mockApi.layers(signal));
    if (path === "geo/districts")
      return Response.json((await mockApi.options(signal)).districts);
    if (
      path === "listings" ||
      path === "listings/geo" ||
      path === "listings/export"
    ) {
      const filters = parseSearch(url.searchParams);
      const sort: SortOrder = sortSchema.parse(
        url.searchParams.get("sort") ?? "recommended",
      );
      if (path === "listings/geo")
        return Response.json(await mockApi.geo(filters, signal));
      if (path === "listings/export")
        return new Response(await mockApi.export(filters, sort, signal), {
          headers: { "Content-Type": "text/csv; charset=utf-8" },
        });
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .parse(url.searchParams.get("page") ?? 1);
      return Response.json(await mockApi.listings(filters, sort, page, signal));
    }
    const listing = path.match(/^listings\/([^/]+)(\/insights)?$/);
    if (listing) {
      const result = await mockApi.detail(
        decodeURIComponent(listing[1]),
        signal,
      );
      return Response.json(listing[2] ? result.insights : result);
    }
    return Response.json({ error: "Ruta no disponible." }, { status: 404 });
  } catch (error) {
    if (
      error instanceof z.ZodError ||
      error instanceof SyntaxError ||
      (error instanceof Error && error.message === "INVALID_FILTER")
    )
      return Response.json(
        { error: "Parámetros no válidos." },
        { status: 400 },
      );
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[Atlas API] request failed", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "No se pudieron consultar los datos. Inténtalo de nuevo." },
      { status: 502 },
    );
  }
}
async function proxy(request: Request, path: string, search: string) {
  const base = (
    process.env.ATLAS_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:8000"
  ).replace(/\/$/, "");
  const target = new URL(`${base}/api/${path}${search}`);
  if (target.origin === new URL(request.url).origin)
    return Response.json(
      {
        error:
          "La API externa no puede apuntar a estas mismas rutas de Next.js.",
      },
      { status: 503 },
    );
  const configured = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 90000);
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(
      Number.isFinite(configured)
        ? Math.max(1000, Math.min(300000, configured))
        : 90000,
    ),
  ]);
  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      Accept: request.headers.get("accept") ?? "application/json",
      ...(request.method === "POST"
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: request.method === "POST" ? await request.text() : undefined,
    signal,
    cache: "no-store",
  });
  // Forward the stream as-is, including SSE chat responses and CSV exports.
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    "Cache-Control": "no-store",
  });
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("Content-Disposition", disposition);
  return new Response(upstream.body, { status: upstream.status, headers });
}
