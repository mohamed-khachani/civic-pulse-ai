import type { GeographicLayer, MapViewport, ListingGeoFeature } from "@/types";
/** Derive a scale from the supplied layer's values, never an invented 0–100 score. */
export function metricRange(
  layer: GeographicLayer,
): [number, number] | undefined {
  if (!layer.metric || !layer.geojson) return;
  const values = layer.geojson.features
    .map((f) => f.properties?.[layer.metric!])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!values.length) return;
  return [Math.min(...values), Math.max(...values)];
}

export function viewportCamera(viewport: MapViewport) {
  return {
    center: [viewport.longitude, viewport.latitude] as [number, number],
    zoom: viewport.zoom,
  };
}

export function markerPill(selected = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 144;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = selected ? "#16803c" : "#ffffff";
  ctx.strokeStyle = selected ? "#116b32" : "#b6cbbb";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(1, 1, 70, 30, 15);
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, 144, 64);
}

/** Full result geometry, not the paginated cards. Degenerate bounds are valid for fitBounds + maxZoom. */
export function resultBounds(
  features: ListingGeoFeature[],
): [[number, number], [number, number]] | undefined {
  if (!features.length) return;
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (const f of features) {
    const [x, y] = f.geometry.coordinates;
    west = Math.min(west, x);
    south = Math.min(south, y);
    east = Math.max(east, x);
    north = Math.max(north, y);
  }
  return [
    [west, south],
    [east, north],
  ];
}
export const resultSignature = (features: ListingGeoFeature[]) =>
  features
    .map((f) => `${f.properties.id}:${f.geometry.coordinates.join(",")}`)
    .sort()
    .join("|");
