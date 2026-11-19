import type * as GeoJSON from "geojson";
import { z } from "zod";
const optionalNumber = z.number().finite().nullable().optional();
const optionalBoolean = z.boolean().nullable().optional();
export const compatibilitySchema = z.object({
  score: z.number().min(0).max(100),
  explanation: z.array(z.string()),
});
export const insightsSchema = z.object({
  metrics: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      detail: z.string().optional(),
      kind: z.enum(["observed", "estimated"]),
      scope: z.enum(["listing", "neighborhood", "district"]),
    }),
  ),
  note: z.string().optional(),
});
export const listingSchema = z.object({
  id: z.string(),
  source: z.enum(["pisos.com", "Fotocasa", "demo"]),
  url: z.url().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  surface_m2: optionalNumber,
  bedrooms: optionalNumber,
  bathrooms: optionalNumber,
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  district: z.string().nullable().optional(),
  neighborhood: z.string().nullable().optional(),
  images: z.array(z.url()).default([]),
  furnished: optionalBoolean,
  elevator: optionalBoolean,
  parking: optionalBoolean,
  air_conditioning: optionalBoolean,
  terrace: optionalBoolean,
  compatibility: compatibilitySchema.nullable().optional(),
  insights: insightsSchema.nullable().optional(),
  updated_at: z.iso.datetime().optional(),
});
export const boundsSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([w, s, e, n]) => w <= e && s <= n, "Invalid bounds");
export const filtersSchema = z.object({
  min_price: z.number().nonnegative().optional(),
  max_price: z.number().nonnegative().optional(),
  min_bedrooms: z.number().int().nonnegative().optional(),
  min_bathrooms: z.number().int().nonnegative().optional(),
  min_surface: z.number().nonnegative().optional(),
  furnished: z.boolean().optional(),
  elevator: z.boolean().optional(),
  parking: z.boolean().optional(),
  air_conditioning: z.boolean().optional(),
  terrace: z.boolean().optional(),
  district: z.string().optional(),
  neighborhood: z.string().optional(),
  census_section: z.string().optional(),
  source: z.enum(["pisos.com", "Fotocasa", "demo"]).optional(),
  bounds: boundsSchema.optional(),
  near_metro: z.boolean().optional(),
});
export const viewportSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  zoom: z.number().min(0).max(22),
});
export const mapActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("fit_results") }),
  z.object({ type: z.literal("focus_listing"), listing_id: z.string() }),
  z.object({ type: z.literal("focus_area"), bounds: boundsSchema }),
  z.object({ type: z.literal("set_viewport"), viewport: viewportSchema }),
]);
export const searchResponseSchema = z.object({
  listings: z.array(listingSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  result_set_id: z.string().optional(),
});
export const chatResponseSchema = z.object({
  message: z.string(),
  conversation_id: z.string(),
  filters: filtersSchema.optional(),
  filters_mode: z.enum(["patch", "replace"]).optional(),
  result_set_id: z.string().optional(),
  result_count: z.number().int().nonnegative().optional(),
  map_action: mapActionSchema.optional(),
  suggestions: z.array(z.string()).default([]),
});
export const geoFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
  }),
  properties: z.object({ id: z.string(), price: z.number().nonnegative() }),
});
export const geoResponseSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(geoFeatureSchema),
});
const positionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const ringSchema = z
  .array(positionSchema)
  .min(4)
  .refine(
    (r) => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1],
    "Polygon rings must close",
  );
const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: positionSchema }),
  z.object({
    type: z.literal("LineString"),
    coordinates: z.array(positionSchema).min(2),
  }),
  z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(ringSchema).min(1),
  }),
  z.object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(ringSchema).min(1)).min(1),
  }),
]);
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Usa un color hexadecimal como #16803C");
export const censusCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      id: z.string().optional(),
      geometry: geometrySchema.refine(
        (g) => g.type === "Polygon" || g.type === "MultiPolygon",
      ),
      properties: z.object({
        id: z.string(),
        municipality: z.string(),
        color: hexColorSchema.optional(),
        population: z.number().nullable().optional(),
      }),
    }),
  ),
});
export const censusMetricSchema = z.object({
  id: z.string(),
  name: z.string(),
  unit: z.string(),
  kind: z.enum(["observed", "estimated", "synthetic"]),
  source: z.string(),
  description: z.string().optional(),
  year: z.number().int().optional(),
  stops: z
    .array(z.object({ value: z.number(), color: hexColorSchema }))
    .min(2)
    .refine(
      (stops) => stops.every((s, i) => i === 0 || s.value > stops[i - 1].value),
      "Stops must be strictly increasing",
    ),
  values: z.record(z.string(), z.number().nullable()),
});
export type CensusCollection = z.infer<typeof censusCollectionSchema>;
export type CensusMetric = z.infer<typeof censusMetricSchema>;
export const censusSectionInfoSchema = z.object({
  id: z.string(),
  municipality: z.string(),
  metrics: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      unit: z.string(),
      value: z.number().nullable(),
      kind: z.enum(["observed", "estimated", "synthetic"]),
      source: z.string(),
      description: z.string().optional(),
      year: z.number().optional(),
    }),
  ),
});
export type CensusSectionInfo = z.infer<typeof censusSectionInfoSchema>;
export const geographicLayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  available: z.boolean(),
  geojson: z
    .object({
      type: z.literal("FeatureCollection"),
      features: z.array(
        z.object({
          type: z.literal("Feature"),
          geometry: geometrySchema,
          properties: z.record(z.string(), z.unknown()).nullable(),
        }),
      ),
    })
    .optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  metric: z.string().optional(),
  unit: z.string().optional(),
  kind: z.enum(["observed", "estimated"]).optional(),
  scope: z.enum(["neighborhood", "district", "census"]).optional(),
});
export const optionsSchema = z.object({
  districts: z.array(z.string()),
  neighborhoods: z.array(z.string()),
  sources: z.array(z.enum(["pisos.com", "Fotocasa", "demo"])),
  features: z.array(
    z.enum([
      "furnished",
      "elevator",
      "parking",
      "air_conditioning",
      "terrace",
      "near_metro",
    ]),
  ),
  sorts: z.array(
    z.enum([
      "recommended",
      "price_asc",
      "price_desc",
      "surface_desc",
      "compatibility",
      "updated",
    ]),
  ),
});
export type Listing = z.infer<typeof listingSchema>;
export type ListingFeature =
  | "furnished"
  | "elevator"
  | "parking"
  | "air_conditioning"
  | "terrace"
  | "near_metro";
export type ListingSearchFilters = z.infer<typeof filtersSchema>;
export type ListingSearchResponse = z.infer<typeof searchResponseSchema>;
export type ListingGeoFeature = z.infer<typeof geoFeatureSchema>;
export type MapAction = z.infer<typeof mapActionSchema>;
export type MapViewport = z.infer<typeof viewportSchema>;
export type Bounds = z.infer<typeof boundsSchema>;
export type LocationInsights = z.infer<typeof insightsSchema>;
export type CompatibilityScore = z.infer<typeof compatibilitySchema>;
export type GeographicLayer = z.infer<typeof geographicLayerSchema>;
export interface CensusSection {
  id: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  metrics?: Record<string, number | null>;
}
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}
export interface ChatRequest {
  message: string;
  conversation_id?: string;
  filters: ListingSearchFilters;
  selected_listing_id?: string;
  result_set_id?: string;
}
export type SortOrder =
  | "recommended"
  | "price_asc"
  | "price_desc"
  | "surface_desc"
  | "compatibility"
  | "updated";
export type FilterOptions = z.infer<typeof optionsSchema>;
