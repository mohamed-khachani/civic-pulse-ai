"use client";
import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { euros, numbers } from "@/lib/utils";
import type { SortOrder } from "@/types";
import { ListingImage } from "../listings/listing-card";
import { ListingLink } from "../listings/listing-link";

const highlights: { sort: SortOrder; label: string; unit: "price" | "surface" }[] = [
  { sort: "price_desc", label: "El alquiler más alto de nuestra base", unit: "price" },
  { sort: "surface_desc", label: "Un anuncio con la mayor superficie de nuestra base", unit: "surface" },
  { sort: "price_asc", label: "El anuncio con menor alquiler de nuestra base", unit: "price" },
];
export function WaitingListing() {
  const [index, setIndex] = useState(0);
  const reducedMotion = useReducedMotion();
  const queries = useQueries({ queries: highlights.map(({ sort }) => ({
    queryKey: ["waiting-listings", sort],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.listings({}, sort, 1, signal),
    staleTime: 300000,
  })) });
  const cards = highlights.flatMap((highlight, i) => {
    const listing = queries[i].data?.listings[0];
    return listing?.url ? [{ ...highlight, listing }] : [];
  });
  const total = queries[0].data?.total;
  const count = cards.length + (total ? 1 : 0);
  useEffect(() => {
    if (count < 2) return;
    const timer = setInterval(() => setIndex((current) => (current + 1) % count), 8000);
    return () => clearInterval(timer);
  }, [count]);
  if (!count) return null;
  const current = cards[index % count];
  return <aside className="waiting-discovery" aria-label="Curiosidades mientras buscas">
    <p>Mientras buscamos, una curiosidad de nuestros anuncios:</p>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={current?.sort ?? "total"} initial={{ opacity: reducedMotion ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reducedMotion ? 1 : 0 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
        {current ? <ListingLink id={current.listing.id} url={current.listing.url} className="waiting-property" label={`Abrir anuncio: ${current.listing.title}`}>
          <ListingImage src={current.listing.images[0]} alt={current.listing.title} />
          <span><small>{current.label}</small><strong>{current.unit === "surface" ? `${numbers(current.listing.surface_m2 ?? 0)} m²` : `${euros(current.listing.price)}/mes`}</strong><span>{current.listing.title}</span><small>Ver anuncio original <ExternalLink size={12} /></small></span>
        </ListingLink> : <div className="waiting-fact"><strong>{numbers(total!)} anuncios de alquiler</strong><p>Es el inventario disponible en nuestra base de datos, procedente de Fotocasa y pisos.com. Tu consulta seleccionará solo los que encajen contigo.</p></div>}
      </motion.div>
    </AnimatePresence>
    <div className="waiting-dots" aria-label="Elegir curiosidad">{Array.from({ length: count }, (_, i) => <button key={i} className={index % count === i ? "active" : ""} aria-label={`Curiosidad ${i + 1}`} aria-pressed={index % count === i} onClick={() => setIndex(i)} />)}</div>
  </aside>;
}
