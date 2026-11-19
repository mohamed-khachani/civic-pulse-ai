interface InteractiveFeature {
  layer: { id: string };
  properties?: Record<string, unknown> | null;
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
