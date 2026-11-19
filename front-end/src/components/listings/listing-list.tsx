"use client";
import { useState } from "react";
import { SearchX, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useListings, useOptions } from "@/hooks/use-listings";
import { useAtlas } from "@/stores/atlas-store";
import type { SortOrder } from "@/types";
import { numbers } from "@/lib/utils";
import { ListingCard } from "./listing-card";
import { ActiveFilters } from "../filters/filters";
import { Button } from "../ui/button";
const sorts: Record<SortOrder, string> = {
  recommended: "Recomendados",
  price_asc: "Precio: menor a mayor",
  price_desc: "Precio: mayor a menor",
  surface_desc: "Mayor superficie",
  compatibility: "Mayor compatibilidad",
  updated: "Más recientes",
};
export function ListingList({ compact = false }: { compact?: boolean }) {
  const [page, setPage] = useState(1);
  const filters = useAtlas((s) => s.filters);
  const sort = useAtlas((s) => s.sort);
  const [previous, setPrevious] = useState({ filters, sort });
  if (previous.filters !== filters || previous.sort !== sort) {
    setPrevious({ filters, sort });
    setPage(1);
  }
  const { data, error, isPending, isFetching, refetch } = useListings(page);
  const options = useOptions();
  return (
    <section
      className="results-section"
      aria-label="Viviendas encontradas"
      aria-busy={isFetching}
    >
      <div className="results-heading">
        <div>
          <span className="eyebrow">TU PRÓXIMO CAPÍTULO</span>
          <h3>
            {isPending
              ? "Buscando viviendas…"
              : data
                ? `${numbers(data.total)} viviendas para ti`
                : "Tus resultados"}
            {isFetching && !isPending && (
              <LoaderCircle size={14} className="spin" />
            )}
          </h3>
        </div>
        <label className="sort-control">
          <span className="sr-only">Ordenar viviendas</span>
          <select
            value={sort}
            onChange={(e) =>
              useAtlas.getState().setSort(e.target.value as SortOrder)
            }
          >
            {(options.data?.sorts ?? ["recommended"]).map((s) => (
              <option key={s} value={s}>
                {sorts[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ActiveFilters />
      {error ? (
        <div className="empty-state" role="alert">
          <SearchX />
          <h3>No podemos cargar las viviendas</h3>
          <p>{error.message}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Volver a intentar
          </Button>
        </div>
      ) : isPending ? (
        <div className={`listing-grid ${compact ? "compact-grid" : ""}`}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="listing-skeleton skeleton" />
          ))}
        </div>
      ) : !data?.total ? (
        <div className="empty-state">
          <SearchX size={30} />
          <h3>Un pequeño ajuste puede cambiarlo todo</h3>
          <p>
            No hay viviendas con estos filtros. Amplía el presupuesto o explora
            otra zona.
          </p>
          <Button
            variant="outline"
            onClick={() => useAtlas.getState().replaceFilters({})}
          >
            Modificar búsqueda · limpiar filtros
          </Button>
        </div>
      ) : (
        <>
          <div className={`listing-grid ${compact ? "compact-grid" : ""}`}>
            {data.listings.map((l) => (
              <ListingCard key={l.id} listing={l} compact={compact} />
            ))}
          </div>
          {data.total > data.page_size && (
            <nav className="pagination" aria-label="Páginas de viviendas">
              <Button
                variant="ghost"
                size="icon"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Página anterior"
              >
                <ChevronLeft size={17} />
              </Button>
              <span>
                {page} de {Math.ceil(data.total / data.page_size)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                disabled={page * data.page_size >= data.total}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Página siguiente"
              >
                <ChevronRight size={17} />
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
