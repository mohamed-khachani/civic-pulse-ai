import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAtlasRequest } from "@/lib/server/atlas-api";
import { api } from "@/lib/api";
import { compactCensusMetricsSchema } from "@/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const req = (path: string, init?: RequestInit) =>
  handleAtlasRequest(new Request(`http://atlas.test/api/${path}`, init), path.split("?")[0].split("/"));
const metricPayload = {
  sections: ["2807901001", "2807901002"],
  metrics: [{
    id: "noise", name: "Ruido", unit: "dB", kind: "estimated", source: "Municipal monitoring stations",
    stops: [{ value: 40, color: "#00ff00" }, { value: 70, color: "#ff0000" }], values: [0, null],
  }],
};

describe("Next.js real data gateway", () => {
  it("forwards all supported data routes to Express with query parameters intact", async () => {
    vi.stubEnv("ATLAS_API_BASE_URL", "http://external.test");
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    for (const path of [
      "listings?max_price=1200&furnished=false", "listings/123?result_set_id=search-1", "listings/geo",
      "listings/export", "listings/123/insights", "filters/options", "geo/layers", "geo/districts",
      "geo/census-sections", "geo/census-metrics", "geo/metric-catalog", "geo/census-sections/2807901001/data", "geo/census-sections/2807901001/insights?interaction=click&metric=noise",
    ]) {
      expect((await req(path)).status).toBe(200);
      expect(fetcher).toHaveBeenLastCalledWith(new URL(`http://external.test/api/${path}`), expect.objectContaining({ method: "GET", cache: "no-store" }));
    }
  });
  it("forwards chat context, streams, and request identifiers without logging personal data", async () => {
    vi.stubEnv("ATLAS_API_BASE_URL", "http://external.test");
    const payload = 'event: delta\ndata: {"text":"Hola"}\n\n';
    const fetcher = vi.fn(async () => new Response(payload, { headers: { "content-type": "text/event-stream", "x-request-id": "request-1" } }));
    vi.stubGlobal("fetch", fetcher);
    const body = JSON.stringify({ message: "Cerca de casa de mi familia", filters: {}, selected_listing_id: "123", result_set_id: "search-1" });
    const response = await req("chat", { method: "POST", headers: { "Content-Type": "application/json", "X-Request-Id": "request-1" }, body });
    expect(fetcher).toHaveBeenCalledWith(new URL("http://external.test/api/chat"), expect.objectContaining({ method: "POST", body, headers: expect.objectContaining({ "X-Request-Id": "request-1" }) }));
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(await response.text()).toBe(payload);
  });
  it("preserves backend validation, expired results and CSV download headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "La búsqueda ha caducado." }, { status: 410 })));
    const response = await req("listings?result_set_id=expired");
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "La búsqueda ha caducado." });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("id,title\n1,Piso", { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="listings.csv"' } })));
    expect((await req("listings/export")).headers.get("content-disposition")).toContain("listings.csv");
  });
  it("rejects unsupported routes and proxy loops", async () => {
    expect((await req("unknown")).status).toBe(404);
    expect((await req("listings", { method: "DELETE" })).status).toBe(404);
    expect((await handleAtlasRequest(new Request("http://atlas.test/api/listings"), ["..", "listings"])).status).toBe(404);
    vi.stubEnv("ATLAS_API_BASE_URL", "http://atlas.test");
    expect((await req("listings")).status).toBe(503);
  });
  it("returns an error on upstream failure without switching to fixture data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await req("listings")).status).toBe(502);
  });
  it("decodes ordered metric arrays without losing zeroes or missing values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(metricPayload)));
    const metrics = await api.censusMetrics();
    expect(metrics[0].values).toEqual({ "2807901001": 0, "2807901002": null });
    expect(compactCensusMetricsSchema.safeParse({ ...metricPayload, sections: ["2807901001"] }).success).toBe(false);
    expect(compactCensusMetricsSchema.safeParse({ ...metricPayload, sections: ["2807901001", "2807901001"] }).success).toBe(false);
  });
  it("includes the result set when fetching property-specific assessments", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "123", source: "pisos.com", title: "Piso", price: 1000,
      insights: { metrics: [{ label: "Ruido", value: "53 dB", kind: "estimated", scope: "census" }] },
    }));
    vi.stubGlobal("fetch", fetcher);
    const listing = await api.detail("123", undefined, "search-1");
    expect(listing.insights?.metrics[0].scope).toBe("census");
    expect(fetcher).toHaveBeenCalledWith("/api/listings/123?result_set_id=search-1", expect.any(Object));
  });
});
