import type { Feature, MultiPolygon, Position } from "geojson";
import boundary from "./madrid-boundary.json";
export const madridBoundary = boundary as Feature<MultiPolygon>;
export const MADRID_MIN_ZOOM = 8.2;
const rings = madridBoundary.geometry.coordinates.flatMap((p) => p);
const points = rings.flat();
export const MADRID_BOUNDS: [[number, number], [number, number]] = [
  [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
  [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
];
function inRing([x, y]: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (
      Math.abs(cross) < 1e-10 &&
      x >= Math.min(xi, xj) - 1e-10 &&
      x <= Math.max(xi, xj) + 1e-10 &&
      y >= Math.min(yi, yj) - 1e-10 &&
      y <= Math.max(yi, yj) + 1e-10
    )
      return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
export function insideMadrid(point: Position) {
  return madridBoundary.geometry.coordinates.some(
    (p) => inRing(point, p[0]) && !p.slice(1).some((h) => inRing(point, h)),
  );
}
/** Restricts every interaction and programmatic animation to the actual regional outline. */
export function constrainMadrid(point: [number, number]): [number, number] {
  if (insideMadrid(point)) return point;
  let best: [number, number] = [-3.7038, 40.4168],
    distance = Infinity;
  for (const ring of rings)
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1],
        b = ring[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
            (dx * dx + dy * dy || 1),
        ),
      );
      const candidate: [number, number] = [a[0] + t * dx, a[1] + t * dy];
      const d = (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2;
      if (d < distance) {
        distance = d;
        best = candidate;
      }
    }
  return best;
}
export const outsideMadrid: Feature<MultiPolygon> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [-180, -85],
          [180, -85],
          [180, 85],
          [-180, 85],
          [-180, -85],
        ],
        ...madridBoundary.geometry.coordinates.map((p) => p[0]),
      ],
    ],
  },
};
