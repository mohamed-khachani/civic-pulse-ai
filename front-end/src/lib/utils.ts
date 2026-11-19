import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const euros = (value: number) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
export const numbers = (value: number) =>
  new Intl.NumberFormat("es-ES").format(value);
export const featureLabels = {
  furnished: "Amueblado",
  elevator: "Ascensor",
  parking: "Garaje",
  air_conditioning: "Aire acondicionado",
  terrace: "Terraza",
  near_metro: "Cerca del metro",
};
