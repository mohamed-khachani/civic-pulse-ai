import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAtlasRequest, getCensusSnapshot } from "@/lib/server/atlas-api";
import { api } from "@/lib/api";
import { censusSectionInfoSchema } from "@/types";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function demo() {
  vi.stubEnv("NEXT_PUBLIC_USE_MOCK_API", "true");
  vi.stubEnv("NEXT_PUBLIC_MOCK_LATENCY_MS", "0");
}
const req = (path: string, init?: RequestInit) =>
  handleAtlasRequest(
    new Request(`http://atlas.test/api/${path}`, init),
    path.split("?")[0].split("/"),
  );
describe("Next.js data gateway", () => {
  it("routes every client data method through same-origin Next.js API handlers, including mock mode", async () => {
    demo();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        paths.push(input);
        expect(input.startsWith("/api/")).toBe(true);
        return handleAtlasRequest(
          new Request("http://atlas.test" + input, init),
          input.split("?")[0].slice(5).split("/"),
        );
      }),
    );
    const listings = await api.listings({ max_price: 1000 }, "price_asc");
    expect(listings.listings.every((l) => l.price <= 1000)).toBe(true);
    await api.detail(listings.listings[0].id);
    await api.geo({ max_price: 1000 });
    await api.options();
    await api.layers();
    const census = await api.census();
    expect(census.features).toHaveLength(4518);
    await api.censusMetrics();
    const detail = await api.censusSection(
      census.features[0].properties.id,
      "hover",
      "noise",
    );
    expect(detail.metrics).toHaveLength(3);
    await api.chat({
      message: "2 habitaciones por menos de 1000 €",
      filters: {},
    });
    const csv = await api.export({ max_price: 1000 }, "price_asc");
    expect((await csv.text()).includes("source,url,title")).toBe(true);
    expect(paths).toHaveLength(10);
    expect(
      paths.some((p) => p.includes("/insights?interaction=hover&metric=noise")),
    ).toBe(true);
  });
  it("returns compact per-section data and logs hover/click context server-side", async () => {
    demo();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const id = (await getCensusSnapshot()).features[0].properties.id;
    const response = await req(
      `geo/census-sections/${id}/insights?interaction=click&metric=air`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(censusSectionInfoSchema.safeParse(body).success).toBe(true);
    expect(body.metrics[0]).not.toHaveProperty("values");
    expect(body.metrics[0]).not.toHaveProperty("stops");
    expect(log).toHaveBeenCalledWith(
      "[Atlas API] census section reached",
      JSON.stringify({ section_id: id, interaction: "click", metric: "air" }),
    );
  });
  it("rejects unknown routes, invalid filters and malformed chat bodies", async () => {
    demo();
    expect((await req("unknown")).status).toBe(404);
    expect((await req("listings?max_price=invalid")).status).toBe(400);
    expect((await req("listings?furnished=unknown")).status).toBe(400);
    expect(
      (
        await req("chat", {
          method: "POST",
          body: JSON.stringify({ message: "" }),
        })
      ).status,
    ).toBe(400);
  });
  it("forwards production requests server-side with query parameters intact", async () => {
    vi.stubEnv("NEXT_PUBLIC_USE_MOCK_API", "false");
    vi.stubEnv("ATLAS_API_BASE_URL", "http://external.test");
    const fetcher = vi.fn(async () =>
      Response.json({ listings: [], total: 0, page: 1, page_size: 8 }),
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await req("listings?max_price=1200&furnished=false");
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        "http://external.test/api/listings?max_price=1200&furnished=false",
      ),
      expect.objectContaining({ method: "GET" }),
    );
  });
  it("preserves streamed chat responses through the gateway", async () => {
    vi.stubEnv("NEXT_PUBLIC_USE_MOCK_API", "false");
    vi.stubEnv("ATLAS_API_BASE_URL", "http://external.test");
    const payload = 'event: delta\ndata: {"text":"Hola"}\n\n';
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(payload, {
            headers: { "content-type": "text/event-stream" },
          }),
      ),
    );
    const response = await req("chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe(payload);
  });
  it("returns a clear error for upstream failure rather than silently replacing it with fixtures", async () => {
    vi.stubEnv("NEXT_PUBLIC_USE_MOCK_API", "false");
    vi.stubEnv("ATLAS_API_BASE_URL", "http://external.test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect((await req("listings")).status).toBe(502);
  });
});
