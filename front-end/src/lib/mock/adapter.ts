import type {
  ChatRequest,
  ChatResponse,
  ListingSearchFilters,
  SortOrder,
  GeographicLayer,
} from "@/types";
import { mockListings, mockOptions } from "./data";
import { filterListings } from "@/lib/search";
import { toCsv } from "@/lib/csv";
const wait = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 420);
    signal?.addEventListener("abort", abort, { once: true });
  });
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function parseMockFilters(
  message: string,
  current: ListingSearchFilters,
): ListingSearchFilters {
  const text = normalize(message);
  const next = { ...current };
  if (/limpia|sin filtros|empezar de nuevo|toda madrid/.test(text)) return {};
  const price =
    text.match(
      /(?:menos de|hasta|maximo|presupuesto(?: de)?|por debajo de)\s*([\d.,]+)/,
    ) || text.match(/([\d.,]+)\s*(?:€|euros)/);
  if (price) {
    const value = Number(price[1].replaceAll(".", "").replace(",", "."));
    if (Number.isFinite(value)) next.max_price = value;
  }
  const beds = text.match(/(\d+)\s*(?:habitacion|dormitorio|hab\b)/);
  if (beds) next.min_bedrooms = Number(beds[1]);
  if (/dos habitaciones/.test(text)) next.min_bedrooms = 2;
  for (const key of [
    "furnished",
    "elevator",
    "parking",
    "air_conditioning",
    "terrace",
  ] as const) {
    const pattern = {
      furnished: /amueblad/,
      elevator: /ascensor/,
      parking: /garaje|parking/,
      air_conditioning: /aire acondicionado/,
      terrace: /terraza|balcon/,
    }[key];
    if (pattern.test(text))
      next[key] =
        !/(?:sin|no)\s+(?:amuebl|ascensor|garaje|parking|aire|terraza|balcon)/.test(
          text,
        );
  }
  for (const d of mockOptions.districts)
    if (text.includes(normalize(d))) next.district = d;
  for (const n of mockOptions.neighborhoods)
    if (text.includes(normalize(n))) next.neighborhood = n;
  return next;
}
export const mockApi = {
  async listings(
    filters: ListingSearchFilters,
    sort: SortOrder,
    page = 1,
    signal?: AbortSignal,
  ) {
    await wait(signal);
    const all = filterListings(mockListings, filters, sort);
    return {
      listings: all.slice((page - 1) * 8, page * 8),
      total: all.length,
      page,
      page_size: 8,
    };
  },
  async detail(id: string, signal?: AbortSignal) {
    await wait(signal);
    const listing = mockListings.find((l) => l.id === id);
    if (!listing) throw new Error("No encontramos esta vivienda.");
    return listing;
  },
  async geo(filters: ListingSearchFilters, signal?: AbortSignal) {
    await wait(signal);
    return {
      type: "FeatureCollection" as const,
      features: filterListings(mockListings, filters)
        .filter((l) => l.latitude != null && l.longitude != null)
        .map((l) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [l.longitude!, l.latitude!] as [number, number],
          },
          properties: { id: l.id, price: l.price },
        })),
    };
  },
  async options(signal?: AbortSignal) {
    await wait(signal);
    return mockOptions;
  },
  async layers(signal?: AbortSignal): Promise<GeographicLayer[]> {
    await wait(signal);
    return [
      "Secciones censales",
      "Transporte público",
      "Parques y jardines",
      "Centros sanitarios",
      "Centros educativos",
      "Calidad del aire",
      "Ruido ambiental",
    ].map((name, i) => ({ id: `layer-${i}`, name, available: false }));
  },
  async chat(
    request: ChatRequest,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    await wait(signal);
    const filters = parseMockFilters(request.message, request.filters);
    const matches = filterListings(mockListings, filters);
    const text = normalize(request.message);
    const selected = mockListings.find(
      (l) => l.id === request.selected_listing_id,
    );
    let message = matches.length
      ? `He encontrado ${matches.length} viviendas de ejemplo que encajan con tu búsqueda${filters.district ? ` en ${filters.district}` : ""}. Puedes explorar sus detalles o verlas en el mapa.`
      : "No hay viviendas de ejemplo con estos criterios. Prueba a ampliar el presupuesto o a quitar algún filtro.";
    if (
      /metro|transporte|upm|universidad|tranquil|parque|servicio|zona|ruido|trayecto/.test(
        text,
      )
    )
      message = selected
        ? `Tienes seleccionada «${selected.title}», en ${selected.district}. En esta demostración no disponemos de datos verificados sobre transporte, servicios o tiempos de viaje. Con la API conectada, aquí recibirás la información de la zona. He mantenido tus criterios de búsqueda.`
        : "He aplicado los criterios de vivienda que has indicado. Esta demostración no incluye datos verificados de transporte, ruido o servicios; no puedo priorizar viviendas por esas características. Puedes explorar las opciones disponibles en el mapa.";
    return {
      message,
      conversation_id: request.conversation_id ?? "demo-conversation",
      filters,
      filters_mode: "replace",
      map_action: /mapa|mostrar en mapa/.test(text)
        ? { type: "fit_results" }
        : { type: "none" },
      suggestions: matches.length
        ? [
            "Solo viviendas amuebladas",
            "Por menos de 1.000 €",
            "Ver en el mapa",
          ]
        : ["Limpiar filtros", "Hasta 1.300 €"],
    };
  },
  async export(
    filters: ListingSearchFilters,
    sort: SortOrder,
    signal?: AbortSignal,
  ) {
    await wait(signal);
    return new Blob([toCsv(filterListings(mockListings, filters, sort))], {
      type: "text/csv;charset=utf-8",
    });
  },
};
