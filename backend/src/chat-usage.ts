import { AsyncLocalStorage } from "node:async_hooks";
import { log } from "./log.js";

type Usage = { calls: number; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; estimated_cost_usd: number };
const usage = new AsyncLocalStorage<Usage>();
export function recordUsage(item: Omit<Usage, "calls">) {
  const total = usage.getStore();
  if (!total) return;
  total.calls++;
  for (const key of Object.keys(item) as (keyof typeof item)[]) total[key] += item[key];
}
export async function trackChat<T>(requestId: string, run: () => Promise<T>): Promise<T> {
  return usage.run({ calls: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, estimated_cost_usd: 0 }, async () => {
    const start = Date.now();
    let status = "failed";
    try { const result = await run(); status = "completed"; return result; }
    finally { const total = usage.getStore()!; log("chat_usage_total", { request_id: requestId, status, ...total, estimated_cost_usd: Number(total.estimated_cost_usd.toFixed(6)), elapsed_ms: Date.now() - start }); }
  });
}
