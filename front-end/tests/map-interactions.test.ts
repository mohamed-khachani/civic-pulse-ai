import { describe, it, expect, afterEach } from "vitest";
import { mapHoverTarget, listingMembers, overlappingListings, listingGroupAnchor } from "@/lib/map-interactions";
import { sectionMetrics } from "@/lib/census";
import { useAtlas } from "@/stores/atlas-store";
import type { CensusMetric, ListingGeoFeature } from "@/types";
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
        kind: "estimated",
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

const point = (id: string, x: number, y: number): ListingGeoFeature => ({
  type: "Feature", geometry: { type: "Point", coordinates: [x, y] }, properties: { id, price: 1000 },
});
describe("Map groups and hidden price markers", () => {
  it("centers a group at the middle of the map and grows inward near an edge", () => {
    expect(listingGroupAnchor({ x: 425, y: 310 }, 850, 620)).toBe("center");
    expect(listingGroupAnchor({ x: 30, y: 30 }, 850, 620)).toBe("top-left");
    expect(listingGroupAnchor({ x: 820, y: 590 }, 850, 620)).toBe("bottom-right");
  });
  it("keeps every co-located cluster listing while deduplicating repeated IDs", () => {
    const points = Array.from({ length: 60 }, (_, index) => point(String(index), 10, 10));
    const members = listingMembers([...points, points[0], { type: "Feature", geometry: { type: "Point", coordinates: [10, 10] }, properties: { cluster_id: 7 } }]);
    expect(members).toHaveLength(60);
    expect(new Set(members.map((feature) => feature.properties.id)).size).toBe(60);
    expect(members.every((feature) => feature.geometry.coordinates[0] === 10)).toBe(true);
  });
  it("finds hidden co-located and nearby points even when only one symbol was rendered", () => {
    const points = [point("hidden", 100, 100), point("nearby", 130, 115), point("clicked", 100, 100), point("far-east", 160, 100), point("far-south", 100, 130)];
    expect(overlappingListings(points, "clicked", ([x, y]) => ({ x, y })).map((feature) => feature.properties.id)).toEqual(["clicked", "hidden", "nearby"]);
  });
  it("uses screen coordinates at the current zoom, and never pulls distant labels into the group", () => {
    const points = [point("clicked", 0, 0), point("other", 1, 0)];
    expect(overlappingListings(points, "clicked", ([x, y]) => ({ x: x * 30, y })).length).toBe(2);
    expect(overlappingListings(points, "clicked", ([x, y]) => ({ x: x * 100, y })).length).toBe(1);
    expect(overlappingListings(points, "missing", ([x, y]) => ({ x, y }))).toEqual([]);
  });
});
