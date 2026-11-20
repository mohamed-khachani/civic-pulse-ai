import type { ListingGeoFeature } from "@/types";
import type { Feature } from "geojson";
import type { PositionAnchor } from "maplibre-gl";

interface InteractiveFeature {
  layer: { id: string };
  properties?: Record<string, unknown> | null;
}

export function listingGroupAnchor(point: { x: number; y: number }, width: number, height: number): PositionAnchor {
  const vertical = point.y < Math.min(230, height / 3) ? "top"
    : point.y > height - Math.min(230, height / 3) ? "bottom" : "center";
  const horizontal = point.x < Math.min(180, width / 3) ? "left"
    : point.x > width - Math.min(180, width / 3) ? "right" : "center";
  if (vertical === "center") return horizontal;
  return horizontal === "center" ? vertical : `${vertical}-${horizontal}`;
}

/** Cluster leaves contain only lightweight point data, not full property records. */
export function listingMembers(features: Feature[]): ListingGeoFeature[] {
  const unique = new Map<string, ListingGeoFeature>();
  for (const feature of features) {
    if (feature.geometry?.type !== "Point" || feature.properties?.id == null) continue;
    const id = String(feature.properties.id);
    if (!unique.has(id)) unique.set(id, {
      type: "Feature",
      geometry: { type: "Point", coordinates: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]] },
      properties: { id, price: Number(feature.properties.price) },
    });
  }
  return [...unique.values()];
}

/** Include points hidden behind a clicked price pill, without grouping distant visible markers. */
export function overlappingListings(
  features: ListingGeoFeature[],
  selectedId: string,
  project: (coordinates: [number, number]) => { x: number; y: number },
): ListingGeoFeature[] {
  const selected = features.find((feature) => feature.properties.id === selectedId);
  if (!selected) return [];
  const center = project(selected.geometry.coordinates);
  return listingMembers(features.filter((feature) => {
    const point = project(feature.geometry.coordinates);
    return Math.abs(point.x - center.x) <= 52 && Math.abs(point.y - center.y) <= 24;
  })).sort((a, b) => {
    if (a.properties.id === b.properties.id) return 0;
    if (a.properties.id === selectedId) return -1;
    if (b.properties.id === selectedId) return 1;
    const aPoint = project(a.geometry.coordinates), bPoint = project(b.geometry.coordinates);
    return Math.hypot(aPoint.x - center.x, aPoint.y - center.y) - Math.hypot(bPoint.x - center.x, bPoint.y - center.y)
      || a.properties.id.localeCompare(b.properties.id);
  });
}
export type MapHoverTarget =
  | { type: "listing"; id?: string }
  | { type: "section"; id: string }
  | undefined;
/** Hit-test order must never let a polygon steal a listing's hover, even if the API returns it first. */
export function mapHoverTarget(
  features: InteractiveFeature[] | undefined,
  listingsVisible: boolean,
): MapHoverTarget {
  const listing = listingsVisible
    ? features?.find((f) =>
        ["clusters", "prices", "selected-price", "hovered-price"].includes(
          f.layer.id,
        ),
      )
    : undefined;
  if (listing)
    return {
      type: "listing",
      id:
        listing.properties?.id == null
          ? undefined
          : String(listing.properties.id),
    };
  const section = features?.find(
    (f) => f.layer.id === "census-fill" && f.properties?.id != null,
  );
  return section
    ? { type: "section", id: String(section.properties!.id) }
    : undefined;
}
