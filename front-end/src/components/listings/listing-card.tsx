"use client";
/* Remote listing images are supplied by an external API; native img preserves arbitrary providers. */
/* eslint-disable @next/next/no-img-element */
import { MapPin, Maximize, BedDouble, Bath, Map, ImageOff } from "lucide-react";
import { useState } from "react";
import type { Listing } from "@/types";
import { useAtlas } from "@/stores/atlas-store";
import { euros } from "@/lib/utils";
import { ListingLink } from "./listing-link";
export function ListingImage({
  src,
  alt,
  className = "",
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className={`image-placeholder ${className}`}>
      <ImageOff size={24} />
      <span>Imagen no disponible</span>
    </div>
  );
}
export function ListingCard({
  listing: l,
  compact = false,
}: {
  listing: Listing;
  compact?: boolean;
}) {
  const selected = useAtlas((s) => s.selectedId === l.id);
  return (
    <article
      className={`listing-card ${compact ? "listing-compact" : ""} ${selected ? "selected" : ""}`}
    >
      <ListingLink
        id={l.id}
        url={l.url}
        className="listing-image-button"
        label={`Abrir anuncio: ${l.title}`}
      >
        <ListingImage src={l.images[0]} alt={l.title} />
        {l.compatibility && (
          <span className="compatibility-tag">
            {l.compatibility.score}/100 de compatibilidad
          </span>
        )}
      </ListingLink>
      <div className="listing-copy">
        <div className="listing-price">
          {euros(l.price)}
          <span>/mes</span>
        </div>
        <ListingLink
          id={l.id}
          url={l.url}
          className="listing-title"
        >
          {l.title}
        </ListingLink>
        <p className="listing-location">
          <MapPin size={12} />
          {[l.neighborhood, l.district].filter(Boolean).join(" · ") ||
            "Ubicación no disponible"}
        </p>
        <div className="listing-specs">
          {l.surface_m2 != null && (
            <span>
              <Maximize size={13} />
              {l.surface_m2} m²
            </span>
          )}
          {l.bedrooms != null && (
            <span>
              <BedDouble size={14} />
              {l.bedrooms} hab.
            </span>
          )}
          {l.bathrooms != null && (
            <span>
              <Bath size={13} />
              {l.bathrooms} {l.bathrooms === 1 ? "baño" : "baños"}
            </span>
          )}
        </div>
        <div className="listing-bottom">
          <span>{l.source}</span>
          <button aria-label={`Ver detalles: ${l.title}`} onClick={() => useAtlas.getState().openDetails(l.id)}>Ver detalles</button>
          <button
            onClick={() => {
              const s = useAtlas.getState();
              s.select(l.id);
              s.setMode("map");
              s.act({ type: "focus_listing", listing_id: l.id });
            }}
          >
            <Map size={13} />
            Ver en mapa
          </button>
        </div>
      </div>
    </article>
  );
}
