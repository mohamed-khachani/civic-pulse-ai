import { AsyncLocalStorage } from "node:async_hooks";
import { log } from "./log.js";

type Usage = { calls_started: number; calls: number; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; estimated_cost_usd: number };
const usage = new AsyncLocalStorage<Usage>();
export function recordUsage(item: Omit<Usage, "calls" | "calls_started">) {
  const total = usage.getStore();
  if (!total) return;
  total.calls++;
  for (const key of Object.keys(item) as (keyof typeof item)[]) total[key] += item[key];
}
export function recordCallStart() {
  const total = usage.getStore();
  if (total) total.calls_started++;
}
export async function trackChat<T>(requestId: string, run: () => Promise<T>): Promise<T> {
  return usage.run({ calls_started: 0, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, estimated_cost_usd: 0 }, async () => {
    const start = Date.now();
    let status = "failed";
    try { const result = await run(); status = "completed"; return result; }
    finally { const total = usage.getStore()!; log("chat_usage_total", { request_id: requestId, status, ...total, calls: total.calls_started, usage_reports: total.calls, usage_complete: total.calls === total.calls_started, estimated_cost_is_partial: total.calls !== total.calls_started, estimated_cost_usd: Number(total.estimated_cost_usd.toFixed(6)), elapsed_ms: Date.now() - start }); }
  });
}
