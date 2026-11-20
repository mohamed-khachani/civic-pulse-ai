import { test, expect, type Page } from "@playwright/test";

const listings = [
  { id: "123", source: "pisos.com", url: "https://www.pisos.com/test", title: "Piso en Centro", price: 1100, bedrooms: 2, bathrooms: 1, surface_m2: 65, district: "Centro", neighborhood: "Palacio", latitude: 40.4168, longitude: -3.7038, images: [], insights: { metrics: [{ label: "Trayecto al campus", value: "30–45 min", detail: "Estimación de IA, sin horarios verificados", kind: "estimated", scope: "listing" }] } },
  { id: "124", source: "Fotocasa", url: "https://www.fotocasa.es/test", title: "Piso en Chamberí", price: 1150, bedrooms: 2, bathrooms: 1, surface_m2: 70, district: "Chamberí", neighborhood: "Trafalgar", latitude: 40.4326, longitude: -3.7013, images: [] },
];
async function interceptApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/listings/export") return route.fulfill({ contentType: "text/csv", body: "id,title\r\n123,Piso en Centro\r\n124,Piso en Chamberí" });
    let body: unknown;
    if (path === "/api/chat") body = { message: "He encontrado 2 viviendas. Los trayectos son estimaciones de IA.", conversation_id: "conversation-1", result_set_id: "search-1", filters: { max_price: 1200, min_bedrooms: 2 }, filters_mode: "replace", suggestions: [] };
    else if (path === "/api/listings") body = { listings, total: 2, page: 1, page_size: 8, result_set_id: "search-1" };
    else if (path === "/api/listings/geo") body = { type: "FeatureCollection", features: listings.map((l) => ({ type: "Feature", geometry: { type: "Point", coordinates: [l.longitude, l.latitude] }, properties: { id: l.id, price: l.price } })) };
    else if (path.startsWith("/api/listings/")) body = listings.find((l) => path.endsWith(l.id));
    else if (path === "/api/filters/options") body = { districts: ["Centro", "Chamberí"], neighborhoods: ["Palacio", "Trafalgar"], sources: ["pisos.com", "Fotocasa"], features: ["furnished", "elevator", "parking", "air_conditioning", "terrace"], sorts: ["recommended", "price_asc", "price_desc", "surface_desc"] };
    else if (path === "/api/geo/census-metrics") body = { sections: [], metrics: [] };
    else if (path === "/api/geo/census-sections") body = { type: "FeatureCollection", features: [] };
    else body = [];
    return route.fulfill({ json: body });
  });
}

test.beforeEach(async ({ page }) => interceptApi(page));

test("conversation, real-data contracts, details, map preservation and export", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Un nuevo hogar/ })).toBeVisible();
  await expect(page.getByText("DEMO", { exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Cuéntanos qué vivienda buscas" }).fill("Busco un piso de 2 habitaciones por menos de 1.200 €.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(page.getByText(/He encontrado 2 viviendas/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Quitar filtro: Hasta.*1.?200/ })).toBeVisible();
  const detailRequest = page.waitForRequest((request) => request.url().includes("/api/listings/123?result_set_id=search-1"));
  await page.getByRole("button", { name: /Ver detalles:/ }).first().click();
  await detailRequest;
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Conoce la zona" })).toBeVisible();
  await expect(page.getByText("Estimación de IA, sin horarios verificados", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page.getByRole("button", { name: "Explorar mapa", exact: true }).click();
  await expect(page.getByRole("region", { name: "Mapa de viviendas de Madrid" })).toBeVisible();
  await page.getByRole("button", { name: "Conversación", exact: true }).click();
  await expect(page.getByText(/He encontrado 2 viviendas/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/atlas-madrid-listings-.*\.csv/);
});

test("mobile welcome and mode navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Explorar mapa", exact: true }).click();
  await expect(page.getByRole("button", { name: "Filtros", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Conversación", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Un nuevo hogar/ })).toBeVisible();
});

test("cluster click opens all members without forced zoom and loads only one page of details", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const points = Array.from({ length: 60 }, (_, index) => ({ ...listings[0], id: String(3000 + index), title: `Vivienda ${index + 1}`, price: 1000 + index }));
  const detailRequests = new Set<string>();
  await page.route("https://basemaps.cartocdn.com/gl/positron-gl-style/style.json", (route) => route.fulfill({ json: {
    version: 8, glyphs: "https://atlas.test/glyphs/{fontstack}/{range}.pbf", sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#eef3ef" } }],
  } }));
  await page.route("https://atlas.test/glyphs/**", (route) => route.fulfill({ contentType: "application/x-protobuf", body: Buffer.alloc(0) }));
  await page.route("**/api/listings**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/listings/geo") return route.fulfill({ json: { type: "FeatureCollection", features: points.map((listing) => ({ type: "Feature", geometry: { type: "Point", coordinates: [listing.longitude, listing.latitude] }, properties: { id: listing.id, price: listing.price } })) } });
    if (path === "/api/listings") return route.fulfill({ json: { listings: points.slice(0, 8), total: points.length, page: 1, page_size: 8 } });
    const listing = points.find((point) => path === `/api/listings/${point.id}`);
    if (listing) {
      detailRequests.add(listing.id);
      return route.fulfill({ json: listing });
    }
    return route.fallback();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Explorar mapa", exact: true }).click();
  await expect(page.getByRole("button", { name: "Buscar en esta zona", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Volver a Madrid", exact: true }).click();
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(300);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Map canvas has no bounds");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const group = page.getByRole("region", { name: "Viviendas en este punto" });
  await expect(group.getByRole("heading", { name: "60 viviendas en esta zona" })).toBeVisible();
  await expect(group.getByText("1–6 de 60", { exact: true })).toBeVisible();
  await expect.poll(() => detailRequests.size).toBe(6);
  await group.getByRole("button", { name: "Más viviendas en este punto" }).click();
  await expect(group.getByText("7–12 de 60", { exact: true })).toBeVisible();
  await expect.poll(() => detailRequests.size).toBe(12);
  await group.getByRole("button", { name: "Ver detalles", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await group.getByRole("button", { name: "Acercar esta zona" }).click();
  await expect(group.getByRole("heading", { name: "60 viviendas en esta zona" })).toBeVisible();
  // Co-located homes remain a group even well beyond the former zoom-13 cutoff.
  for (let zoom = 0; zoom < 4; zoom++) await page.getByRole("button", { name: "Acercar mapa", exact: true }).click();
  await expect(group.getByRole("heading", { name: "60 viviendas en esta zona" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar vista previa", exact: true }).click();
  await page.waitForTimeout(300);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(group.getByRole("heading", { name: "60 viviendas en esta zona" })).toBeVisible();
  await expect(group.getByText("1–6 de 60", { exact: true })).toBeVisible();
});

test("waiting content and listing cards open original adverts in another tab", async ({ page, context }) => {
  let finishChat!: () => void;
  const waiting = new Promise<void>((resolve) => { finishChat = resolve; });
  await page.route("**/api/chat", async (route) => {
    await waiting;
    await route.fulfill({ json: { message: "Búsqueda preparada.", conversation_id: "test", result_set_id: "search-1", filters: {}, suggestions: [] } });
  });
  await context.route("https://www.pisos.com/test", (route) => route.fulfill({ contentType: "text/html", body: "<title>Anuncio original</title>" }));
  await page.goto("/");
  await page.getByRole("textbox", { name: "Cuéntanos qué vivienda buscas" }).fill("Busco piso.");
  await page.getByRole("button", { name: "Enviar mensaje", exact: true }).click();
  const discovery = page.getByRole("complementary", { name: "Curiosidades mientras buscas" });
  await expect(discovery).toBeVisible();
  await expect(page.getByRole("region", { name: "Viviendas encontradas" })).toHaveCount(0);
  await discovery.getByRole("button", { name: "Curiosidad 2", exact: true }).click();
  await expect(discovery.getByText("Un anuncio con la mayor superficie de nuestra base")).toBeVisible();
  await discovery.getByRole("button", { name: "Curiosidad 1", exact: true }).click();
  const link = discovery.getByRole("link", { name: "Abrir anuncio: Piso en Centro" });
  await expect(link).toHaveAttribute("target", "_blank");
  const opened = context.waitForEvent("page");
  await link.click();
  const advert = await opened;
  await advert.waitForLoadState();
  expect(advert.url()).toBe("https://www.pisos.com/test");
  await advert.close();
  finishChat();
  await expect(page.getByText("Búsqueda preparada.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir anuncio: Piso en Centro" })).toHaveAttribute("target", "_blank");
});
