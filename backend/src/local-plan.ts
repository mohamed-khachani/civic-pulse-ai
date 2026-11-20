import type { Filters, Plan } from "./contracts.js";
import { canonicalNeighborhood, foldArea } from "./geography.js";

// Only complete, unambiguous requests qualify; additional requirements stay on the model path.
export function localNeighborhoodPlan(message: string, names: string[], filters: Filters, previous?: Plan, selectedId?: string): Plan | undefined {
  if (selectedId || previous?.preferences.length || previous?.destinations.length || previous?.area_order.length || previous?.area_filters.length) return;
  const match = foldArea(message).match(/^(?:(?:busco|quiero|buscar)\s+(?:(?:un|una|unos|unas)\s+)?(?:casas?|pisos?|viviendas?|apartamentos?)|(?:casas?|pisos?|viviendas?|apartamentos?)|(?:quiero\s+)?(?:vivir|residir|mudarme))\s+(?:en|a)\s+(.+?)[.!?]*$/);
  if (!match) return;
  const neighborhood = canonicalNeighborhood(match[1], names);
  if (!neighborhood) return;
  const { district: _district, census_section: _section, bounds: _bounds, ...rest } = filters;
  return { entire_home: true, filters: { ...rest, neighborhood }, area_filters: [], area_order: [], sort: "recommended", preferences: [], destinations: [], context: `Vivienda completa en ${neighborhood}.`, clarification: null };
}
