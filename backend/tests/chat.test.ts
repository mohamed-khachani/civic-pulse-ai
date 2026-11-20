import test from "node:test";
import assert from "node:assert/strict";
import { chat } from "../src/chat.js";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";

process.env.NODE_ENV = "test";

async function scenario(mode: "refill" | "empty" | "unknown" | "journey") {
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  const originalKey = config.apiKey;
  config.apiKey = "test-only-key";
  const offsets: number[] = [];
  let persisted: string[] | undefined;
  let evaluations = 0;
  let persistedAssessments: Record<string, any> = {};
  let journeyCalls = 0;
  (pool as any).query = async (text: string, values: any[] = []) => {
    if (text.includes("DISTINCT ON (m.id)")) return { rows: [] };
    if (text.includes("FROM madrid.section_data")) return { rows: [] };
    if (text.startsWith("SELECT name FROM madrid.districts"))
      return { rows: [{ name: "Centro" }] };
    if (text.startsWith("SELECT name FROM madrid.neighborhoods"))
      return { rows: [{ name: "Sol" }] };
    if (text.startsWith("SELECT count(*)")) return { rows: [{ total: 600 }] };
    if (text.includes("LIMIT $")) {
      const offset = Number(values.at(-1));
      offsets.push(offset);
      return {
        rows: Array.from({ length: 300 }, (_, i) => ({
          id: String(offset + i + 1),
          price: 900,
          surface_m2: 60,
          bedrooms: 2,
          bathrooms: 1,
          district: "Centro",
          neighborhood: "Sol",
          latitude: 40.42,
          longitude: -3.7,
          title: "Piso completo",
          description: "Piso completo en alquiler",
          property_type: "FLAT",
          area_data: {},
        })),
      };
    }
    if (text.includes("INSERT INTO housing.result_sets")) {
      persisted = values[3];
      persistedAssessments = JSON.parse(values[4]);
    }
    return { rows: [], rowCount: 1 };
  };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    let output: unknown;
    if (body.system.startsWith("Eres Atlas, asistente"))
      output = {
        entire_home: true,
        filters: [],
        area_filters: [],
        area_order: [],
        sort: "recommended",
        preferences: [],
        destinations:
          mode === "journey"
            ? [
                {
                  label: "Universidad",
                  place: "Ciudad Universitaria",
                  purpose: "university",
                  days: ["lunes"],
                  time: "09:00",
                  direction: "to",
                  max_minutes: null,
                },
              ]
            : [],
        context: "Piso completo",
        clarification: null,
      };
    else if (body.system.startsWith("Estima trayectos")) {
      journeyCalls++;
      const input = JSON.parse(body.messages[0].content);
      output = {
        estimates: input.homes.map((home: any[]) => ({
          id: home[0],
          routes: [
            {
              destination: "Universidad",
              minutes_min: 30,
              minutes_max: 50,
              overview: "Orientativo: metro y caminata",
              schedule: "Lunes llegada09:00",
            },
          ],
        })),
        summary:
          "Las primeras opciones quedan a unos30–50min de la universidad, como estimación orientativa de IA.",
      };
    } else {
      evaluations++;
      const input = JSON.parse(body.messages[0].content);
      const ids =
        mode === "empty"
          ? []
          : mode === "unknown"
            ? ["999999"]
            : input.candidates
                .slice(0, evaluations <= 2 ? 10 : 15)
                .map((row: unknown[]) => row[0]);
      output = {
        accepted: ids.map((id: string) => ({
          id,
          score: 80,
          reasons: ["Cumple los requisitos"],
          routes: [],
        })),
        message: ids.length
          ? "He seleccionado opciones que encajan."
          : "No hay opciones compatibles.",
        suggestions: [],
      };
    }
    return new Response(
      JSON.stringify({
        model: "test-model",
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify(output) }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  try {
    const result = await chat(
      { message: "Busco un piso completo", filters: {} },
      "test-" + mode,
      new AbortController().signal,
    );
    return {
      result,
      offsets,
      persisted,
      evaluations,
      persistedAssessments,
      journeyCalls,
    };
  } finally {
    pool.query = originalQuery;
    globalThis.fetch = originalFetch;
    config.apiKey = originalKey;
  }
}

test("chat refills from the next 300 candidates until 50 accepted listings are persisted", async () => {
  const { result, offsets, persisted, evaluations } = await scenario("refill");
  assert.deepEqual(offsets, [0, 300]);
  assert.equal(evaluations, 4);
  assert.equal(result.result_count, 50);
  assert.equal(persisted?.length, 50);
  assert.equal(new Set(persisted).size, 50);
  assert.ok(persisted?.includes("1"));
  assert.ok(persisted?.includes("301"));
  assert.ok(!persisted?.includes("21"));
});
test("all rejected candidates stop at exhaustion and persist an empty result set", async () => {
  const { result, offsets, persisted } = await scenario("empty");
  assert.deepEqual(offsets, [0, 300]);
  assert.equal(result.result_count, 0);
  assert.deepEqual(persisted, []);
});
test("a model cannot inject a listing ID outside its candidate batch", async () => {
  await assert.rejects(
    scenario("unknown"),
    (error: any) => error.code === "UNKNOWN_LISTING",
  );
});

test("missing journeys trigger a small validated estimation request for the first five homes", async () => {
  const { result, persistedAssessments, journeyCalls } =
    await scenario("journey");
  assert.equal(journeyCalls, 1);
  assert.equal(result.result_count, 50);
  const routed = Object.values(persistedAssessments).filter(
    (assessment: any) => assessment.routes.length > 0,
  );
  assert.equal(routed.length, 5);
  assert.ok(
    routed.every(
      (assessment: any) => assessment.routes[0].destination === "Universidad",
    ),
  );
  assert.ok(result.message.includes("30–50min"));
});
