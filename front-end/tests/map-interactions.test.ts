import { describe, it, expect, afterEach } from "vitest";
import { mapHoverTarget } from "@/lib/map-interactions";
import { sectionMetrics } from "@/lib/census";
import { useAtlas } from "@/stores/atlas-store";
import type { CensusMetric } from "@/types";
const initial = useAtlas.getState();
afterEach(() => useAtlas.setState(initial, true));
const section = {
  layer: { id: "census-fill" },
  properties: { id: "2807901001" },
};
const listing = { layer: { id: "prices" }, properties: { id: "listing-1" } };
describe("Map hover priority and analysis mode", () => {
  it("always prioritizes a visible listing over the section beneath it, regardless of hit-test order", () => {
    expect(mapHoverTarget([section, listing], true)).toEqual({
      type: "listing",
      id: "listing-1",
    });
    expect(mapHoverTarget([listing, section], true)).toEqual({
      type: "listing",
      id: "listing-1",
    });
  });
  it("also prioritizes clusters without confusing their identifiers with census sections", () =>
    expect(
      mapHoverTarget(
        [
          section,
          { layer: { id: "clusters" }, properties: { cluster_id: 12 } },
        ],
        true,
      ),
    ).toEqual({ type: "listing", id: undefined }));
  it("allows section hover when listing markers are hidden", () =>
    expect(mapHoverTarget([listing, section], false)).toEqual({
      type: "section",
      id: "2807901001",
    }));
  it("clears hover on empty map space", () =>
    expect(mapHoverTarget([], true)).toBeUndefined());
  it("hides markers without losing search, selection, conversation or the active metric", () => {
    const s = useAtlas.getState();
    s.setFilters({ max_price: 1000 });
    s.select("listing-1");
    s.addMessage({ id: "m", role: "user", content: "hola" });
    s.setCensusMetric("noise");
    s.setListingsVisible(false);
    expect(useAtlas.getState()).toMatchObject({
      filters: { max_price: 1000 },
      selectedId: "listing-1",
      activeCensusMetric: "noise",
      listingsVisible: false,
      messages: [{ id: "m", role: "user", content: "hola" }],
    });
    s.setListingsVisible(true);
    expect(useAtlas.getState().listingsVisible).toBe(true);
  });
  it("turns highlights off entirely without exposing a separate census-only view", () => {
    useAtlas.getState().setCensusMetric("noise");
    useAtlas.getState().selectCensus("2807901001");
    useAtlas.getState().setCensusMetric(undefined);
    expect(useAtlas.getState()).toMatchObject({
      censusVisible: false,
      activeCensusMetric: undefined,
      selectedCensusId: undefined,
    });
  });
  it("shows all section metrics and preserves zero and missing readings independently of the highlighted metric", () => {
    const metrics: CensusMetric[] = ["noise", "air", "population"].map(
      (id, i): CensusMetric => ({
        id,
        name: id,
        unit: "unit",
        kind: "synthetic",
        source: "Test",
        stops: [
          { value: 0, color: "#000000" },
          { value: 100, color: "#ffffff" },
        ],
        values: i === 2 ? {} : { "2807901001": i === 0 ? 55 : 0 },
      }),
    );
    const rows = sectionMetrics(metrics, "2807901001");
    expect(rows.map((r) => r.id)).toEqual(["noise", "air", "population"]);
    expect(rows.map((r) => r.value)).toEqual([55, 0, null]);
  });
});
