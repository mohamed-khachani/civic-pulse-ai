import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { plannerSchemaForMetrics } from "../src/contracts.js";
import { cleanSchema } from "../src/claude.js";

test("planner accepts only supplied area metric IDs, keeping neighborhood codes out of metric filters", () => {
  const metric = "noise_laeq_t_2026_nearest_station_db_energy_mean";
  const schema = plannerSchemaForMetrics([metric]);
  const base = { entire_home: true, filters: [{ field: "neighborhood", value: "Ciudad Universitaria" }], area_filters: [], area_order: [], sort: "recommended", preferences: [], destinations: [], context: "casas en ciudad universitaria", clarification: null };
  assert.ok(schema.safeParse(base).success);
  assert.ok(schema.safeParse({ ...base, area_order: [{ metric, direction: "asc", weight: 1 }] }).success);
  for (const unknown of ["neighborhood_code", "cusecs", "noise", "ciudad_universitaria"])
    assert.equal(schema.safeParse({ ...base, area_filters: [{ metric: unknown, operator: "lte", value: 55 }] }).success, false);
  const provider = cleanSchema(z.toJSONSchema(schema));
  assert.deepEqual(provider.properties.area_filters.items.properties.metric.enum, [metric]);
  assert.deepEqual(provider.properties.area_order.items.properties.metric.enum, [metric]);
});
