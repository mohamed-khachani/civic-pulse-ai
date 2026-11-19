import { z } from "zod";
export const isMock =
  process.env.NEXT_PUBLIC_USE_MOCK_API === "true" ||
  (process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_USE_MOCK_API === undefined);
export const endpoints = {
  chat: "/api/chat",
  listings: "/api/listings",
  detail: (id: string) => `/api/listings/${encodeURIComponent(id)}`,
  geo: "/api/listings/geo",
  export: "/api/listings/export",
  options: "/api/filters/options",
  districts: "/api/geo/districts",
  census: "/api/geo/census-sections",
  layers: "/api/geo/layers",
  censusMetrics: "/api/geo/census-metrics",
  insights: (id: string) => `/api/listings/${encodeURIComponent(id)}/insights`,
};
const base = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/$/, "");
export async function request(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const configuredTimeout = Number(
    process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 90000,
  );
  const timeout = AbortSignal.timeout(
    Number.isFinite(configuredTimeout)
      ? Math.max(1000, Math.min(300000, configuredTimeout))
      : 90000,
  );
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  try {
    const response = await fetch(base + path, {
      ...init,
      signal,
      headers: { Accept: "application/json", ...init.headers },
    });
    if (!response.ok)
      throw new Error(
        `El servicio devolvió un error (${response.status}). Inténtalo de nuevo.`,
      );
    return response;
  } catch (error) {
    if (timeout.aborted)
      throw new Error(
        "El servicio tarda demasiado en responder. Inténtalo de nuevo.",
      );
    if (init.signal?.aborted) throw error;
    if (error instanceof TypeError)
      throw new Error(
        "No podemos conectar con Atlas. Comprueba que la API esté disponible.",
      );
    throw error;
  }
}
export async function json<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await request(path, init);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("El servicio ha enviado una respuesta no válida.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error("Los datos del servicio no tienen el formato esperado.");
  return parsed.data;
}
