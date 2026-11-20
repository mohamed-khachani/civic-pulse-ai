import { afterEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { serializeFilters, filterListings } from "@/lib/search";
import { escapeCsv, toCsv, csvColumns } from "@/lib/csv";
import { mapActionSchema, listingSchema, chatResponseSchema } from "@/types";
import { mockListings } from "./fixtures/data";
import { mockApi, parseMockFilters } from "./fixtures/adapter";
import { viewportCamera, metricRange } from "@/lib/map";
import { useAtlas } from "@/stores/atlas-store";
const initial = useAtlas.getState();
afterEach(() => useAtlas.setState(initial, true));
describe("Search contracts", () => {
  it("serializes zero, false, Unicode, and bounds without undefined", () => {
    const p = new URLSearchParams(
      serializeFilters({
        max_price: 0,
        furnished: false,
        district: "Chamberí",
        bounds: [-4, 40, -3, 41],
        min_price: undefined,
      }),
    );
    expect(p.get("max_price")).toBe("0");
    expect(p.get("furnished")).toBe("false");
    expect(p.get("district")).toBe("Chamberí");
    expect(p.get("bounds")).toBe("-4,40,-3,41");
    expect(p.has("min_price")).toBe(false);
  });
  it("filters on price, bedrooms, features, and explicit bounds", () => {
    const found = filterListings(mockListings, {
      max_price: 1000,
      min_bedrooms: 2,
      furnished: true,
    });
    expect(found.length).toBeGreaterThan(0);
    expect(
      found.every((l) => l.price <= 1000 && l.bedrooms! >= 2 && l.furnished),
    ).toBe(true);
    expect(filterListings(mockListings, { bounds: [0, 0, 1, 1] })).toEqual([]);
  });
  it("returns empty results for impossible searches", () =>
    expect(filterListings(mockListings, { max_price: 1 })).toEqual([]));
  it("keeps missing fields and false distinct", () => {
    const l = listingSchema.parse({
      id: "x",
      title: "Piso",
      price: 900,
      source: "pisos.com",
      furnished: false,
    });
    expect(l.images).toEqual([]);
    expect(l.furnished).toBe(false);
    expect(l.elevator).toBeUndefined();
    expect(filterListings([l], { min_bedrooms: 1 })).toEqual([]);
  });
  it("parses Spanish numbers and follow-up constraints", () => {
    expect(
      parseMockFilters("2 habitaciones por menos de 1.200 €", {}),
    ).toMatchObject({ max_price: 1200, min_bedrooms: 2 });
    expect(
      parseMockFilters("Solo amueblados", { max_price: 1000 }),
    ).toMatchObject({ max_price: 1000, furnished: true });
  });
  it("validates all supported map actions and rejects unsafe input", () => {
    expect(
      mapActionSchema.safeParse({
        type: "set_viewport",
        viewport: { latitude: 1000, longitude: 0, zoom: 12 },
      }).success,
    ).toBe(false);
    expect(
      mapActionSchema.safeParse({ type: "eval", code: "alert(1)" }).success,
    ).toBe(false);
    for (const a of [
      { type: "none" },
      { type: "fit_results" },
      { type: "focus_listing", listing_id: "demo-1" },
      { type: "focus_area", bounds: [-4, 40, -3, 41] },
      {
        type: "set_viewport",
        viewport: { latitude: 40.4, longitude: -3.7, zoom: 12 },
      },
    ])
      expect(mapActionSchema.safeParse(a).success).toBe(true);
  });
});
describe("Shared state", () => {
  it("preserves search, sort, messages, and selection between modes", () => {
    const s = useAtlas.getState();
    s.setFilters({ max_price: 1200 });
    s.setSort("price_asc");
    s.select("demo-1");
    s.addMessage({ id: "1", role: "user", content: "hola" });
    s.setMode("map");
    s.setMode("chat");
    const next = useAtlas.getState();
    expect(next.filters.max_price).toBe(1200);
    expect(next.sort).toBe("price_asc");
    expect(next.selectedId).toBe("demo-1");
    expect(next.messages).toHaveLength(1);
  });
  it("applies chat actions to the same filters as manual controls", () => {
    const s = useAtlas.getState();
    s.applyChat(s.searchRevision, {
      filters: { max_price: 1000 },
      conversation_id: "c",
      suggestions: [],
      map_action: { type: "fit_results" },
    });
    expect(useAtlas.getState().filters.max_price).toBe(1000);
    expect(useAtlas.getState().mapAction?.type).toBe("fit_results");
  });
  it("ignores stale chat filter changes after manual changes", () => {
    const old = useAtlas.getState().searchRevision;
    useAtlas.getState().setFilters({ max_price: 900 });
    const applied = useAtlas.getState().applyChat(old, {
      filters: { max_price: 1500 },
      conversation_id: "c",
      suggestions: [],
    });
    expect(applied).toBe(false);
    expect(useAtlas.getState().filters.max_price).toBe(900);
  });
  it("isolates late search responses by query key", async () => {
    const q = new QueryClient();
    let resolve!: (n: number) => void;
    const old = q.fetchQuery({
      queryKey: ["listings", { max_price: 1500 }],
      queryFn: () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
    });
    await q.fetchQuery({
      queryKey: ["listings", { max_price: 900 }],
      queryFn: async () => 2,
    });
    resolve(24);
    await old;
    expect(q.getQueryData(["listings", { max_price: 900 }])).toBe(2);
    q.clear();
  });
});
describe("Export", () => {
  it("escapes quotes, commas, newlines and neutralizes spreadsheet formulas", () => {
    expect(escapeCsv('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(escapeCsv('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(escapeCsv(false)).toBe("false");
    expect(escapeCsv(undefined)).toBe("");
  });
  it("maps optional columns without inventing values, and includes BOM", () => {
    const csv = toCsv([
      {
        id: "x",
        title: "Piso",
        price: 900,
        source: "pisos.com",
        images: [],
        furnished: false,
      },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const rows = csv.slice(1).split("\r\n");
    expect(rows[0]).toBe(csvColumns.join(","));
    expect(rows[1].split(",")[csvColumns.indexOf("furnished")]).toBe("false");
    expect(rows[1].split(",")[csvColumns.indexOf("compatibility_score")]).toBe(
      "",
    );
  });
  it("exports the entire filtered set beyond the current page", async () => {
    const filters = { max_price: 1200 };
    const page = await mockApi.listings(filters, "price_asc");
    const blob = await mockApi.export(filters, "price_asc");
    const rows = (await blob.text()).replace(/^\uFEFF/, "").split("\r\n");
    expect(page.total).toBeGreaterThan(page.listings.length);
    expect(rows.length - 1).toBe(page.total);
  });
  it("mock responses conform to the production contract", async () => {
    const response = await mockApi.chat({
      message: "2 habitaciones por menos de 1.200 €",
      filters: {},
    });
    expect(chatResponseSchema.safeParse(response).success).toBe(true);
  });
});

describe("Map coordinates and source metrics", () => {
  it("converts a viewport to a MapLibre center in longitude/latitude order", () =>
    expect(
      viewportCamera({ latitude: 40.4, longitude: -3.7, zoom: 12 }),
    ).toEqual({ center: [-3.7, 40.4], zoom: 12 }));
  it("uses measured ranges rather than a fabricated score scale", () =>
    expect(
      metricRange({
        id: "x",
        name: "Noise",
        available: true,
        metric: "db",
        geojson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-3.7, 40.4] },
              properties: { db: 42 },
            },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-3.6, 40.4] },
              properties: { db: 68 },
            },
          ],
        },
      }),
    ).toEqual([42, 68]));
  it("replaces filters when the assistant explicitly clears them", () => {
    const s = useAtlas.getState();
    s.setFilters({ max_price: 1000 });
    const revision = useAtlas.getState().searchRevision;
    useAtlas.getState().applyChat(revision, {
      filters: {},
      filters_mode: "replace",
      conversation_id: "c",
      suggestions: [],
    });
    expect(useAtlas.getState().filters).toEqual({});
  });
});
