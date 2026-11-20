import test from "node:test";
import assert from "node:assert/strict";
import {
  validateJourneyDestinations,
  journeyPreview,
  journeyPriorities,
} from "../src/journeys.js";

const plan: any = {
  destinations: [
    { label: "Familia", place: "Retiro" },
    { label: "Universidad", place: "Ciudad Universitaria" },
  ],
};
const route = (destination: string) => ({
  destination,
  minutes_min: 25,
  minutes_max: 45,
  overview: "Orientativo: metro y caminar",
  schedule: "Laborables",
});
test("daily destinations outweigh occasional visits regardless of their purpose", () => {
  const priorities = journeyPriorities([
    { label: "Universidad", place: "Campus", purpose: "university", days: ["lunes a viernes"], time: "09:00", direction: "to", max_minutes: null },
    { label: "Familia", place: "Retiro", purpose: "family", days: ["domingo"], time: null, direction: "to", max_minutes: null },
    { label: "Cuidados", place: "Centro", purpose: "family", days: ["todos los días"], time: null, direction: "to", max_minutes: null },
  ]);
  assert.equal(priorities[0].days_per_week, 5);
  assert.equal(priorities[1].days_per_week, 1);
  assert.equal(priorities[1].importance, "ocasional");
  assert.equal(priorities[2].days_per_week, 7);
  assert.equal(priorities[2].importance, "habitual");
});
test("journey destinations accept the supplied label or place with harmless case differences", () => {
  assert.doesNotThrow(() =>
    validateJourneyDestinations(
      [route("FAMILIA"), route("ciudad universitaria")],
      plan,
    ),
  );
});
test("journey estimates cannot introduce an unrelated destination", () => {
  assert.throws(
    () => validateJourneyDestinations([route("Barcelona")], plan),
    (error: any) => error.code === "UNKNOWN_DESTINATION",
  );
});

test("chat journey previews show concrete time ranges and route overviews without internal IDs", () => {
  const preview = journeyPreview(
    [{ id: "73", score: 80, reasons: [], routes: [route("Universidad")] }],
    new Map([["73", { neighborhood: "Pacífico" }]]),
  );
  assert.ok(preview.includes("Desde Pacífico"));
  assert.ok(preview.includes("≈ 25–45 min"));
  assert.ok(preview.includes("metro y caminar"));
  assert.ok(preview.includes("Laborables"));
  assert.ok(preview.includes("estimaciones de IA"));
  assert.ok(!preview.includes("73"));
  assert.equal(journeyPreview([], new Map()), "");
});
