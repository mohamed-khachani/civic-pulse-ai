"use client";
import {
  X,
  SlidersHorizontal,
  ChevronDown,
  RotateCcw,
  LoaderCircle,
} from "lucide-react";
import { useAtlas } from "@/stores/atlas-store";
import { useListings, useOptions } from "@/hooks/use-listings";
import { euros, featureLabels } from "@/lib/utils";
import { Popover } from "../ui/popover";
import { Button } from "../ui/button";
import type { ListingSearchFilters } from "@/types";
export function ActiveFilters() {
  const filters = useAtlas((s) => s.filters);
  const entries = Object.entries(filters).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (!entries.length) return null;
  function label(k: string, v: unknown) {
    if (k === "max_price") return `Hasta ${euros(Number(v))}`;
    if (k === "min_price") return `Desde ${euros(Number(v))}`;
    if (k === "min_bedrooms") return `${v}+ habitaciones`;
    if (k === "min_bathrooms") return `${v}+ baños`;
    if (k === "min_surface") return `${v}+ m²`;
    if (k === "bounds") return "En esta zona";
    if (k in featureLabels)
      return `${v === false ? "Sin " : ""}${featureLabels[k as keyof typeof featureLabels]}`;
    return String(v);
  }
  return (
    <div className="active-filters">
      {entries.map(([k, v]) => (
        <button
          key={k}
          onClick={() => useAtlas.getState().setFilters({ [k]: undefined })}
          aria-label={`Quitar filtro: ${label(k, v)}`}
        >
          {label(k, v)}
          <X size={12} />
        </button>
      ))}
      <button
        className="clear-filters"
        onClick={() => useAtlas.getState().replaceFilters({})}
      >
        Limpiar
      </button>
    </div>
  );
}
export function FilterFields() {
  const f = useAtlas((s) => s.filters);
  const set = useAtlas((s) => s.setFilters);
  const { data: options, error, refetch } = useOptions();
  const numeric = (key: keyof ListingSearchFilters, value: string) =>
    set({ [key]: value === "" ? undefined : Math.max(0, Number(value)) });
  return (
    <div className="filter-fields">
      <div className="filter-title">
        <h3>Encuentra lo que encaja contigo</h3>
        <button onClick={() => useAtlas.getState().replaceFilters({})}>
          <RotateCcw size={13} />
          Limpiar
        </button>
      </div>
      <fieldset>
        <legend>Alquiler mensual</legend>
        <div className="field-row">
          <label>
            Desde (€)
            <input
              type="number"
              min="0"
              step="50"
              placeholder="Sin mínimo"
              value={f.min_price ?? ""}
              onChange={(e) => numeric("min_price", e.target.value)}
            />
          </label>
          <label>
            Hasta (€)
            <input
              aria-label="Alquiler máximo"
              type="number"
              min="0"
              step="50"
              placeholder="Sin máximo"
              value={f.max_price ?? ""}
              onChange={(e) => numeric("max_price", e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Tu vivienda</legend>
        <div className="field-row">
          <label>
            Habitaciones
            <select
              value={f.min_bedrooms ?? ""}
              onChange={(e) => numeric("min_bedrooms", e.target.value)}
            >
              <option value="">Cualquiera</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} o más
                </option>
              ))}
            </select>
          </label>
          <label>
            Baños
            <select
              value={f.min_bathrooms ?? ""}
              onChange={(e) => numeric("min_bathrooms", e.target.value)}
            >
              <option value="">Cualquiera</option>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n} o más
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Superficie mínima (m²)
          <input
            type="number"
            min="0"
            placeholder="Sin mínimo"
            value={f.min_surface ?? ""}
            onChange={(e) => numeric("min_surface", e.target.value)}
          />
        </label>
        <div className="feature-checks">
          {options?.features.map((k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={f[k] === true}
                onChange={(e) =>
                  set({ [k]: e.target.checked ? true : undefined })
                }
              />
              {featureLabels[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Tu zona</legend>
        <label>
          Distrito
          <select
            value={f.district ?? ""}
            onChange={(e) =>
              set({
                district: e.target.value || undefined,
                neighborhood: undefined,
              })
            }
          >
            <option value="">Todo Madrid</option>
            {options?.districts.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Barrio
          <select
            value={f.neighborhood ?? ""}
            onChange={(e) => set({ neighborhood: e.target.value || undefined })}
          >
            <option value="">Todos los barrios</option>
            {options?.neighborhoods.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
      </fieldset>
      {options && options.sources.length > 1 && (
        <label>
          Portal
          <select
            value={f.source ?? ""}
            onChange={(e) =>
              set({
                source:
                  (e.target.value as ListingSearchFilters["source"]) ||
                  undefined,
              })
            }
          >
            <option value="">Todos</option>
            {options.sources.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <div className="filter-options-error" role="alert">
          <p>No se pudieron cargar las opciones de filtros.</p>
          <button onClick={() => void refetch()}>Reintentar</button>
        </div>
      )}
    </div>
  );
}
export function MapFilters() {
  const f = useAtlas((s) => s.filters);
  const set = useAtlas((s) => s.setFilters);
  const { data, isFetching } = useListings();
  const count = Object.values(f).filter((v) => v !== undefined).length;
  return (
    <div className="map-filter-bar">
      <Popover
        label="Precio máximo"
        trigger={
          <Button
            variant="outline"
            className={f.max_price !== undefined ? "filter-active" : ""}
          >
            {f.max_price !== undefined
              ? `Hasta ${euros(f.max_price)}`
              : "Precio"}
            <ChevronDown size={13} />
          </Button>
        }
      >
        <label className="single-field">
          Alquiler máximo (€/mes)
          <input
            aria-label="Precio máximo"
            type="number"
            min="0"
            step="50"
            placeholder="Sin máximo"
            value={f.max_price ?? ""}
            onChange={(e) =>
              set({
                max_price: e.target.value
                  ? Math.max(0, Number(e.target.value))
                  : undefined,
              })
            }
          />
        </label>
      </Popover>
      <Popover
        label="Habitaciones"
        trigger={
          <Button
            variant="outline"
            className={`bedrooms-filter ${f.min_bedrooms ? "filter-active" : ""}`}
          >
            {f.min_bedrooms ? `${f.min_bedrooms}+ hab.` : "Habitaciones"}
            <ChevronDown size={13} />
          </Button>
        }
      >
        <div className="bedroom-options">
          {[0, 1, 2, 3, 4].map((n) => (
            <button
              key={n}
              aria-pressed={(f.min_bedrooms ?? 0) === n}
              onClick={() => set({ min_bedrooms: n || undefined })}
            >
              {n === 0 ? "Todas" : `${n}+`}
            </button>
          ))}
        </div>
      </Popover>
      <Popover
        label="Todos los filtros"
        trigger={
          <Button variant="outline">
            <SlidersHorizontal size={15} />
            Filtros{count > 0 && <span className="filter-count">{count}</span>}
          </Button>
        }
      >
        <FilterFields />
      </Popover>
      <span className="map-count">
        {isFetching ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          `${data?.total ?? "—"} viviendas`
        )}
      </span>
    </div>
  );
}
