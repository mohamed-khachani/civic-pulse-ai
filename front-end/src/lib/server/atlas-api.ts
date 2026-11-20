const supported = (path: string, method: string) =>
  method === "POST"
    ? path === "chat"
    : method === "GET" &&
      /^(listings(\/(geo|export|[^/]+)(\/insights)?)?|filters\/options|geo\/(layers|districts|metric-catalog|census-metrics|census-sections(\/28\d{8}\/(insights|data))?))$/.test(path);

export async function handleAtlasRequest(
  request: Request,
  segments: string[],
): Promise<Response> {
  if (segments.some((part) => part === "." || part === ".." || part.includes("/")))
    return Response.json({ error: "Ruta no disponible." }, { status: 404 });
  const path = segments.join("/");
  if (!supported(path, request.method))
    return Response.json({ error: "Ruta no disponible." }, { status: 404 });

  try {
    const base = (process.env.ATLAS_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    const target = new URL(`${base}/api/${path}${new URL(request.url).search}`);
    if (target.origin === new URL(request.url).origin)
      return Response.json({ error: "La API externa no puede apuntar a estas mismas rutas de Next.js." }, { status: 503 });
    const configured = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS ?? 300000);
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(Number.isFinite(configured) ? Math.max(1000, Math.min(300000, configured)) : 300000),
    ]);
    const upstream = await fetch(target, {
      method: request.method,
      headers: {
        Accept: request.headers.get("accept") ?? "application/json",
        ...(request.method === "POST" ? { "Content-Type": "application/json" } : {}),
        ...(request.headers.get("x-request-id") ? { "X-Request-Id": request.headers.get("x-request-id")! } : {}),
      },
      body: request.method === "POST" ? await request.text() : undefined,
      signal,
      cache: "no-store",
    });
    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    });
    for (const name of ["content-disposition", "x-request-id", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const timedOut = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
    console.error("[Atlas gateway] request failed", { path, timedOut });
    return Response.json(
      { error: timedOut ? "La búsqueda está tardando demasiado. Inténtalo de nuevo." : "No podemos conectar con el servicio de Atlas. Inténtalo de nuevo." },
      { status: timedOut ? 504 : 502 },
    );
  }
}
