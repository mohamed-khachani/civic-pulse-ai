"use client";
import type * as GeoJSON from "geojson";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, {
  Source,
  Layer,
  Popup,
  type MapRef,
  type MapLayerMouseEvent,
  type LayerProps,
} from "react-map-gl/maplibre";
import { useQuery } from "@tanstack/react-query";
import {
  Crosshair,
  Plus,
  Minus,
  Scan,
  Layers,
  Search,
  LoaderCircle,
  TriangleAlert,
  RotateCcw,
} from "lucide-react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
maplibregl.setWorkerUrl(
  new URL(
    "maplibre-gl/dist/maplibre-gl-worker.mjs",
    import.meta.url,
  ).toString(),
);
import { useAtlas } from "@/stores/atlas-store";
import { useGeo } from "@/hooks/use-listings";
import { api } from "@/lib/api";
import { mapActionSchema, type Bounds, type GeographicLayer } from "@/types";
import { MapFilters } from "../filters/filters";
import { Popover } from "../ui/popover";
import { Button } from "../ui/button";
import { euros } from "@/lib/utils";
import { metricRange, viewportCamera, markerPill } from "@/lib/map";
import { ListingImage } from "../listings/listing-card";
const madrid = { latitude: 40.4168, longitude: -3.7038, zoom: 11.7 };
export default function MadridMap() {
  const map = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [popupId, setPopupId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const [reload, setReload] = useState(0);
  const selected = useAtlas((s) => s.selectedId);
  const action = useAtlas((s) => s.mapAction);
  const version = useAtlas((s) => s.mapActionVersion);
  const viewport = useAtlas((s) => s.viewport);
  const visibleLayers = useAtlas((s) => s.visibleLayers);
  const {
    data: geo,
    error,
    isPending,
    isFetching,
    filtersReady,
    refetch,
  } = useGeo();
  const { data: layers } = useQuery({
    queryKey: ["layers"],
    queryFn: ({ signal }) => api.layers(signal),
  });
  const selectedFeature = geo?.features.find(
    (f) => f.properties.id === selected,
  );
  const popupFeature = geo?.features.find(
    (f) => f.properties.id === popupId && popupId === selected,
  );
  const {
    data: popup,
    error: popupError,
    isPending: popupPending,
  } = useQuery({
    queryKey: ["detail", popupId],
    queryFn: ({ signal }) => api.detail(popupId!, signal),
    enabled: !!popupFeature,
  });
  const lastAction = useRef(-1);
  const fit = useCallback(() => {
    if (!map.current || !geo?.features.length) return;
    const coords = geo.features.map((f) => f.geometry.coordinates);
    const xs = coords.map((c) => c[0]),
      ys = coords.map((c) => c[1]);
    map.current.fitBounds(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      {
        padding: 75,
        maxZoom: 14,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 650,
      },
    );
  }, [geo]);
  useEffect(() => {
    if (
      !ready ||
      !geo ||
      !filtersReady ||
      isFetching ||
      !action ||
      lastAction.current === version
    )
      return;
    const parsed = mapActionSchema.safeParse(action);
    if (!parsed.success) return;
    const a = parsed.data;
    if (a.type === "fit_results") fit();
    if (a.type === "set_viewport")
      map.current?.flyTo({
        ...viewportCamera(a.viewport),
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 500,
      });
    if (a.type === "focus_area")
      map.current?.fitBounds(
        [
          [a.bounds[0], a.bounds[1]],
          [a.bounds[2], a.bounds[3]],
        ],
        {
          padding: 60,
          duration: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? 0
            : 500,
        },
      );
    if (a.type === "focus_listing") {
      const point = geo.features.find((f) => f.properties.id === a.listing_id);
      if (point) {
        map.current?.flyTo({
          center: point.geometry.coordinates,
          zoom: 14,
          duration: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? 0
            : 500,
        });
        queueMicrotask(() => setPopupId(a.listing_id));
      }
    }
    lastAction.current = version;
    useAtlas.setState({ mapAction: undefined });
  }, [action, version, ready, geo, fit, filtersReady, isFetching]);
  useEffect(() => {
    if (geo && selected && !selectedFeature) {
      useAtlas.getState().select(undefined);
    }
  }, [geo, selected, selectedFeature]);
  const selectedFilter = useMemo(
    () => ["==", ["get", "id"], selected ?? ""] as never,
    [selected],
  );
  async function onClick(e: MapLayerMouseEvent) {
    const feature = e.features?.[0];
    if (!feature) return;
    if (feature.properties?.cluster_id !== undefined) {
      const source = map.current?.getSource("listings") as GeoJSONSource;
      const zoom = await source.getClusterExpansionZoom(
        feature.properties.cluster_id,
      );
      const coords = (feature.geometry as GeoJSON.Point).coordinates;
      map.current?.easeTo({
        center: [coords[0], coords[1]],
        zoom,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 400,
      });
    } else if (feature.properties?.id) {
      const id = String(feature.properties.id);
      useAtlas.getState().select(id);
      setPopupId(id);
    }
  }
  function searchBounds() {
    const b = map.current?.getBounds();
    if (!b) return;
    useAtlas.getState().setFilters({
      bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as Bounds,
    });
  }
  const priceLayer: LayerProps = {
    id: "prices",
    type: "symbol",
    filter: ["!", ["has", "point_count"]],
    layout: {
      "text-field": ["concat", ["to-string", ["get", "price"]], " €"],
      "text-font": ["Open Sans Regular"],
      "text-size": 12,
      "icon-image": "price-pill",
      "icon-text-fit": "both",
      "icon-text-fit-padding": [7, 10, 7, 10],
      "text-padding": 9,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#17211B",
      "text-halo-color": "#ffffff",
      "text-halo-width": 0,
      "text-halo-blur": 0,
    },
  };
  return (
    <>
      <Map
        mapLib={maplibregl}
        key={reload}
        ref={map}
        initialViewState={viewport}
        mapStyle={
          process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
          "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        }
        onLoad={() => {
          const m = map.current;
          if (m) {
            m.addImage("price-pill", markerPill(), {
              pixelRatio: 2,
              stretchX: [[30, 114]],
              stretchY: [[24, 40]],
              content: [10, 10, 134, 54],
            });
            m.addImage("selected-pill", markerPill(true), {
              pixelRatio: 2,
              stretchX: [[30, 114]],
              stretchY: [[24, 40]],
              content: [10, 10, 134, 54],
            });
          }
          setReady(true);
        }}
        onError={() => setFailed(true)}
        onMoveEnd={(e) =>
          useAtlas.getState().setViewport({
            latitude: e.viewState.latitude,
            longitude: e.viewState.longitude,
            zoom: e.viewState.zoom,
          })
        }
        onClick={(e) => void onClick(e)}
        interactiveLayerIds={["clusters", "prices", "selected-price"]}
        onMouseMove={(e) =>
          setHoveredId(
            e.features?.find((f) => f.properties?.id)?.properties?.id as
              string | undefined,
          )
        }
        onMouseEnter={() => {
          const canvas = map.current?.getCanvas();
          if (canvas) canvas.style.cursor = "pointer";
        }}
        onMouseLeave={() => {
          setHoveredId(undefined);
          const canvas = map.current?.getCanvas();
          if (canvas) canvas.style.cursor = "";
        }}
        attributionControl={{ compact: true }}
        style={{ width: "100%", height: "100%" }}
      >
        {geo && ready && (
          <Source
            id="listings"
            type="geojson"
            data={geo}
            cluster
            clusterMaxZoom={13}
            clusterRadius={42}
          >
            <Layer
              id="clusters"
              type="circle"
              filter={["has", "point_count"]}
              paint={{
                "circle-color": "#16803C",
                "circle-radius": [
                  "step",
                  ["get", "point_count"],
                  19,
                  20,
                  23,
                  50,
                  28,
                ],
                "circle-stroke-color": "#fff",
                "circle-stroke-width": 3,
              }}
            />
            <Layer
              id="cluster-count"
              type="symbol"
              filter={["has", "point_count"]}
              layout={{
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": ["Open Sans Regular"],
                "text-size": 13,
              }}
              paint={{ "text-color": "#fff" }}
            />
            <Layer {...priceLayer} />
            <Layer
              {...priceLayer}
              id="hovered-price"
              filter={["==", ["get", "id"], hoveredId ?? ""]}
              layout={{
                ...priceLayer.layout,
                "text-allow-overlap": true,
                "icon-allow-overlap": true,
              }}
              paint={{ "text-color": "#16803c" }}
            />
            <Layer
              {...priceLayer}
              id="selected-price"
              filter={selectedFilter}
              layout={{
                ...priceLayer.layout,
                "icon-image": "selected-pill",
                "text-allow-overlap": true,
                "icon-allow-overlap": true,
              }}
              paint={{ "text-color": "#fff" }}
            />
          </Source>
        )}
        {layers
          ?.filter(
            (l) => l.available && l.geojson && visibleLayers.includes(l.id),
          )
          .map((l) => (
            <GeographicMapLayer key={l.id} layer={l} />
          ))}
        {popupFeature && (
          <Popup
            longitude={popupFeature.geometry.coordinates[0]}
            latitude={popupFeature.geometry.coordinates[1]}
            anchor="bottom"
            offset={15}
            maxWidth="280px"
            closeOnClick={false}
            onClose={() => setPopupId(undefined)}
          >
            {popupPending ? (
              <div className="popup-loading">
                <LoaderCircle className="spin" />
                Cargando…
              </div>
            ) : popupError ? (
              <div className="popup-loading">
                No se pudo cargar la vivienda.
              </div>
            ) : (
              popup && (
                <div className="property-popup">
                  <ListingImage src={popup.images[0]} alt={popup.title} />
                  <div>
                    <strong>
                      {euros(popup.price)}
                      <small>/mes</small>
                    </strong>
                    <h3>{popup.title}</h3>
                    <p>
                      {popup.neighborhood}
                      {popup.surface_m2 != null
                        ? ` · ${popup.surface_m2} m²`
                        : ""}
                      {popup.bedrooms != null
                        ? ` · ${popup.bedrooms} hab.`
                        : ""}
                      {popup.bathrooms != null
                        ? ` · ${popup.bathrooms} ${popup.bathrooms === 1 ? "baño" : "baños"}`
                        : ""}
                    </p>
                    {popup.compatibility && (
                      <p>{popup.compatibility.score}/100 de compatibilidad</p>
                    )}
                    <Button
                      size="sm"
                      onClick={() => useAtlas.getState().openDetails(popup.id)}
                    >
                      Ver detalles
                    </Button>
                  </div>
                </div>
              )
            )}
          </Popup>
        )}
      </Map>
      <MapFilters />
      <div className="search-area">
        <Button
          variant="outline"
          size="sm"
          onClick={searchBounds}
          disabled={!ready}
        >
          <Search size={14} />
          Buscar en esta zona
        </Button>
      </div>
      <div className="map-navigation">
        <button onClick={() => map.current?.zoomIn()} aria-label="Acercar mapa">
          <Plus size={19} />
        </button>
        <button onClick={() => map.current?.zoomOut()} aria-label="Alejar mapa">
          <Minus size={19} />
        </button>
        <span />
        <button
          onClick={() =>
            map.current?.flyTo({
              ...viewportCamera(madrid),
              duration: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? 0
                : 500,
            })
          }
          aria-label="Volver a Madrid"
        >
          <Crosshair size={18} />
        </button>
        <button onClick={fit} aria-label="Ajustar mapa a resultados">
          <Scan size={18} />
        </button>
      </div>
      <div className="map-layers">
        <Popover
          label="Capas del mapa"
          trigger={
            <Button variant="outline">
              <Layers size={16} />
              <span>Capas del mapa</span>
            </Button>
          }
        >
          <div className="layers-menu">
            <h3>Una mirada a tu entorno</h3>
            <label>
              <input type="checkbox" checked disabled />
              Viviendas
            </label>
            {layers?.map((l) => (
              <label key={l.id}>
                <input
                  type="checkbox"
                  disabled={!l.available || !l.geojson}
                  checked={visibleLayers.includes(l.id)}
                  onChange={() => useAtlas.getState().toggleLayer(l.id)}
                />
                <span>
                  {l.name}
                  {(!l.available || !l.geojson) && (
                    <small>Sin datos disponibles</small>
                  )}
                </span>
              </label>
            ))}
            {!layers && <p>Las capas aparecerán cuando estén disponibles.</p>}
          </div>
        </Popover>
      </div>
      <div className="map-legends">
        {layers
          ?.filter((l) => visibleLayers.includes(l.id) && l.metric)
          .map((l) => (
            <div key={l.id}>
              <span style={{ background: l.color ?? "#16803c" }} />
              {l.name} · {metricRange(l)?.join("–")} {l.unit} ·{" "}
              {l.kind === "estimated"
                ? "Estimación"
                : l.kind === "observed"
                  ? "Medición"
                  : "Sin método indicado"}{" "}
              ·{" "}
              {l.scope === "district"
                ? "Distrito"
                : l.scope === "census"
                  ? "Sección censal"
                  : l.scope === "neighborhood"
                    ? "Barrio"
                    : ""}
            </div>
          ))}
      </div>
      {(isPending || !ready) && !failed && (
        <div className="map-status">
          <LoaderCircle size={15} className="spin" />
          Cargando {isPending ? "viviendas" : "mapa"}…
        </div>
      )}
      {(error || failed) && (
        <div className="map-error" role="alert">
          <TriangleAlert size={20} />
          <strong>
            {error
              ? "No se pudieron cargar las viviendas"
              : "No se ha podido cargar parte del mapa"}
          </strong>
          <p>
            {error?.message ??
              "Comprueba tu conexión y el proveedor del mapa. Puedes seguir explorando las fichas."}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (error) void refetch();
              if (failed) {
                setFailed(false);
                setReady(false);
                setReload((n) => n + 1);
              }
            }}
          >
            <RotateCcw size={14} />
            Reintentar
          </Button>
        </div>
      )}
    </>
  );
}
function GeographicMapLayer({ layer: l }: { layer: GeographicLayer }) {
  const range = metricRange(l);
  return (
    <Source
      id={l.id}
      type="geojson"
      data={l.geojson as GeoJSON.FeatureCollection}
    >
      <Layer
        id={`${l.id}-fill`}
        type="fill"
        filter={["==", ["geometry-type"], "Polygon"]}
        paint={{
          "fill-color":
            l.metric && range && range[0] < range[1]
              ? [
                  "case",
                  ["has", l.metric],
                  [
                    "interpolate",
                    ["linear"],
                    ["to-number", ["get", l.metric]],
                    range[0],
                    "#eaf6ee",
                    range[1],
                    l.color ?? "#16803c",
                  ],
                  "#d9dfdb",
                ]
              : (l.color ?? "#16803c"),
          "fill-opacity": 0.25,
        }}
      />
      <Layer
        id={`${l.id}-point`}
        type="circle"
        filter={["==", ["geometry-type"], "Point"]}
        paint={{ "circle-radius": 5, "circle-color": l.color ?? "#16803c" }}
      />
      <Layer
        id={`${l.id}-line`}
        type="line"
        filter={["==", ["geometry-type"], "LineString"]}
        paint={{ "line-width": 2, "line-color": l.color ?? "#16803c" }}
      />
    </Source>
  );
}
