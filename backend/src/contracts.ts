import { z } from "zod";
export const boundsSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([w, s, e, n]) => w <= e && s <= n);
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
  district: z.string().max(100).optional(),
  neighborhood: z.string().max(100).optional(),
  census_section: z
    .string()
    .regex(/^(?:\d{5}|\d{10})$/)
    .optional(),
  source: z.enum(["pisos.com", "Fotocasa"]).optional(),
  bounds: boundsSchema.optional(),
  near_metro: z.boolean().optional(),
});
export type Filters = z.infer<typeof filtersSchema>;
export const sorts = [
  "recommended",
  "price_asc",
  "price_desc",
  "surface_desc",
  "compatibility",
  "updated",
] as const;
export const sortSchema = z.enum(sorts);
export type Sort = z.infer<typeof sortSchema>;
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversation_id: z.uuid().optional(),
  selected_listing_id: z.string().regex(/^\d+$/).optional(),
  result_set_id: z.uuid().optional(),
  filters: filtersSchema,
});
export const destinationSchema = z.object({
  label: z.string().max(200),
  place: z.string().max(250),
  purpose: z.enum(["university", "work", "family", "friends", "home", "other"]),
  days: z.array(z.string()).max(7),
  time: z.string().max(40).nullable(),
  direction: z.enum(["to", "from", "round_trip"]),
  max_minutes: z.number().positive().max(300).nullable(),
  transport_mode: z.enum(["public_transport", "car", "bicycle", "walking"]).default("public_transport"),
});
export const planSchema = z.object({
  entire_home: z.boolean(),
  filters: filtersSchema,
  area_filters: z
    .array(
      z.object({
        metric: z.string(),
        operator: z.enum(["lte", "gte"]),
        value: z.number().finite(),
      }),
    )
    .max(12),
  area_order: z
    .array(
      z.object({
        metric: z.string(),
        direction: z.enum(["asc", "desc"]),
        weight: z.number().min(0).max(10),
      }),
    )
    .max(8),
  sort: sortSchema,
  preferences: z.array(z.string().max(200)).max(12),
  destinations: z.array(destinationSchema).max(5),
  context: z.string().max(1500),
  clarification: z.string().max(600).nullable(),
});
export type Plan = z.infer<typeof planSchema>;
export const routeSchema = z
  .object({
    destination: z.string().max(200),
    minutes_min: z.number().nonnegative().max(300),
    minutes_max: z.number().nonnegative().max(360),
    overview: z.string().max(300),
    schedule: z.string().max(150),
  })
  .refine((x) => x.minutes_max >= x.minutes_min);
export const evaluationSchema = z.object({
  accepted: z
    .array(
      z.object({
        id: z.string().regex(/^\d+$/),
        score: z.number().min(0).max(100),
        reasons: z.array(z.string().max(250)).max(4),
        routes: z.array(routeSchema).max(5),
      }),
    )
    .max(100),
  message: z.string().max(2500),
  suggestions: z.array(z.string().max(100)).max(4),
});
export type Assessment = z.infer<typeof evaluationSchema>["accepted"][number];
export const quickEvaluationSchema = evaluationSchema.extend({
  accepted: z.array(evaluationSchema.shape.accepted.element.omit({ routes: true })).max(100),
});
export function parseSearch(query: Record<string, unknown>) {
  const numeric = new Set([
    "min_price",
    "max_price",
    "min_bedrooms",
    "min_bathrooms",
    "min_surface",
  ]);
  const bools = new Set([
    "furnished",
    "elevator",
    "parking",
    "air_conditioning",
    "terrace",
    "near_metro",
  ]);
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(query)) {
    if (typeof v !== "string") throw new Error("Invalid query value");
    if (numeric.has(k)) {
      if (!v.trim()) throw new Error("Empty number");
      raw[k] = Number(v);
    } else if (bools.has(k)) {
      if (v !== "true" && v !== "false") throw new Error("Invalid boolean");
      raw[k] = v === "true";
    } else if (k === "bounds") raw[k] = v.split(",").map(Number);
    else raw[k] = v;
  }
  return filtersSchema.parse(raw);
}

// Flat typed entries avoid the provider's exponential grammar cost for many optional fields.
export const plannerOutputSchema = planSchema.extend({
  filters: z.array(
    z.object({
      field: z.enum([
        "min_price",
        "max_price",
        "min_bedrooms",
        "min_bathrooms",
        "min_surface",
        "furnished",
        "elevator",
        "parking",
        "air_conditioning",
        "terrace",
        "district",
        "neighborhood",
        "census_section",
        "source",
        "bounds",
      ]),
      value: z.string(),
    }),
  ),
});

// Bind the model's vocabulary to the actual catalog for this request.
// Geographic identifiers belong in filters, never in area metric conditions.
export function plannerSchemaForMetrics(metricIds: string[]) {
  const metric = z.enum(metricIds.length ? [...new Set(metricIds)] as [string, ...string[]] : ["__no_area_metrics__"]);
  return plannerOutputSchema.extend({
    area_filters: z.array(planSchema.shape.area_filters.element.extend({ metric })).max(12),
    area_order: z.array(planSchema.shape.area_order.element.extend({ metric })).max(8),
  });
}

export const compactEvaluationSchema = z.object({
  accepted_ids: z.array(z.string().regex(/^\d+$/)).max(100),
  scores: z.array(z.number().min(0).max(100)).max(100),
  message: z.string().max(2500),
  suggestions: z.array(z.string().max(100)).max(4),
}).refine((value) => value.accepted_ids.length === value.scores.length, "IDs and scores must align");
