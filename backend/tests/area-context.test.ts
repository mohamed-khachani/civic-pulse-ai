import test from "node:test";
import assert from "node:assert/strict";
import { areaContext } from "../src/census.js";
import { pool } from "../src/db.js";
test("scoped area context groups identical values and preserves missing values and section IDs", async () => {
  const original = pool.query;
  let scope: unknown[] = [];
  (pool as any).query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes("DISTINCT ON (m.id)")) return { rows: [{ id: "noise_laeq_t_2026_nearest_station_db_energy_mean", name: "Ruido", unit: "dB", scope: "census", kind: "estimated", source: "Local", year: 2026 }] };
    scope = values;
    return { rows: ["2807909001", "2807909002", "2807909003"].map((cusec, i) => ({ cusec, data: { district_code: "09", barrio_code: "093", noise_laeq_t_2026_nearest_station_db_energy_mean: i < 2 ? 52 : null } })) };
  };
  try {
    const context = await areaContext("Quiero una zona tranquila", undefined, { neighborhood: "Ciudad Universitaria" });
    assert.deepEqual(scope.slice(0, 2), ["Ciudad Universitaria", null]);
    assert.equal((scope[2] as string[]).length, 1);
    assert.equal(context.section_count, 3);
    assert.equal(context.rows.length, 2);
    assert.deepEqual(context.rows[0][0], ["2807909001", "2807909002"]);
    assert.equal(context.rows[0].at(-1), 52);
    assert.equal(context.rows[1].at(-1), null);
  } finally { pool.query = original; }
});
