import { recordUsage } from "./chat-usage.js";
import { config } from "./config.js";
import { HttpError, log } from "./log.js";
import type { z } from "zod";
import { parseSearch } from "./contracts.js";

export function cleanSchema(value: any): any {
  if (Array.isArray(value)) return value.map(cleanSchema);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value.prefixItems)) {
    const { prefixItems, ...rest } = value;
    const variants = [
      ...new Map(
        prefixItems.map((item: any) => [
          JSON.stringify(cleanSchema(item)),
          cleanSchema(item),
        ]),
      ).values(),
    ];
    return cleanSchema({
      ...rest,
      items: variants.length === 1 ? variants[0] : { anyOf: variants },
    });
  }
  const unsupported = new Set([
    "$schema",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "pattern",
    "format",
    "default",
  ]);
  const schema: any = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !unsupported.has(key))
      .map(([key, item]) => [key, cleanSchema(item)]),
  );
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required || []);
    for (const key of Object.keys(schema.properties))
      if (!required.has(key))
        schema.properties[key] = {
          anyOf: [schema.properties[key], { type: "null" }],
        };
    schema.required = Object.keys(schema.properties);
  }
  return schema;
}
export function normalizeDisplayFields(data: any): any {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data.estimates)) {
    const normalized = normalizeDisplayFields({
      accepted: data.estimates,
      message: data.summary,
      suggestions: [],
    });
    return {
      ...data,
      estimates: normalized.accepted,
      summary: normalized.message,
    };
  }
  if (!Array.isArray(data.accepted)) return data;
  const trim = (value: unknown, length: number) =>
    typeof value === "string" ? value.slice(0, length) : value;
  return {
    ...data,
    message: trim(data.message, 2500),
    suggestions: Array.isArray(data.suggestions)
      ? data.suggestions.slice(0, 3).map((value: unknown) => trim(value, 100))
      : data.suggestions,
    accepted: data.accepted.map((item: any) => ({
      ...item,
      reasons: Array.isArray(item.reasons)
        ? item.reasons.slice(0, 4).map((value: unknown) => trim(value, 250))
        : item.reasons,
      routes: Array.isArray(item.routes)
        ? item.routes.map((route: any) => ({
            ...route,
            destination: trim(route.destination, 200),
            overview: trim(route.overview, 300),
            schedule: trim(route.schedule, 150),
          }))
        : item.routes,
    })),
  };
}
export async function askClaude<T>(args: {
  stage: string;
  requestId: string;
  system: string;
  input: unknown;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  signal: AbortSignal;
  batch?: number;
}): Promise<T> {
  if (!config.apiKey)
    throw new HttpError(
      503,
      "Falta configurar la clave de Claude en el servidor.",
      "CLAUDE_NOT_CONFIGURED",
    );
  const content = JSON.stringify(args.input);
  if (content.length > config.maxInputChars)
    throw new HttpError(
      422,
      "La consulta incluye demasiada información. Acota los criterios o los destinos.",
      "PROMPT_BUDGET",
    );
  const started = Date.now();
  log("claude_started", { request_id: args.requestId, stage: args.stage, batch: args.batch, input_chars: content.length });
  for (let attempt = 0; attempt < 3; attempt++) {
    args.signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: args.maxTokens,
          system: args.system,
          messages: [{ role: "user", content }],
          output_config: {
            ...(config.model.includes("5-5") ? { effort: "low" } : {}),
            format: {
              type: "json_schema",
              schema: cleanSchema(args.jsonSchema),
            },
          },
        }),
        signal: args.signal,
      });
    } catch (error) {
      log("claude_request_failed", {
        request_id: args.requestId,
        stage: args.stage,
        batch: args.batch,
        attempt,
        elapsed_ms: Date.now() - started,
        error: args.signal.aborted ? "aborted" : "network",
      });
      if (args.signal.aborted) throw error;
      if (attempt === 2)
        throw new HttpError(
          502,
          "No se pudo conectar con Claude. Inténtalo de nuevo.",
          "CLAUDE_NETWORK",
        );
      await delay(500 * (attempt + 1), args.signal);
      continue;
    }
    const body = (await response.json()) as any;
    if (!response.ok) {
      log("claude_request_failed", {
        request_id: args.requestId,
        stage: args.stage,
        batch: args.batch,
        status: response.status,
        provider_error_type: body.error?.type,
        provider_error_message:
          typeof body.error?.message === "string"
            ? body.error.message
                .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
                .slice(0, 800)
            : undefined,
        attempt,
        provider_request_id: response.headers.get("request-id"),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await delay(1000 * (attempt + 1), args.signal);
        continue;
      }
      throw new HttpError(
        response.status === 429 ? 429 : 502,
        response.status === 401
          ? "La clave de Claude no es válida. Revisa la configuración del servidor."
          : "Claude no pudo completar la consulta. Inténtalo de nuevo.",
        "CLAUDE_UPSTREAM",
      );
    }
    const usage = body.usage || {};
    const input = Number(usage.input_tokens || 0),
      output = Number(usage.output_tokens || 0),
      cacheRead = Number(usage.cache_read_input_tokens || 0),
      cacheWrite = Number(usage.cache_creation_input_tokens || 0);
    const long = input + cacheRead + cacheWrite > 100000;
    const inputRate = Number(
      process.env.CLAUDE_INPUT_PRICE_PER_MILLION || (long ? 0.5 : 0.1),
    );
    const outputRate = Number(
      process.env.CLAUDE_OUTPUT_PRICE_PER_MILLION || (long ? 2.5 : 0.5),
    );
    const estimate =
      (input * inputRate +
        output * outputRate +
        cacheRead * inputRate * 0.1 +
        cacheWrite * inputRate * 1.25) /
      1e6;
    recordUsage({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite, estimated_cost_usd: estimate });
    log("claude_usage", {
      request_id: args.requestId,
      stage: args.stage,
      batch: args.batch,
      model: body.model,
      provider_request_id: response.headers.get("request-id"),
      attempt,
      input_tokens: input,
      output_tokens: output,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
      estimated_cost_usd: Number(estimate.toFixed(6)),
      pricing_basis: "configurable Haiku 5.5 estimate",
      elapsed_ms: Date.now() - started,
      stop_reason: body.stop_reason,
    });
    if (body.stop_reason === "max_tokens")
      throw new HttpError(
        502,
        "Claude alcanzó el límite de respuesta. Acota la búsqueda e inténtalo de nuevo.",
        "CLAUDE_OUTPUT_LIMIT",
      );
    const text = (body.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError(
        502,
        "Claude envió una respuesta no válida.",
        "CLAUDE_INVALID_RESPONSE",
      );
    }
    if (
      data &&
      typeof data === "object" &&
      "filters" in data &&
      Array.isArray(data.filters)
    ) {
      const entries: Record<string, string> = {};
      for (const entry of data.filters) {
        if (
          !entry ||
          typeof entry.field !== "string" ||
          typeof entry.value !== "string" ||
          Object.hasOwn(entries, entry.field)
        )
          throw new HttpError(
            502,
            "Claude devolvió filtros no válidos.",
            "CLAUDE_INVALID_RESPONSE",
          );
        entries[entry.field] = entry.value;
      }
      data = { ...data, filters: parseSearch(entries) };
    }
    if (
      data &&
      typeof data === "object" &&
      "filters" in data &&
      data.filters &&
      typeof data.filters === "object"
    ) {
      data = {
        ...data,
        filters: Object.fromEntries(
          Object.entries(data.filters).filter(([, value]) => value !== null),
        ),
      };
    }
    if (args.stage === "evaluate" || args.stage === "journeys")
      data = normalizeDisplayFields(data);
    const parsed = args.schema.safeParse(data);
    if (!parsed.success) {
      log("claude_validation_failed", {
        request_id: args.requestId,
        stage: args.stage,
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          code: i.code,
        })),
      });
      throw new HttpError(
        502,
        "La respuesta de Claude no cumple el formato esperado. Inténtalo de nuevo.",
        "CLAUDE_INVALID_RESPONSE",
      );
    }
    return parsed.data;
  }
  throw new HttpError(502, "Claude no pudo completar la consulta.");
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
