import test from "node:test";
import assert from "node:assert/strict";
import { recordUsage, recordCallStart, trackChat } from "../src/chat-usage.js";

test("parallel calls accumulate usage per chat without mixing concurrent users", async () => {
  const original = console.log;
  const environment = process.env.NODE_ENV;
  const lines: any[] = [];
  delete process.env.NODE_ENV;
  console.log = (line) => { lines.push(JSON.parse(line)); };
  const add = (input: number) => { recordCallStart(); recordUsage({ input_tokens: input, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, estimated_cost_usd: 0.001 }); };
  try {
    await Promise.all([
      trackChat("one", async () => { await Promise.all([Promise.resolve().then(() => add(10)), Promise.resolve().then(() => add(20))]); }),
      trackChat("two", async () => { add(100); }),
      trackChat("partial", async () => { recordCallStart(); }),
    ]);
    const one = lines.find((line) => line.request_id === "one");
    const two = lines.find((line) => line.request_id === "two");
    assert.equal(one.calls, 2);
    assert.equal(one.usage_complete, true);
    assert.equal(one.input_tokens, 30);
    assert.equal(one.output_tokens, 10);
    assert.equal(one.estimated_cost_usd, 0.002);
    assert.equal(two.input_tokens, 100);
    const partial = lines.find((line) => line.request_id === "partial");
    assert.equal(partial.calls, 1);
    assert.equal(partial.usage_reports, 0);
    assert.equal(partial.usage_complete, false);
    assert.equal(partial.estimated_cost_is_partial, true);
  } finally { console.log = original; if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment; }
});
