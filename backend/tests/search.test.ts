import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSearch,
  csvEscape,
  searchMetric,
  toListing,
  isRoomListing,
} from "../src/search.js";
import { parseSearch } from "../src/contracts.js";

test("hard constraints are parameterized, including hostile strings", () => {
  const query = buildSearch({
    max_price: 1200,
    furnished: false,
    district: "Centro'; DROP TABLE housing.listings;--",
  });
  assert.ok(!query.where.includes("DROP"));
  assert.deepEqual(query.values, [
    1200,
    false,
    "Centro'; DROP TABLE housing.listings;--",
  ]);
});
test("false and zero survive query parsing, invalid booleans rejected", () => {
  assert.deepEqual(parseSearch({ min_price: "0", furnished: "false" }), {
    min_price: 0,
    furnished: false,
  });
  assert.throws(() => parseSearch({ furnished: "yes" }));
  assert.throws(() => parseSearch({ bounds: "5,8,1,2" }));
});
test("section IDs are normalized, unknown geography remains excluded by filters", () => {
  const query = buildSearch({ census_section: "01001" });
  assert.deepEqual(query.values, ["2807901001"]);
});
test("area conditions parameterize both indicator keys and values", () => {
  const plan: any = {
    area_filters: [
      {
        metric: "noise_laeq_t_2025_nearest_station_db_arithmetic_mean",
        operator: "lte",
        value: 55,
      },
    ],
    area_order: [],
  };
  const query = buildSearch({}, "recommended", plan);
  assert.deepEqual(query.values, [
    plan.area_filters[0].metric,
    plan.area_filters[0].metric,
    55,
  ]);
  assert.ok(query.where.includes("::float8"));
  assert.ok(!query.where.includes(plan.area_filters[0].metric));
});
test("housing suitability excludes protected demographic indicators", () => {
  assert.equal(
    searchMetric("district_study_personas_con_nacionalidad_extranjera"),
    false,
  );
  assert.equal(searchMetric("population_age_65_plus"), false);
  assert.equal(searchMetric("parks_nearest_m"), true);
});
test("CSV cells escape delimiters and neutralize formulas", () => {
  assert.equal(csvEscape('a,"b"'), '"a,""b"""');
  assert.equal(csvEscape("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvEscape(false), "false");
  assert.equal(csvEscape(null), "");
});
test("listing output keeps missing attributes and labels estimated travel", () => {
  const row: any = {
    id: "7",
    portal: "fotocasa",
    price: 900,
    title: "Real",
    images: ["https://example.com/p.jpg"],
    area_data: { parks_nearest_m: 200 },
    coordinates_exact: false,
  };
  const result = toListing(row, {
    id: "7",
    score: 80,
    reasons: ["Precio"],
    routes: [
      {
        destination: "Universidad",
        minutes_min: 30,
        minutes_max: 50,
        overview: "Metro y autobús orientativos",
        schedule: "Laborables 09:00",
      },
    ],
  });
  assert.equal(result.source, "Fotocasa");
  assert.equal(result.compatibility?.score, 80);
  assert.ok(
    result.insights.metrics
      .at(-1)
      .detail.includes("sin horarios ni rutas verificados"),
  );
});

test("zero-price source placeholders are excluded from active rental searches", () => {
  assert.ok(buildSearch({}).where.includes("l.price_amount > 0"));
});

test("area ordering parameters do not leak into count queries", () => {
  const plan: any = {
    area_filters: [],
    area_order: [
      {
        metric: "noise_laeq_t_2026_nearest_station_db_energy_mean",
        direction: "asc",
        weight: 2,
      },
    ],
  };
  const query = buildSearch({ max_price: 1200 }, "recommended", plan);
  assert.deepEqual(query.whereValues, [1200]);
  assert.equal(query.values.length, 3);
  assert.ok(query.order.includes("NULLS LAST"));
});

test("entire-home searches reject room adverts even when the portal labels them FLAT", () => {
  assert.equal(
    isRoomListing({
      property_type: "FLAT",
      description: "alquilo habitación para una persona responsable",
    }),
    true,
  );
  assert.equal(
    isRoomListing({
      property_type: "FLAT",
      description:
        "Las habitaciones son para alquilar en un apartamento de 3 dormitorios",
    }),
    true,
  );
  assert.equal(
    isRoomListing({
      property_type: "FLAT",
      description: "Habitación amplia y exterior en alquiler por 500 euros",
    }),
    true,
  );
  assert.equal(
    isRoomListing({
      property_type: "FLAT",
      description: "Piso completo con tres habitaciones y dos baños",
    }),
    false,
  );
});
