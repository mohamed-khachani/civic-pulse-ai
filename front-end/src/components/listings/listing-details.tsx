"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MapPin,
  Maximize,
  BedDouble,
  Bath,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Check,
  Info,
  LoaderCircle,
  TrainFront,
} from "lucide-react";
import { useAtlas } from "@/stores/atlas-store";
import { api } from "@/lib/api";
import { euros, featureLabels } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { ListingImage } from "./listing-card";
import { ListingLink } from "./listing-link";
export function ListingDetails() {
  const id = useAtlas((s) => s.detailsId);
  return (
    <Dialog
      open={!!id}
      onOpenChange={(open) => {
        if (!open) useAtlas.getState().openDetails(undefined);
      }}
    >
      {id && <DetailsBody key={id} id={id} />}
    </Dialog>
  );
}
function DetailsBody({ id }: { id: string }) {
  const resultSetId = useAtlas((s) => s.resultSetId);
  const {
    data: l,
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ["detail", id, resultSetId],
    queryFn: ({ signal }) => api.detail(id, signal, resultSetId),
  });
  const [image, setImage] = useState(0);
  return (
    <DialogContent className="details-dialog">
      <DialogTitle className="sr-only">
        {l?.title ?? "Detalles de la vivienda"}
      </DialogTitle>
      <DialogDescription className="sr-only">
        Características, fotografías y datos disponibles de la zona.
      </DialogDescription>
      {isPending ? (
        <div className="details-loading">
          <LoaderCircle className="spin" />
          Cargando la vivienda…
        </div>
      ) : error ? (
        <div className="empty-state">
          <h2>No se ha podido cargar</h2>
          <p>{error.message}</p>
          <Button onClick={() => void refetch()}>Reintentar</Button>
        </div>
      ) : (
        l && (
          <>
            <div className="detail-gallery">
              <ListingImage
                src={l.images[image]}
                alt={`${l.title}, imagen ${image + 1}`}
              />
              {l.images.length > 1 && (
                <div className="gallery-controls">
                  <button
                    aria-label="Imagen anterior"
                    onClick={() =>
                      setImage(
                        (i) => (i - 1 + l.images.length) % l.images.length,
                      )
                    }
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span>
                    {image + 1} / {l.images.length}
                  </span>
                  <button
                    aria-label="Imagen siguiente"
                    onClick={() => setImage((i) => (i + 1) % l.images.length)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              )}
            </div>
            <div className="details-body">
              <div className="detail-top">
                <div>
                  <span className="eyebrow">
                    {l.source}
                  </span>
                  <h2><ListingLink id={l.id} url={l.url}>{l.title}</ListingLink></h2>
                  <p className="listing-location">
                    <MapPin size={14} />
                    {[l.neighborhood, l.district, "Madrid"]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="detail-price">
                  {euros(l.price)}
                  <span>/mes</span>
                </div>
              </div>
              <div className="detail-specs">
                {l.surface_m2 != null && (
                  <span>
                    <Maximize />
                    {l.surface_m2} m²
                  </span>
                )}
                {l.bedrooms != null && (
                  <span>
                    <BedDouble />
                    {l.bedrooms} habitaciones
                  </span>
                )}
                {l.bathrooms != null && (
                  <span>
                    <Bath />
                    {l.bathrooms} {l.bathrooms === 1 ? "baño" : "baños"}
                  </span>
                )}
              </div>
              {l.description && (
                <section>
                  <h3>Un poco más sobre este hogar</h3>
                  <p>{l.description}</p>
                </section>
              )}
              <div className="amenities">
                {(
                  [
                    "furnished",
                    "elevator",
                    "parking",
                    "air_conditioning",
                    "terrace",
                  ] as const
                )
                  .filter((k) => l[k] === true)
                  .map((k) => (
                    <span key={k}>
                      <Check size={14} />
                      {featureLabels[k]}
                    </span>
                  ))}
              </div>
              {l.compatibility && (
                <section className="compatibility-detail">
                  <h3>
                    {l.compatibility.score}/100 · Compatibilidad con tu búsqueda
                  </h3>
                  <ul>
                    {l.compatibility.explanation.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </section>
              )}
              <section className="zone-insights">
                <span className="zone-icon">
                  <TrainFront size={20} />
                </span>
                <h3>Conoce la zona</h3>
                {l.insights?.metrics.length ? (
                  <div className="insight-grid">
                    {l.insights.metrics.map((m) => (
                      <div key={m.label}>
                        <span>{m.label}</span>
                        <strong>{m.value}</strong>
                        <p>{m.detail}</p>
                        <small>
                          {m.kind === "estimated" ? "Estimación" : "Medición"} ·{" "}
                          {m.scope === "district"
                            ? "Distrito"
                            : m.scope === "neighborhood"
                              ? "Barrio"
                              : m.scope === "census"
                                ? "Sección censal"
                                : "Vivienda"}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>
                    {l.insights?.note ??
                      "Todavía no hay información de transporte, servicios o calidad ambiental disponible para esta vivienda."}
                  </p>
                )}
              </section>
              <div className="detail-actions">
                <Button
                  variant="outline"
                  onClick={() => {
                    const s = useAtlas.getState();
                    s.openDetails(undefined);
                    s.setMode("map");
                    s.act({ type: "focus_listing", listing_id: l.id });
                  }}
                >
                  Ver en mapa
                </Button>
                {l.url && /^https?:\/\//.test(l.url) ? (
                  <Button asChild>
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      Ver anuncio original
                      <ExternalLink size={16} />
                    </a>
                  </Button>
                ) : (
                  <span className="source-notice">
                    <Info size={15} />
                    Enlace al anuncio no disponible
                  </span>
                )}
              </div>
            </div>
          </>
        )
      )}
    </DialogContent>
  );
}
