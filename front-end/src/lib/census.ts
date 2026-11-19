import type { CensusCollection, CensusMetric } from "@/types";
import type { ExpressionSpecification } from "maplibre-gl";
export function censusDisplayData(
  collection: CensusCollection,
  metric: CensusMetric | undefined,
) {
  return {
    ...collection,
    features: collection.features.map((f) => ({
      ...f,
      id: f.properties.id,
      properties: {
        ...f.properties,
        atlas_color: f.properties.color ?? null,
        atlas_value: metric?.values[f.properties.id] ?? null,
      },
    })),
  };
}
export function censusPaint(
  metric: CensusMetric | undefined,
): ExpressionSpecification {
  const override: ExpressionSpecification = [
    "all",
    ["has", "atlas_color"],
    ["!=", ["get", "atlas_color"], null],
  ];
  const fallback = "#d9dfdb";
  if (!metric) return ["case", override, ["get", "atlas_color"], "#dbe8df"];
  const interpolate: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["to-number", ["get", "atlas_value"]],
    ...metric.stops.flatMap((s) => [s.value, s.color]),
  ];
  return [
    "case",
    override,
    ["get", "atlas_color"],
    ["!=", ["get", "atlas_value"], null],
    interpolate,
    fallback,
  ];
}

/** All available indicators for one section, independent of the variable used to color the map. */
export function sectionMetrics(metrics: CensusMetric[], sectionId: string) {
  return metrics.map((metric) => ({
    id: metric.id,
    name: metric.name,
    unit: metric.unit,
    kind: metric.kind,
    source: metric.source,
    description: metric.description,
    year: metric.year,
    value: metric.values[sectionId] ?? null,
  }));
}
