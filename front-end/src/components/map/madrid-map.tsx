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
import { Button } from "../ui/button";
import { euros } from "@/lib/utils";
import {
  metricRange,
  viewportCamera,
  markerPill,
  resultBounds,
  resultSignature,
} from "@/lib/map";
import { ListingImage } from "../listings/listing-card";
import {
  MADRID_BOUNDS,
  MADRID_MIN_ZOOM,
  constrainMadrid,
  madridBoundary,
  outsideMadrid,
} from "@/lib/geo/madrid";
import {
  CensusMapLayers,
  MapLayersPanel,
  CensusLegend,
  CensusHoverTooltip,
} from "./census-layers";
import { useCensus, useCensusMetrics } from "@/hooks/use-census";
import {
  createCensusHoverIntent,
  CENSUS_DETAIL_MIN_ZOOM,
} from "@/lib/census-hover-intent";
import { mapHoverTarget } from "@/lib/map-interactions";
import { LoadingStatus } from "../ui/loading-status";
const constrainCamera: maplibregl.TransformConstrainFunction = (
  lngLat,
  zoom,
) => ({
  center: new maplibregl.LngLat(...constrainMadrid([lngLat.lng, lngLat.lat])),
  zoom: Math.max(MADRID_MIN_ZOOM, zoom),
});
const madrid = { latitude: 40.4168, longitude: -3.7038, zoom: 11.7 };
export default function MadridMap() {
  const map = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [popupId, setPopupId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const [overListing, setOverListing] = useState(false);
  const [hoveredCensus, setHoveredCensus] = useState<{
    id: string;
    longitude: number;
    latitude: number;
  }>();
  const [pinnedCensus, setPinnedCensus] = useState<{
    id: string;
    longitude: number;
    latitude: number;
  }>();
  const selectedCensusId = useAtlas((s) => s.selectedCensusId);
  const censusHoverIntent = useMemo(
    () =>
      createCensusHoverIntent(setHoveredCensus, () =>
        setHoveredCensus(undefined),
      ),
    [],
  );
  const [reload, setReload] = useState(0);
  const selected = useAtlas((s) => s.selectedId);
  const action = useAtlas((s) => s.mapAction);
  const version = useAtlas((s) => s.mapActionVersion);
  const viewport = useAtlas((s) => s.viewport);
  const visibleLayers = useAtlas((s) => s.visibleLayers);
  const pendingChat = useAtlas((s) => s.pending);
  const censusVisible = useAtlas((s) => s.censusVisible);
  const activeMetric = useAtlas((s) => s.activeCensusMetric);
  const listingsVisible = useAtlas((s) => s.listingsVisible);
  const fittedKey = useAtlas((s) => s.fittedResultKey);
  const census = useCensus(censusVisible);
  const censusMetrics = useCensusMetrics(censusVisible);
  const {
    data: geo,
    error,
    isPending,
    isFetching,
    filtersReady,
    isPlaceholderData,
    refetch,
  } = useGeo();
  const { data: layers } = useQuery({
    queryKey: ["layers"],
    queryFn: ({ signal }) => api.layers(signal),
  });
  useEffect(
    () => () => censusHoverIntent.cancel(),
    [censusHoverIntent, censusVisible, activeMetric, listingsVisible, reload],
  );
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
  const resultKey = useMemo(
    () => (geo ? resultSignature(geo.features) : undefined),
    [geo],
  );
  const fit = useCallback(() => {
    const bounds = geo ? resultBounds(geo.features) : undefined;
    if (!map.current || !bounds) return;
    map.current.fitBounds(bounds, {
      padding: { top: 115, right: 45, bottom: 85, left: 45 },
      maxZoom: 16,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 650,
    });
    useAtlas.setState({ fittedResultKey: resultKey });
  }, [geo, resultKey]);
  useEffect(() => {
    if (
      ready &&
      geo &&
      filtersReady &&
      !isFetching &&
      !isPlaceholderData &&
      !pendingChat &&
      (!action || action.type === "none") &&
      resultKey !== fittedKey
    )
      fit();
  }, [
    ready,
    geo,
    filtersReady,
    isFetching,
    isPlaceholderData,
    pendingChat,
    action,
    resultKey,
    fittedKey,
    fit,
  ]);
  useEffect(() => {
    if (
      !ready ||
      !geo ||
      !filtersReady ||
      isFetching ||
      isPlaceholderData ||
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
        useAtlas.getState().select(a.listing_id);
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
    if (a.type !== "none") useAtlas.setState({ fittedResultKey: resultKey });
    lastAction.current = version;
    useAtlas.setState({ mapAction: undefined });
  }, [
    action,
    version,
    ready,
    geo,
    fit,
    filtersReady,
    isFetching,
    isPlaceholderData,
    resultKey,
  ]);
  useEffect(() => {
    if (
      geo &&
      filtersReady &&
      !isFetching &&
      !isPlaceholderData &&
      selected &&
      !selectedFeature
    ) {
      useAtlas.getState().select(undefined);
    }
  }, [
    geo,
    selected,
    selectedFeature,
    filtersReady,
    isFetching,
    isPlaceholderData,
  ]);
  const selectedFilter = useMemo(
    () => ["==", ["get", "id"], selected ?? ""] as never,
    [selected],
  );
  async function onClick(e: MapLayerMouseEvent) {
    const target = mapHoverTarget(e.features, listingsVisible);
    if (target?.type === "section" && censusVisible) {
      if ((map.current?.getZoom() ?? 0) < CENSUS_DETAIL_MIN_ZOOM) return;
      censusHoverIntent.cancel();
      useAtlas.getState().selectCensus(target.id);
      setPinnedCensus({
        id: target.id,
        longitude: e.lngLat.lng,
        latitude: e.lngLat.lat,
      });
      setHoveredCensus(undefined);
      setPopupId(undefined);
      return;
    }
    const feature = listingsVisible
      ? e.features?.find((f) => f.layer.id !== "census-fill")
      : undefined;
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
      useAtlas.getState().selectCensus(undefined);
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
  const showPinnedCensus = Boolean(
    censusVisible &&
    !overListing &&
    pinnedCensus &&
    selectedCensusId === pinnedCensus.id &&
    (!hoveredCensus || hoveredCensus.id === pinnedCensus.id),
  );
  const priceLayer: LayerProps = {
    id: "prices",
    type: "symbol",
    filter: ["!", ["has", "point_count"]],
    layout: {
      visibility: listingsVisible ? "visible" : "none",
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
      "text-color": [
        "case",
        ["==", ["get", "id"], hoveredId ?? ""],
        "#16803c",
        "#17211B",
      ],
      "text-color-transition": { duration: 0, delay: 0 },
      "text-halo-color": "#ffffff",
      "text-halo-width": 0,
      "text-halo-blur": 0,
    },
  };
  return (
    <>
      <Map
        mapLib={maplibregl}
        fadeDuration={0}
        key={reload}
        ref={map}
        initialViewState={viewport}
        maxBounds={
          [...MADRID_BOUNDS[0], ...MADRID_BOUNDS[1]] as [
            number,
            number,
            number,
            number,
          ]
        }
        minZoom={MADRID_MIN_ZOOM}
        renderWorldCopies={false}
        transformConstrain={constrainCamera}
        locale={{ "Popup.Close": "Cerrar vista previa" }}
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
        interactiveLayerIds={[
          ...(listingsVisible ? ["clusters", "prices", "selected-price"] : []),
          ...(censusVisible && census.data ? ["census-fill"] : []),
        ]}
        onMouseMove={(e) => {
          if (e.originalEvent.buttons) {
            censusHoverIntent.cancel();
            setHoveredCensus(undefined);
            setHoveredId(undefined);
            setOverListing(false);
            return;
          }
          const target = mapHoverTarget(e.features, listingsVisible);
          setOverListing(target?.type === "listing");
          setHoveredId(target?.type === "listing" ? target.id : undefined);
          censusHoverIntent.update(
            target?.type === "section" && censusVisible
              ? {
                  id: target.id,
                  longitude: e.lngLat.lng,
                  latitude: e.lngLat.lat,
                }
              : undefined,
            map.current?.getZoom() ?? 0,
          );
        }}
        onMoveStart={() => {
          censusHoverIntent.cancel();
          useAtlas.getState().selectCensus(undefined);
        }}
        onDragStart={() => {
          censusHoverIntent.cancel();
          setHoveredCensus(undefined);
          setHoveredId(undefined);
          setOverListing(false);
        }}
        onMouseEnter={() => {
          const canvas = map.current?.getCanvas();
          if (canvas) canvas.style.cursor = "pointer";
        }}
        onMouseLeave={() => {
          censusHoverIntent.cancel();
          setHoveredId(undefined);
          setHoveredCensus(undefined);
          setOverListing(false);
          const canvas = map.current?.getCanvas();
          if (canvas) canvas.style.cursor = "";
        }}
        attributionControl={{ compact: true }}
        style={{ width: "100%", height: "100%" }}
      >
        {ready && (
          <Source
            id="listings"
            type="geojson"
            data={geo ?? { type: "FeatureCollection", features: [] }}
            cluster
            clusterMaxZoom={13}
            clusterRadius={42}
          >
            <Layer
              id="clusters"
              layout={{ visibility: listingsVisible ? "visible" : "none" }}
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
                visibility: listingsVisible ? "visible" : "none",
                "text-field": ["get", "point_count_abbreviated"],
                "text-font": ["Open Sans Regular"],
                "text-size": 13,
              }}
              paint={{ "text-color": "#fff" }}
            />
            <Layer {...priceLayer} />
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
        {ready && (
          <>
            <Source id="madrid-outside" type="geojson" data={outsideMadrid}>
              <Layer
                id="madrid-mask"
                beforeId="clusters"
                type="fill"
                paint={{ "fill-color": "#eef2ef", "fill-opacity": 1 }}
              />
            </Source>
            <Source id="madrid-boundary" type="geojson" data={madridBoundary}>
              <Layer
                id="madrid-border"
                beforeId="clusters"
                type="line"
                paint={{
                  "line-color": "#74947d",
                  "line-width": 1.3,
                  "line-dasharray": [4, 3],
                }}
              />
            </Source>
            <CensusMapLayers
              hoveredId={censusVisible ? hoveredCensus?.id : undefined}
            />
          </>
        )}
        {layers
          ?.filter(
            (l) => l.available && l.geojson && visibleLayers.includes(l.id),
          )
          .map((l) => ready && <GeographicMapLayer key={l.id} layer={l} />)}
        {censusVisible && hoveredCensus && !showPinnedCensus && (
          <CensusHoverTooltip
            sectionId={hoveredCensus.id}
            longitude={hoveredCensus.longitude}
            latitude={hoveredCensus.latitude}
          />
        )}
        {showPinnedCensus && pinnedCensus && (
          <CensusHoverTooltip
            sectionId={pinnedCensus.id}
            longitude={pinnedCensus.longitude}
            latitude={pinnedCensus.latitude}
            pinned
            onClose={() => {
              setPinnedCensus(undefined);
              useAtlas.getState().selectCensus(undefined);
            }}
          />
        )}
        {listingsVisible && popupFeature && (
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
      <MapLayersPanel />
      <CensusLegend hidden={Boolean(hoveredCensus) || overListing} />
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
      {(pendingChat ||
        isPending ||
        isFetching ||
        !filtersReady ||
        !ready ||
        (censusVisible && (census.isFetching || censusMetrics.isFetching))) &&
        !failed && (
          <div className="map-progress">
            <LoadingStatus
              compact
              title={
                pendingChat
                  ? "Atlas está buscando"
                  : !ready
                    ? "Preparando el mapa"
                    : isFetching || !filtersReady
                      ? "Actualizando viviendas"
                      : "Cargando datos de la zona"
              }
              detail={
                pendingChat
                  ? "Estamos procesando tu consulta. El mapa se actualizará al recibir los resultados."
                  : "Los resultados anteriores siguen visibles hasta completar la consulta."
              }
            />
          </div>
        )}
      {censusVisible && (census.error || censusMetrics.error) && (
        <div className="census-map-error" role="alert">
          <p>{census.error?.message ?? censusMetrics.error?.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (census.error) void census.refetch();
              if (censusMetrics.error) void censusMetrics.refetch();
            }}
          >
            Reintentar datos de la zona
          </Button>
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
        beforeId="clusters"
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
        beforeId="clusters"
        id={`${l.id}-point`}
        type="circle"
        filter={["==", ["geometry-type"], "Point"]}
        paint={{ "circle-radius": 5, "circle-color": l.color ?? "#16803c" }}
      />
      <Layer
        beforeId="clusters"
        id={`${l.id}-line`}
        type="line"
        filter={["==", ["geometry-type"], "LineString"]}
        paint={{ "line-width": 2, "line-color": l.color ?? "#16803c" }}
      />
    </Source>
  );
}
