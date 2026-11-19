"use client";
import { useMemo } from "react";
import { Source, Layer, Popup } from "react-map-gl/maplibre";
import { Layers, MapPin, X, Eye, EyeOff } from "lucide-react";
import { useCensus, useCensusMetrics } from "@/hooks/use-census";
import { useAtlas } from "@/stores/atlas-store";
import { censusDisplayData, censusPaint, sectionMetrics } from "@/lib/census";
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
      attribution="Seccionado cedido por el Instituto Nacional de Estadística · 2025"
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
        Pasa el cursor por una zona para consultar todos sus datos. En móvil,
        toca la zona.
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
                  {metric.kind === "synthetic"
                    ? "DEMO · valores sintéticos"
                    : metric.kind === "estimated"
                      ? "Estimación"
                      : "Dato observado"}{" "}
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
          detail="Preparando las zonas de la Comunidad de Madrid."
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
        Seccionado cedido por el Instituto Nacional de Estadística. Cartografía
        2025; no representa medidas ambientales actuales.
      </p>
    </div>
  );
}
function CensusSectionInfo({ id }: { id: string }) {
  const active = useAtlas((s) => s.activeCensusMetric);
  const { data } = useCensus();
  const metrics = useCensusMetrics();
  const section = data?.features.find((f) => f.properties.id === id);
  if (!section) return null;
  return (
    <>
      <span className="eyebrow">
        <MapPin size={12} />
        SECCIÓN CENSAL
      </span>
      <h3>{id}</h3>
      <p>{section.properties.municipality}</p>
      {metrics.isPending ? (
        <LoadingStatus compact title="Cargando información de la zona" />
      ) : metrics.error ? (
        <p className="census-error">
          No se pudieron cargar los datos de la zona.
        </p>
      ) : (
        <div className="section-metrics">
          {sectionMetrics(metrics.data ?? [], id).map((metric) => (
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
                {metric.kind === "synthetic"
                  ? "DEMO · dato sintético"
                  : metric.kind === "estimated"
                    ? `Estimación · ${metric.source}`
                    : metric.source}
              </small>
            </div>
          ))}
          {!metrics.data?.length && (
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
}: {
  sectionId: string;
  longitude: number;
  latitude: number;
}) {
  return (
    <Popup
      longitude={longitude}
      latitude={latitude}
      offset={18}
      closeButton={false}
      closeOnClick={false}
      focusAfterOpen={false}
      maxWidth="290px"
      className="census-hover-popup"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="census-hover-info"
        role="tooltip"
        aria-label={`Información de la sección censal ${sectionId}`}
      >
        <CensusSectionInfo id={sectionId} />
      </div>
    </Popup>
  );
}
export function CensusInspector() {
  const id = useAtlas((s) => s.selectedCensusId);
  const visible = useAtlas((s) => s.censusVisible);
  if (!visible || !id) return null;
  return (
    <div className="census-inspector">
      <button
        className="inspector-close"
        aria-label="Cerrar sección seleccionada"
        onClick={() => useAtlas.getState().selectCensus(undefined)}
      >
        <X size={15} />
      </button>
      <CensusSectionInfo id={id} />
    </div>
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
      <span
        className={`metric-kind ${metric.kind === "synthetic" ? "metric-demo" : ""}`}
      >
        {metric.kind === "synthetic"
          ? "DEMO · valores sintéticos"
          : metric.kind === "observed"
            ? "Dato observado"
            : "Estimación"}{" "}
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
