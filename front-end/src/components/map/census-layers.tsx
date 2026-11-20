"use client";
import { useMemo } from "react";
import { Source, Layer, Popup } from "react-map-gl/maplibre";
import { Layers, MapPin, X, Eye, EyeOff } from "lucide-react";
import {
  useCensus,
  useCensusMetrics,
  useCensusSection,
} from "@/hooks/use-census";
import { useAtlas } from "@/stores/atlas-store";
import { censusDisplayData, censusPaint } from "@/lib/census";
import { numbers } from "@/lib/utils";
import { Popover } from "../ui/popover";
import { Button } from "../ui/button";
import { LoadingStatus } from "../ui/loading-status";
export function CensusMapLayers({ hoveredId }: { hoveredId?: string }) {
  const visible = useAtlas((s) => s.censusVisible);
  const active = useAtlas((s) => s.activeCensusMetric);
  const selected = useAtlas((s) => s.selectedCensusId);
  const { data } = useCensus(visible);
  const { data: metrics } = useCensusMetrics(visible);
  const metric = metrics?.find((m) => m.id === active);
  const display = useMemo(
    () => (data ? censusDisplayData(data, metric) : undefined),
    [data, metric],
  );
  if (!visible || !metric || !display) return null;
  const hoverFilter: import("maplibre-gl").FilterSpecification = [
    "==",
    ["get", "id"],
    hoveredId ?? "",
  ];
  return (
    <Source
      id="census-sections"
      type="geojson"
      data={display}
      attribution="Seccionado municipal de Madrid · fuente y fecha según el conjunto de datos"
    >
      <Layer
        id="census-fill"
        beforeId="clusters"
        type="fill"
        paint={{ "fill-color": censusPaint(metric), "fill-opacity": 0.46 }}
      />
      <Layer
        id="census-outline"
        beforeId="clusters"
        type="line"
        paint={{
          "line-color": "#52695c",
          "line-width": 0.5,
          "line-opacity": 0.45,
        }}
      />
      <Layer
        id="census-selected"
        beforeId="clusters"
        type="line"
        filter={["==", ["get", "id"], selected ?? ""]}
        paint={{ "line-color": "#17211b", "line-width": 2 }}
      />
      <Layer
        id="census-hover-shadow"
        beforeId="clusters"
        type="fill"
        filter={hoverFilter}
        paint={{
          "fill-color": "#17211b",
          "fill-opacity": 0.18,
          "fill-translate": [2, 4],
          "fill-translate-anchor": "viewport",
        }}
      />
      <Layer
        id="census-hover-raised"
        beforeId="clusters"
        type="fill"
        filter={hoverFilter}
        paint={{
          "fill-color": censusPaint(metric),
          "fill-opacity": 0.72,
          "fill-translate": [0, -3],
          "fill-translate-anchor": "viewport",
        }}
      />
      <Layer
        id="census-hover-edge"
        beforeId="clusters"
        type="line"
        filter={hoverFilter}
        paint={{
          "line-color": "#52695c",
          "line-width": 1.3,
          "line-translate": [0, -3],
          "line-translate-anchor": "viewport",
        }}
      />
    </Source>
  );
}
export function MapLayersPanel() {
  const listingsVisible = useAtlas((s) => s.listingsVisible);
  return (
    <div className="map-layers">
      <Popover
        label="Capas y datos de la zona"
        trigger={
          <Button variant="outline">
            <Layers size={16} />
            <span>Capas y entorno</span>
          </Button>
        }
      >
        <CensusPanel />
      </Popover>
      <Button
        variant="outline"
        aria-pressed={!listingsVisible}
        onClick={() => useAtlas.getState().setListingsVisible(!listingsVisible)}
      >
        {listingsVisible ? <EyeOff size={15} /> : <Eye size={15} />}
        <span>
          {listingsVisible ? "Ocultar viviendas" : "Mostrar viviendas"}
        </span>
      </Button>
    </div>
  );
}
function CensusPanel() {
  const activeId = useAtlas((s) => s.activeCensusMetric);
  const visible = useAtlas((s) => s.censusVisible);
  const census = useCensus(visible);
  const metrics = useCensusMetrics();
  const active = visible
    ? metrics.data?.find((m) => m.id === activeId)
    : undefined;
  return (
    <div className="census-panel">
      <div className="census-heading">
        <h3>Conoce el entorno</h3>
        <p>Elige qué información quieres ver en el mapa.</p>
      </div>
      <p className="census-help">
        Acerca el mapa y pasa el cursor sobre una zona para consultar sus datos.
        También puedes hacer clic para fijar la tarjeta.
      </p>
      <label className="metric-option">
        <input
          type="radio"
          name="census-metric"
          checked={!visible}
          onChange={() => useAtlas.getState().setCensusMetric(undefined)}
        />
        <span>Sin resaltado</span>
      </label>
      {metrics.isPending ? (
        <LoadingStatus
          compact
          title="Cargando variables"
          detail="Consultando los datos disponibles de cada zona."
        />
      ) : metrics.error ? (
        <div className="census-error" role="alert">
          <p>{metrics.error.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void metrics.refetch()}
          >
            Reintentar variables
          </Button>
        </div>
      ) : (
        <>
          {metrics.data?.map((metric) => (
            <label className="metric-option" key={metric.id}>
              <input
                type="radio"
                name="census-metric"
                checked={visible && activeId === metric.id}
                onChange={() => useAtlas.getState().setCensusMetric(metric.id)}
              />
              <span>
                {metric.name}
                <small>
                  {metric.kind === "estimated" ? "Estimación" : "Dato observado"}{" "}
                  · {metric.unit}
                </small>
              </span>
            </label>
          ))}
          {!metrics.data?.length && (
            <p className="census-help">
              La API todavía no ofrece variables ambientales.
            </p>
          )}
        </>
      )}
      {visible && census.isPending && (
        <LoadingStatus
          compact
          title="Cargando datos del mapa"
          detail="Preparando las zonas de Madrid."
        />
      )}
      {visible && census.error && (
        <div className="census-error" role="alert">
          <p>{census.error.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void census.refetch()}
          >
            Reintentar cartografía
          </Button>
        </div>
      )}
      {active && (
        <div className="metric-palette">
          <h4>Escala de la variable</h4>
          {active.stops.map((stop, i) => (
            <div className="metric-scale-stop" key={i}>
              <span
                className="section-swatch"
                style={{ background: stop.color }}
              />
              <span>
                {stop.value} {active.unit}
              </span>
            </div>
          ))}
          <p>{active.description}</p>
          <small>Fuente: {active.source}</small>
        </div>
      )}
      <p className="census-attribution">
        Consulta la fuente y el año de cada variable. Los valores ambientales
        de estaciones cercanas son estimaciones para la zona.
      </p>
    </div>
  );
}
function CensusSectionInfo({
  id,
  interaction,
}: {
  id: string;
  interaction: "hover" | "click";
}) {
  const active = useAtlas((s) => s.activeCensusMetric);
  const details = useCensusSection(id, interaction);
  return (
    <>
      <span className="eyebrow">
        <MapPin size={12} />
        SECCIÓN CENSAL
      </span>
      <h3>{id}</h3>
      {details.data && <p>{details.data.municipality}</p>}
      {details.isPending ? (
        <LoadingStatus
          compact
          title="Consultando información de la zona"
          detail="Estamos obteniendo los datos de esta sección."
        />
      ) : details.error ? (
        <div className="census-error" role="alert">
          <p>No se pudieron cargar los datos de la zona.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void details.refetch()}
          >
            Reintentar
          </Button>
        </div>
      ) : (
        <div className="section-metrics">
          {details.data?.metrics.map((metric) => (
            <div
              key={metric.id}
              className={`section-metric-row ${metric.id === active ? "section-metric-active" : ""}`}
            >
              <div>
                <span>{metric.name}</span>
                <strong>
                  {metric.value == null
                    ? "Sin datos"
                    : `${numbers(metric.value)} ${metric.unit}`}
                </strong>
              </div>
              <small>
                {metric.kind === "estimated" ? `Estimación · ${metric.source}` : metric.source}
              </small>
            </div>
          ))}
          {!details.data?.metrics.length && (
            <p>No hay datos disponibles para esta zona.</p>
          )}
        </div>
      )}
    </>
  );
}
export function CensusHoverTooltip({
  sectionId,
  longitude,
  latitude,
  pinned = false,
  onClose,
}: {
  sectionId: string;
  longitude: number;
  latitude: number;
  pinned?: boolean;
  onClose?: () => void;
}) {
  return (
    <Popup
      longitude={longitude}
      latitude={latitude}
      padding={{ top: 12, right: 12, bottom: 12, left: 12 }}
      offset={24}
      closeButton={false}
      closeOnClick={false}
      focusAfterOpen={false}
      maxWidth="290px"
      className={`census-zone-popup ${pinned ? "census-pinned-popup" : "census-hover-popup"}`}
      style={{ pointerEvents: pinned ? "auto" : "none" }}
    >
      <div
        className="census-hover-info"
        role={pinned ? "region" : "tooltip"}
        aria-label={`Información de la sección censal ${sectionId}`}
      >
        {pinned && (
          <button
            className="inspector-close"
            aria-label="Cerrar sección seleccionada"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        )}
        <CensusSectionInfo
          id={sectionId}
          interaction={pinned ? "click" : "hover"}
        />
      </div>
    </Popup>
  );
}
export function CensusLegend({ hidden = false }: { hidden?: boolean }) {
  const visible = useAtlas((s) => s.censusVisible);
  const active = useAtlas((s) => s.activeCensusMetric);
  const selected = useAtlas((s) => s.selectedCensusId);
  const { data: metrics } = useCensusMetrics(visible);
  const metric = metrics?.find((m) => m.id === active);
  if (!visible || !metric || selected || hidden) return null;
  return (
    <div className="census-legend">
      <h4>{metric.name}</h4>
      <span className="metric-kind">
        {metric.kind === "observed" ? "Dato observado" : "Estimación"}{" "}
        · {metric.unit}
      </span>
      <div
        className="legend-scale"
        style={{
          background: `linear-gradient(90deg,${metric.stops.map((stop) => `${stop.color} ${(100 * (stop.value - metric.stops[0].value)) / (metric.stops[metric.stops.length - 1].value - metric.stops[0].value)}%`).join(",")})`,
        }}
      />
      <div className="legend-values">
        {metric.stops.map((s, i) => (
          <span key={i}>{s.value}</span>
        ))}
      </div>
      <p>
        <i />
        Sin datos · gris
      </p>
      <small>
        {metric.source}
        {metric.year ? ` · ${metric.year}` : ""}
      </small>
      <p>Ámbito: sección censal.</p>
    </div>
  );
}
