export const foldArea = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\buniverstiaria\b/g, "universitaria").trim();
export function canonicalNeighborhood(value: string, names: string[]) {
  const folded = foldArea(value).replace(/^ciu$/, "ciudad universitaria");
  return names.find((name) => foldArea(name) === folded);
}
// Scope only an explicit residential request, never a place mentioned as a destination.
export function requestedNeighborhood(message: string, names: string[]) {
  const text = foldArea(message);
  const match = text.match(/(?:vivir|residir|mudarme)\s+(?:solo\s+)?(?:en|a)\s+(.+)|(?:busco|quiero|buscar)\s+(?:un[ao]?\s+)?(?:pisos?|casas?|viviendas?|apartamentos?|habitacion(?:es)?)\b[^.!?]{0,70}?\s+en\s+(.+)|^\s*(?:pisos?|casas?|viviendas?|apartamentos?|habitacion(?:es)?)\s+(?:de alquiler\s+)?en\s+(.+)/);
  if (!match) return undefined;
  const clause = (match[1] || match[2] || match[3]).split(/[,;.!?]|\b(?:pero|porque|para ir|voy a|trabajo en|estudio en)\b/)[0];
  return [...names].sort((a, b) => b.length - a.length).find((name) => {
    const target = foldArea(name);
    return clause.startsWith(target) && !/[a-z]/.test(clause[target.length] || "");
  }) || (/^ciu\b/.test(clause) ? canonicalNeighborhood("CIU", names) : undefined);
}
