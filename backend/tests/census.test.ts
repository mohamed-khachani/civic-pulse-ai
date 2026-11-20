import test from "node:test";
import assert from "node:assert/strict";
import { environmentalMetric } from "../src/census.js";
import { quickEvaluationSchema } from "../src/contracts.js";
import { z } from "zod";

test("census inspection exposes only air measurements and total/night noise", () => {
  for (const id of ["air_magnitude_8_2026_nearest_station_daily_mean", "air_magnitude_9_2026_nearest_station_daily_mean", "air_magnitude_10_2026_nearest_station_daily_mean", "air_magnitude_14_2026_nearest_station_daily_mean", "noise_laeq_t_2026_nearest_station_db_energy_mean", "noise_laeq_n_2026_nearest_station_db_energy_mean"]) assert.equal(environmentalMetric(id), true);
  for (const id of ["population_total", "barrio_area_km2", "section_2024_rent_collective_month_eur_p50", "air_magnitude_8_2026_nearest_station_valid_days", "noise_laeq_t_2026_nearest_station_observations", "district_study_rent_123"]) assert.equal(environmentalMetric(id), false);
});

test("candidate assessment does not request repeated routes for all fifty homes", () => {
  const schema = z.toJSONSchema(quickEvaluationSchema) as any;
  assert.equal(schema.properties.accepted.items.properties.routes, undefined);
});
