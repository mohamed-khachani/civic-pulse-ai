/** Public INE 2025 geometry snapshot. No housing data or environmental estimates. */
import { mkdir, writeFile } from "node:fs/promises";
import polygonClipping from "polygon-clipping";
const base =
  "https://www.ine.es/servergis/rest/services/Hosted/Censo_2025___Número_de_personas/FeatureServer";
async function query(layer, extra = {}) {
  const params = new URLSearchParams({
    where: "cpro='28'",
    outSR: "4326",
    geometryPrecision: "5",
    maxAllowableOffset: "0.00005",
    f: "geojson",
    ...extra,
  });
  const r = await fetch(`${base}/${layer}/query?${params}`, {
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`INE: ${r.status}`);
  const data = await r.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data;
}
const municipality = await query(0, { outFields: "cumun,nmun" });
const union = polygonClipping.union(
  ...municipality.features.map((f) => f.geometry.coordinates),
);
// A simplified 5 m snapshot can leave tiny inter-municipal slivers; only retain true outer outlines.
const boundary = {
  type: "Feature",
  properties: { name: "Comunidad de Madrid", source: "INE", year: 2025 },
  geometry: { type: "MultiPolygon", coordinates: union.map((p) => [p[0]]) },
};
const features = [];
for (let offset = 0; ; offset += 2000) {
  const page = await query(2, {
    outFields: "cusec,nmun,n_personas",
    orderByFields: "objectid_1",
    resultOffset: String(offset),
    resultRecordCount: "2000",
  });
  if (!page.features) throw new Error("INE did not return census features");
  features.push(
    ...page.features.map((f) => ({
      ...f,
      id: f.properties.cusec,
      properties: {
        id: f.properties.cusec,
        municipality: f.properties.nmun,
        population: f.properties.n_personas,
      },
    })),
  );
  if (page.features.length < 2000) break;
}
if (
  features.length < 4000 ||
  new Set(features.map((f) => f.id)).size !== features.length
)
  throw new Error("Incomplete or duplicate Madrid census snapshot");
await mkdir("public/geo", { recursive: true });
await writeFile("public/geo/madrid-boundary.geojson", JSON.stringify(boundary));
await mkdir("src/lib/geo", { recursive: true });
await writeFile("src/lib/geo/madrid-boundary.json", JSON.stringify(boundary));
await writeFile(
  "public/geo/madrid-census-2025.geojson",
  JSON.stringify({ type: "FeatureCollection", features }),
);
await writeFile(
  "public/geo/README.md",
  `# Comunidad de Madrid · cartografía INE 2025\n\nSeccionado cedido por el Instituto Nacional de Estadística.\n\nSource: ${base}\n\n${features.length} census sections across 179 municipalities. WGS84, simplified at approximately 5 m, five decimal places. Administrative display/navigation only; not cadastral precision. Boundary dissolved from municipal outlines. Internal sliver holes from simplification are removed.\n\nRebuild: npm run geo:refresh (internet required). Environmental metrics are supplied separately by the API; no measured noise or air-quality data are contained in these files.\n`,
);
console.log(
  `Saved ${features.length} census sections and ${union.length} regional polygons.`,
);
