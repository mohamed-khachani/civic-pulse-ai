import test from "node:test";
import assert from "node:assert/strict";
import { localNeighborhoodPlan } from "../src/local-plan.js";
import { toListing } from "../src/search.js";
const names = ["Sol", "Ciudad Universitaria"];
test("plain neighborhood requests, CIU and its spelling variant require no model", () => {
  for (const text of ["casas en ciudad universitaria", "Casas en ciudad universtiaria", "Pisos en CIU", "Busco un piso en CIU.", "Quiero vivir en Ciudad Universitaria"]) {
    const plan = localNeighborhoodPlan(text, names, { max_price: 1200, district: "Centro" });
    assert.equal(plan?.filters.neighborhood, "Ciudad Universitaria", text);
    assert.equal(plan?.filters.max_price, 1200);
    assert.equal(plan?.filters.district, undefined);
  }
});
test("additional requirements and conversational preferences cannot be silently discarded by the direct path", () => {
  for (const text of ["casas en CIU con terraza", "casas en Sol y cerca de mi trabajo", "casas en CIU por menos de 1000 euros"])
    assert.equal(localNeighborhoodPlan(text, names, {}), undefined);
  const previous = localNeighborhoodPlan("casas en CIU", names, {})!;
  previous.preferences = ["silencioso"];
  assert.equal(localNeighborhoodPlan("casas en CIU", names, {}, previous), undefined);
});
test("pending qualitative assessment is not exposed as a fabricated compatibility percentage", () => {
  const listing = toListing({ id: "1", price: 1000, portal: "fotocasa", images: [] }, { id: "1", score: -1, reasons: [], routes: [] });
  assert.equal(listing.compatibility, undefined);
});
