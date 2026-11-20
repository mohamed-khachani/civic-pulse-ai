"use client";
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Popup } from "react-map-gl/maplibre";
import type { GeoJSONSource, PositionAnchor } from "maplibre-gl";
import { ChevronLeft, ChevronRight, LoaderCircle, Scan } from "lucide-react";
import { api } from "@/lib/api";
import { euros } from "@/lib/utils";
import { listingMembers } from "@/lib/map-interactions";
import { useAtlas } from "@/stores/atlas-store";
import type { ListingGeoFeature } from "@/types";
import { Button } from "../ui/button";
import { ListingLink } from "../listings/listing-link";

export interface ListingGroup {
  key: string;
  longitude: number;
  latitude: number;
  total: number;
  clusterId?: number;
  members?: ListingGeoFeature[];
  searchRevision: number;
  resultKey?: string;
  anchor: PositionAnchor;
}
const PAGE_SIZE = 6;

export function ListingGroupPopup({ group, getSource, resultSetId, onClose, onFit }: {
  group: ListingGroup;
  getSource: () => GeoJSONSource | undefined;
  resultSetId?: string;
  onClose: () => void;
  onFit: (members: ListingGeoFeature[]) => void;
}) {
  const [page, setPage] = useState(0);
  const selectedId = useAtlas((s) => s.selectedId);
  const members = useQuery({
    queryKey: ["map-group", group.key],
    queryFn: async () => {
      if (group.members) return group.members;
      const source = getSource();
      if (!source || group.clusterId === undefined) throw new Error("El grupo ya no está disponible.");
      return listingMembers(await source.getClusterLeaves(group.clusterId, group.total, 0));
    },
    staleTime: Infinity,
    retry: false,
  });
  const visible = members.data?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];
  const details = useQueries({ queries: visible.map((feature) => ({
    queryKey: ["detail", feature.properties.id, resultSetId],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.detail(feature.properties.id, signal, resultSetId),
  })) });
  const total = members.data?.length ?? group.total;
  return (
    <Popup longitude={group.longitude} latitude={group.latitude} anchor={group.anchor} offset={group.anchor === "center" ? 0 : 20}
      maxWidth="330px" closeOnClick={false} onClose={onClose} className="listing-group-popup">
      <section className="listing-group" aria-label="Viviendas en este punto">
        <header>
          <h3>{total} {total === 1 ? "vivienda" : "viviendas"} en esta zona</h3>
          <p>Elige una vivienda para ver sus detalles.</p>
        </header>
        {members.isPending ? <p className="group-status" role="status"><LoaderCircle size={15} className="spin" /> Cargando viviendas…</p>
          : members.error ? <div className="group-status" role="alert"><p>No se pudo cargar el grupo.</p><Button size="sm" variant="outline" onClick={() => void members.refetch()}>Reintentar</Button></div>
          : <>
            <div className="listing-group-items">
              {visible.map((feature, index) => {
                const query = details[index], listing = query.data;
                return <article key={feature.properties.id} className={selectedId === feature.properties.id ? "selected" : ""}>
                  <strong>{euros(listing?.price ?? feature.properties.price)}<small>/mes</small></strong>
                  <ListingLink id={feature.properties.id} url={listing?.url} className="group-listing-title">
                    {listing?.title ?? (query.isPending ? "Cargando vivienda…" : `Vivienda ${feature.properties.id}`)}
                  </ListingLink>
                  {listing && <p>{[listing.neighborhood, listing.surface_m2 != null ? `${listing.surface_m2} m²` : undefined, listing.bedrooms != null ? `${listing.bedrooms} hab.` : undefined].filter(Boolean).join(" · ")}</p>}
                  {query.error && <p>No se pudo cargar el resumen. Puedes abrir los detalles para reintentar.</p>}
                  <button className="group-detail-link" onClick={() => useAtlas.getState().openDetails(feature.properties.id)}>Ver detalles</button>
                </article>;
              })}
            </div>
            <nav className="group-pagination" aria-label="Páginas de viviendas del mapa">
              <Button size="icon" variant="ghost" aria-label="Viviendas anteriores" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></Button>
              <span>{total ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}</span>
              <Button size="icon" variant="ghost" aria-label="Más viviendas en este punto" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></Button>
            </nav>
            <Button size="sm" variant="outline" className="group-fit" onClick={() => onFit(members.data ?? [])} disabled={!total}><Scan size={14} />Acercar esta zona</Button>
          </>}
      </section>
    </Popup>
  );
}
