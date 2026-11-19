import { test, expect } from "@playwright/test";
test("conversation, filters, details, map preservation and complete export", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Un nuevo hogar/ }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Cuéntanos qué vivienda buscas" })
    .fill("Busco un piso de 2 habitaciones por menos de 1.200 €.");
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  await expect(
    page.getByText(/He encontrado \d+ viviendas de ejemplo/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Quitar filtro: Hasta.*1.?200/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Ver detalles:/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Conoce la zona" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await page
    .getByRole("button", { name: "Explorar mapa", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Mapa de viviendas de Madrid" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Conversación", exact: true }).click();
  await expect(
    page.getByText(/He encontrado \d+ viviendas de ejemplo/),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(
    /atlas-madrid-listings-.*\.csv/,
  );
});
test("mobile welcome and mode navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Explorar mapa", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Filtros", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Conversación", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Un nuevo hogar/ }),
  ).toBeVisible();
});
