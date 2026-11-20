import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { cleanSchema, normalizeDisplayFields } from "../src/claude.js";
import { planSchema } from "../src/contracts.js";

test("provider schema converts fixed tuples and removes unsupported validation keywords", () => {
  const schema = cleanSchema(z.toJSONSchema(planSchema));
  const serialized = JSON.stringify(schema);
  for (const key of [
    "prefixItems",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "pattern",
  ])
    assert.ok(!serialized.includes('"' + key + '"'));
  assert.deepEqual(schema.properties.filters.properties.bounds.anyOf[0].items, {
    type: "number",
  });
  assert.equal(schema.additionalProperties, false);
});

test("display normalization bounds explanation text without changing IDs, scores, or duration estimates", () => {
  const data: any = {
    message: "x".repeat(3000),
    suggestions: ["a".repeat(150), "b", "c", "d"],
    accepted: [
      {
        id: "71",
        score: 82,
        reasons: ["a", "b", "c", "d", "e"],
        routes: [
          {
            destination: "Campus",
            minutes_min: 35,
            minutes_max: 50,
            overview: "metro",
            schedule: "weekday",
          },
        ],
      },
    ],
  };
  const result = normalizeDisplayFields(data);
  assert.equal(result.message.length, 2500);
  assert.equal(result.suggestions.length, 3);
  assert.equal(result.suggestions[0].length, 100);
  assert.equal(result.accepted[0].reasons.length, 4);
  assert.equal(result.accepted[0].id, "71");
  assert.equal(result.accepted[0].score, 82);
  assert.equal(result.accepted[0].routes[0].minutes_max, 50);
});
