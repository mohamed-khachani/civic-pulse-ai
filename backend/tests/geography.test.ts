import test from "node:test";
import assert from "node:assert/strict";
import { requestedNeighborhood, canonicalNeighborhood } from "../src/geography.js";
import { buildSearch } from "../src/search.js";
import { destinationSchema } from "../src/contracts.js";
const names = ["Sol", "Ciudad Universitaria", "Palacio"];
test("explicit housing requests resolve CIU while commuting destinations do not scope housing", () => {
  assert.equal(requestedNeighborhood("Quiero vivir en CIU, con terraza", names), "Ciudad Universitaria");
  assert.equal(requestedNeighborhood("Busco un piso en Ciudad Universitaria", names), "Ciudad Universitaria");
  assert.equal(requestedNeighborhood("Busco piso barato. Voy a clase en Ciudad Universitaria", names), undefined);
  assert.equal(requestedNeighborhood("Vivo en Sol y voy a clase en CIU", names), undefined);
  assert.equal(requestedNeighborhood("casas en ciudad universitaria", names), "Ciudad Universitaria");
  assert.equal(requestedNeighborhood("Casas en ciudad universtiaria", names), "Ciudad Universitaria");
  assert.equal(requestedNeighborhood("pisos en CIU", names), "Ciudad Universitaria");
  assert.equal(requestedNeighborhood("busco casas en Ciudad Universitaria", names), "Ciudad Universitaria");
  assert.equal(canonicalNeighborhood("CIU", names), "Ciudad Universitaria");
});
test("neighborhood search restricts results through official census section membership", () => {
  const query = buildSearch({ neighborhood: "Ciudad Universitaria" });
  assert.ok(query.where.includes("cs.cusec IN"));
  assert.ok(query.where.includes("scope.neighborhood_code"));
  assert.deepEqual(query.whereValues, ["Ciudad Universitaria"]);
});
test("transport defaults to public transport and preserves explicit modes", () => {
  const destination = { label: "Clase", place: "Campus", purpose: "university", days: [], time: null, direction: "to", max_minutes: null };
  assert.equal(destinationSchema.parse(destination).transport_mode, "public_transport");
  for (const mode of ["car", "walking", "bicycle"])
    assert.equal(destinationSchema.parse({ ...destination, transport_mode: mode }).transport_mode, mode);
});
