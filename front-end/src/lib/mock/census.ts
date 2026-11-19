import type { CensusCollection, CensusMetric } from "@/types";
/** Demonstration values only. Real INE geometry is kept separate from synthetic environmental data. */
export async function mockCensusMetrics(
  signal?: AbortSignal,
): Promise<CensusMetric[]> {
  const response = await fetch("/geo/madrid-census-2025.geojson", { signal });
  if (!response.ok)
    throw new Error("No se pudieron cargar las variables de ejemplo.");
  const sections = (await response.json()) as CensusCollection;
  const values = (min: number, span: number) =>
    Object.fromEntries(
      sections.features.map((f, i) => [
        f.properties.id,
        i % 19 === 0
          ? null
          : min + ((Number(f.properties.id.slice(-5)) * 17) % span),
      ]),
    );
  return [
    {
      id: "noise",
      name: "Contaminación acústica",
      unit: "dB",
      kind: "synthetic",
      source: "Atlas · valores sintéticos de demostración",
      description:
        "Ejemplo visual por sección censal. No son mediciones reales de ruido ni un mapa acústico oficial.",
      stops: [
        { value: 40, color: "#c9e8d4" },
        { value: 55, color: "#f3d67a" },
        { value: 70, color: "#dd7a65" },
      ],
      values: values(40, 31),
    },
    {
      id: "air",
      name: "Calidad del aire · NO₂",
      unit: "µg/m³",
      kind: "synthetic",
      source: "Atlas · valores sintéticos de demostración",
      description:
        "Concentraciones ficticias para probar la visualización. No representan la calidad del aire actual.",
      stops: [
        { value: 10, color: "#c6dfed" },
        { value: 30, color: "#aca0ce" },
        { value: 50, color: "#875077" },
      ],
      values: values(10, 41),
    },
    {
      id: "population",
      name: "Población · censo 2025",
      unit: "personas",
      kind: "observed",
      source: "INE · Censo 2025",
      year: 2025,
      description:
        "Número de personas del censo por sección. No es una medición de ruido ni de calidad ambiental.",
      stops: [
        { value: 0, color: "#e0edf5" },
        { value: 2000, color: "#7dacc9" },
        { value: 6000, color: "#315f86" },
      ],
      values: Object.fromEntries(
        sections.features.map((f) => [
          f.properties.id,
          f.properties.population ?? null,
        ]),
      ),
    },
  ];
}
