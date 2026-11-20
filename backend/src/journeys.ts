import { z } from "zod";
import { askClaude } from "./claude.js";
import type { Assessment, Plan } from "./contracts.js";
import { routeSchema } from "./contracts.js";
import { HttpError } from "./log.js";

export function journeyPriorities(destinations: Plan["destinations"]) {
  return destinations.map((destination) => {
    const days = destination.days.join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const explicitDays = new Set(days.match(/lunes|martes|miercoles|jueves|viernes|sabado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday/g) ?? []);
    const frequency = /todos los dias|diari|every day|daily/.test(days) ? 7
      : /entre semana|laborable|weekdays|lunes a viernes|l-v/.test(days) ? 5
      : /fin de semana|weekends/.test(days) ? 2
      : /ocasional|mensual|quincenal|monthly/.test(days) ? 0.25
      : explicitDays.size || (destination.days.length ? destination.days.length : ["work", "university"].includes(destination.purpose) ? 5 : 1);
    return { destination: destination.label, days_per_week: frequency, importance: frequency >= 3 ? "habitual" : "ocasional" };
  });
}

const schema = z.object({
  estimates: z.array(
    z.object({ id: z.string(), routes: z.array(routeSchema).min(1) }),
  ),
  summary: z.string(),
});
export async function estimateJourneys(
  plan: Plan,
  homes: Record<string, unknown>[],
  requestId: string,
  signal: AbortSignal,
) {
  const result = await askClaude({
    stage: "journeys",
    requestId,
    signal,
    maxTokens: 2500,
    schema,
    jsonSchema: z.toJSONSchema(schema) as any,
    system: `Estima trayectos usando el transport_mode de cada destino (public_transport por defecto; car, bicycle o walking si se indica). Nunca cambies un modo explícito por transporte público. Para un MVP de búsqueda de vivienda en Madrid. El usuario solicita expresamente aproximaciones de IA, no rutas comprobadas. Usa los barrios, coordenadas y conocimiento general de Madrid para dar intervalos amplios y prudentes, incluyendo caminar y esperar. La falta de horarios en directo NO es motivo para omitir una estimación entre lugares identificables. Para cada vivienda suministrada estima un trayecto por cada destino del plan. destination debe coincidir exactamente con label o place de ese destino. Respeta días, hora y dirección, incluyendo universidad, familia y amigos. No inventes líneas concretas: si no conoces una conexión, describe modos y posibles transbordos. minutes_min y minutes_max deben ser números, max>=min. overview debe empezar por 'Orientativo:'. Nunca presentes los cálculos como verificados ni como garantía de llegar a una hora. Si una ubicación es amplia, aumenta el intervalo y menciona su incertidumbre. Al resumir, destaca primero los desplazamientos habituales y después los ocasionales, según journey_priorities y las prioridades expresas del usuario. summary es una sola frase de máximo 45 palabras: el trayecto habitual más relevante de la primera opción, su modo e intervalo, y la aclaración breve 'estimación de IA'. No enumeres viviendas ni desarrolles visitas ocasionales salvo petición expresa. overview máximo 100 caracteres; schedule máximo 60. No repitas cautelas en cada ruta. No uses IDs internos, nombres de campos, SQL ni lotes en summary. Máximo5viviendas.`,
    input: {
      destinations: plan.destinations,
      journey_priorities: journeyPriorities(plan.destinations),
      context: plan.context,
      columns: ["id", "district", "neighborhood", "latitude", "longitude"],
      homes: homes.map((h) => [
        h.id,
        h.district,
        h.neighborhood,
        h.latitude,
        h.longitude,
      ]),
    },
  });
  const allowed = new Set(homes.map((h) => h.id));
  for (const estimate of result.estimates) {
    validateJourneyDestinations(estimate.routes, plan);
    if (!allowed.has(estimate.id))
      throw new HttpError(
        502,
        "Claude devolvió una vivienda ajena a la selección.",
        "UNKNOWN_LISTING",
      );
  }
  if (
    homes.some(
      (home) =>
        !result.estimates.some((e) => e.id === home.id && e.routes.length > 0),
    )
  )
    throw new HttpError(
      502,
      "No se pudieron estimar todos los trayectos de las primeras opciones. Inténtalo de nuevo.",
      "JOURNEY_ESTIMATE_FAILED",
    );
  return result;
}

export function validateJourneyDestinations(
  routes: Assessment["routes"],
  plan: Pick<Plan, "destinations">,
) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toLowerCase();
  const allowed = new Set(
    plan.destinations.flatMap((destination) => [
      normalize(destination.label),
      normalize(destination.place),
    ]),
  );
  if (routes.some((route) => !allowed.has(normalize(route.destination))))
    throw new HttpError(
      502,
      "Claude devolvió un destino ajeno a la consulta.",
      "UNKNOWN_DESTINATION",
    );
}

export function journeyPreview(
  assessments: Assessment[],
  locations: Map<string, Record<string, unknown>>,
): string {
  const homes = assessments
    .slice(0, 2)
    .filter((assessment) => assessment.routes.length > 0);
  if (!homes.length) return "";
  const clean = (value: unknown) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  const lines = ["Trayectos orientativos de las primeras opciones:"];
  for (const [index, assessment] of homes.entries()) {
    const location = locations.get(assessment.id);
    lines.push(
      `Desde ${clean(location?.neighborhood || location?.district || `la opción ${index + 1}`)}:`,
    );
    for (const route of assessment.routes) {
      const overview = clean(route.overview).replace(
        /;?\s*estimación orientativa de IA\.?/gi,
        "",
      );
      lines.push(
        `• ${clean(route.destination)}: ≈ ${route.minutes_min}–${route.minutes_max} min. ${overview}. ${clean(route.schedule)}.`,
      );
    }
  }
  lines.push("Son estimaciones de IA, sin horarios ni conexiones verificados.");
  return lines.join("\n");
}
