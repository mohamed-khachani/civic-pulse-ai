import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { insideMadrid, constrainMadrid, MADRID_BOUNDS } from "@/lib/geo/madrid";
import { resultBounds, resultSignature } from "@/lib/map";
import {
  censusCollectionSchema,
  censusMetricSchema,
  type ListingGeoFeature,
} from "@/types";
import { censusDisplayData, censusPaint } from "@/lib/census";
import { useAtlas } from "@/stores/atlas-store";
const initial = useAtlas.getState();
afterEach(() => useAtlas.setState(initial, true));
const sections = censusCollectionSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../public/geo/madrid-census-2025.geojson", import.meta.url),
      "utf8",
    ),
  ),
);
const point = (
  id: string,
  longitude: number,
  latitude: number,
): ListingGeoFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [longitude, latitude] },
  properties: { id, price: 1000 },
});
const metric = censusMetricSchema.parse({
  id: "noise",
  name: "Ruido",
  unit: "dB",
  kind: "estimated",
  source: "Test fixture",
  stops: [
    { value: 40, color: "#00ff00" },
    { value: 70, color: "#ff0000" },
  ],
  values: { [sections.features[0].properties.id]: 53 },
});
describe("Madrid navigation", () => {
  it("contains municipalities outside Madrid city and rejects other regions", () => {
    for (const p of [
      [-3.7038, 40.4168],
      [-4.147, 40.589],
      [-3.367, 40.481],
      [-3.604, 40.031],
    ])
      expect(insideMadrid(p)).toBe(true);
    for (const p of [
      [2.17, 41.39],
      [-4.02, 39.86],
      [-4.12, 40.95],
    ])
      expect(insideMadrid(p)).toBe(false);
  });
  it("clamps drags and programmatic destinations to the actual polygon, not just its bounding rectangle", () => {
    const constrained = constrainMadrid([2.17, 41.39]);
    expect(insideMadrid(constrained)).toBe(true);
    expect(constrained[0]).toBeGreaterThanOrEqual(MADRID_BOUNDS[0][0]);
    expect(constrained[0]).toBeLessThanOrEqual(MADRID_BOUNDS[1][0]);
    expect(constrainMadrid([-3.7038, 40.4168])).toEqual([-3.7038, 40.4168]);
  });
  it("frames all result points, including those beyond the first page", () => {
    const features = Array.from({ length: 20 }, (_, i) =>
      point(String(i), -3.72 + i / 10000, 40.43 + i / 10000),
    );
    const bounds = resultBounds(features)!;
    expect(
      features.every(
        (f) =>
          f.geometry.coordinates[0] >= bounds[0][0] &&
          f.geometry.coordinates[0] <= bounds[1][0] &&
          f.geometry.coordinates[1] >= bounds[0][1] &&
          f.geometry.coordinates[1] <= bounds[1][1],
      ),
    ).toBe(true);
    expect(bounds[1]).toEqual(features[19].geometry.coordinates);
  });
  it("supports a single result and empty results without invalid bounds", () => {
    expect(resultBounds([point("a", -3.72, 40.43)])).toEqual([
      [-3.72, 40.43],
      [-3.72, 40.43],
    ]);
    expect(resultBounds([])).toBeUndefined();
    expect(resultSignature([point("a", 1, 2), point("b", 3, 4)])).toBe(
      resultSignature([point("b", 3, 4), point("a", 1, 2)]),
    );
  });
});
describe("Full regional census and thematic mapping", () => {
  it("ships all 4518 unique INE 2025 sections across 179 municipalities", () => {
    expect(sections.features).toHaveLength(4518);
    expect(new Set(sections.features.map((f) => f.properties.id)).size).toBe(
      4518,
    );
    expect(
      sections.features.every((f) => f.properties.id.startsWith("28")),
    ).toBe(true);
    expect(
      new Set(sections.features.map((f) => f.properties.municipality)).size,
    ).toBe(179);
  });
  it("joins metrics by census identifier, preserves missing values, and uses only API-provided colors", () => {
    const id = sections.features[0].properties.id;
    const configured = {
      ...sections,
      features: sections.features.map((f) =>
        f.properties.id === id
          ? { ...f, properties: { ...f.properties, color: "#123456" } }
          : f,
      ),
    };
    const data = censusDisplayData(configured, metric);
    expect(data.features[0].properties.atlas_value).toBe(53);
    expect(data.features[0].properties.atlas_color).toBe("#123456");
    expect(data.features[1].properties.atlas_value).toBeNull();
    expect(sections.features[0].properties.color).toBeUndefined();
  });
  it("preserves the selected variable between modes without exposing color editing state", () => {
    const s = useAtlas.getState();
    s.setCensusMetric("noise");
    s.selectCensus("2807901001");
    s.setMode("map");
    s.setMode("chat");
    expect(useAtlas.getState().activeCensusMetric).toBe("noise");
    expect(useAtlas.getState().selectedCensusId).toBe("2807901001");
    expect(useAtlas.getState().censusVisible).toBe(true);
    expect("setSectionColor" in s).toBe(false);
    expect("setMetricColor" in s).toBe(false);
    expect("sectionColors" in s).toBe(false);
    expect("metricColors" in s).toBe(false);
  });
  it("validates palettes and distinguishes estimates from observed data", () => {
    expect(
      censusMetricSchema.safeParse({
        ...metric,
        stops: [
          { value: 70, color: "#ff0000" },
          { value: 40, color: "#00ff00" },
        ],
      }).success,
    ).toBe(false);
    expect(
      censusMetricSchema.safeParse({ ...metric, kind: "live" }).success,
    ).toBe(false);
    const paint = JSON.stringify(censusPaint(metric));
    expect(paint).toContain("#00ff00");
    expect(paint).toContain("atlas_color");
    expect(paint).toContain("#d9dfdb");
  });
});
