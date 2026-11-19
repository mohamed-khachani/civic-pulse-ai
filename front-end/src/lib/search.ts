import type { Listing, ListingSearchFilters, SortOrder } from "@/types";
export function serializeFilters(
  filters: ListingSearchFilters,
  extra: Record<string, string | number | undefined> = {},
) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra }))
    if (v !== undefined && v !== null && v !== "")
      params.set(k, Array.isArray(v) ? v.join(",") : String(v));
  return params.toString();
}
export function filterListings(
  data: Listing[],
  f: ListingSearchFilters,
  sort: SortOrder = "recommended",
) {
  const result = data.filter(
    (l) =>
      (f.max_price === undefined || l.price <= f.max_price) &&
      (f.min_price === undefined || l.price >= f.min_price) &&
      (f.min_bedrooms === undefined ||
        (l.bedrooms != null && l.bedrooms >= f.min_bedrooms)) &&
      (f.min_bathrooms === undefined ||
        (l.bathrooms != null && l.bathrooms >= f.min_bathrooms)) &&
      (f.min_surface === undefined ||
        (l.surface_m2 != null && l.surface_m2 >= f.min_surface)) &&
      (!f.district || l.district === f.district) &&
      (!f.neighborhood || l.neighborhood === f.neighborhood) &&
      (!f.source || l.source === f.source) &&
      (
        [
          "furnished",
          "elevator",
          "parking",
          "air_conditioning",
          "terrace",
        ] as const
      ).every((k) => f[k] === undefined || l[k] === f[k]) &&
      (!f.bounds ||
        (l.longitude != null &&
          l.latitude != null &&
          l.longitude >= f.bounds[0] &&
          l.longitude <= f.bounds[2] &&
          l.latitude >= f.bounds[1] &&
          l.latitude <= f.bounds[3])),
  );
  const compare: Record<SortOrder, (a: Listing, b: Listing) => number> = {
    recommended: () => 0,
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    surface_desc: (a, b) => (b.surface_m2 ?? -1) - (a.surface_m2 ?? -1),
    compatibility: (a, b) =>
      (b.compatibility?.score ?? -1) - (a.compatibility?.score ?? -1),
    updated: (a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
  };
  return result.sort(compare[sort]);
}
