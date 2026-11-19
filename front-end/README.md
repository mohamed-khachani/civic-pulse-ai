# Atlas · Madrid

A responsive rental discovery frontend: Spanish conversation, a MapLibre workspace, shared filters, property details and complete CSV exports. Built with Next.js App Router, strict TypeScript, Tailwind CSS, shadcn-style Radix primitives, Lucide, TanStack Query, Zustand, React Hook Form/Zod, Motion and Sonner.

## Run locally

Requires Node.js 20.9+ and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Development defaults to the visibly labeled **mock mode** if the variable is unset; production requires `NEXT_PUBLIC_USE_MOCK_API=true` to enable it explicitly. The checked-in example sets this flag. The demo banner, cards and detail views identify the synthetic listings; photos are illustrative Unsplash images. Synthetic listings have no original portal URL, personalized score or invented environmental measurements.

```bash
npm run typecheck
npm run lint
npm test
npm run build
# Optional browser journeys (download browser once):
npx playwright install chromium
npm run test:e2e
```

## Connect the backend

Set `NEXT_PUBLIC_USE_MOCK_API=false` and `NEXT_PUBLIC_API_BASE_URL` in `.env.local`, then restart. These are public frontend variables: never put secrets in them. The backend must allow the frontend origin through CORS. API failures remain errors; they never fall back to mock data.

All paths live in `src/lib/api/client.ts`; adapters are in `src/lib/api/index.ts`, and Zod contracts and exported types in `src/types/index.ts`. Proposed endpoints:

| Endpoint                   | Contract                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `POST /api/chat`           | `ChatRequest` → `ChatResponse`                                                               |
| `GET /api/listings`        | Filters, sort, page, page_size, optional result_set_id → `ListingSearchResponse`             |
| `GET /api/listings/:id`    | `Listing` with optional insights and compatibility                                           |
| `GET /api/listings/geo`    | Same filters/result_set_id → GeoJSON points `{id, price}`; no listing descriptions or images |
| `GET /api/listings/export` | Same filters/sort/result_set_id → complete UTF-8 CSV, not just one page                      |
| `GET /api/filters/options` | Supported districts, neighborhoods, sources, features and sorts                              |
| `GET /api/geo/layers`      | Available geographic layers, GeoJSON and optional metric metadata                            |

Reserved paths for districts, census sections and separate insight fetching are centralized; the UI currently consumes layers and listing-embedded insights. Bounds serialize as `west,south,east,north`. Booleans preserve `false`; unknown optional fields stay empty. See schemas for exact payloads. Only available filter features and sort options appear. Large exports remain server-side; mock exports use the complete filtered fixture set with BOM, CSV escaping and formula-injection protection.

Chat responses apply filter patches by default. `filters_mode: "replace"` replaces the complete filter set (including clearing it). Every chat request includes current filters, selected listing, conversation ID and result-set ID. The map action union is validated; no backend code is executed. Manual edits during a pending chat response take precedence over that response's filters and viewport. Query keys and cancellation isolate late search results. Chat accepts complete JSON responses or optional `text/event-stream`: `event: delta` carries JSON `{ "text": "fragment" }`; `event: done` carries the complete validated `ChatResponse`. Only the final validated event changes filters/map state. Interrupted or invalid streams show a retryable error. Adapt this transport if the backend uses a different streaming protocol.

## Map and geographic data

`NEXT_PUBLIC_MAP_STYLE_URL` configures a public MapLibre style; the example uses CARTO Positron with its provider/OSM attribution. No paid key is required. External map tiles, glyphs and photographs require internet access. Map failures provide a retry action; listing search stays available. Point data uses GPU GeoJSON layers with clustering, not thousands of DOM markers. Search bounds apply only after clicking **Buscar en esta zona**. Selecting listings synchronizes map/card/context; fitting results is explicit.

Optional geographic layers render polygons, points and lines only when supplied. Metric legends preserve units, scope and measurement/estimate metadata. Missing data is visibly unavailable. The frontend does not calculate location suitability or commuting times. Neighborhood introduction cards are discovery shortcuts, not measured neighborhood assessments.

## Structure

- `src/app`: server entry, providers, design tokens, responsive styling.
- `src/components`: shell, chat, map, filters, cards/details, reusable Radix primitives.
- `src/hooks`: cached, debounced, abortable server queries and chat orchestration.
- `src/stores/atlas-store.ts`: composes separate search, map, conversation and UI slices in one atomic shared store. Server listing results stay in TanStack Query.
- `src/lib/api`: validated production boundary; mock mode dynamically loads the separate `src/lib/mock` adapter.
- `tests`: contract, state, filtering, stale-response, CSV and optional Playwright journey coverage.

On mobile the header switches between a full-screen map and a dedicated conversation tab; shared state survives either view. Accessible Radix dialogs/popovers manage focus, the input supports Enter/Shift+Enter and IME, and reduced-motion preferences are respected by CSS/Motion. No authentication, scraper, database, backend, or scoring service is implemented.

## Madrid boundaries, automatic camera and census layers

The map uses the actual Comunidad de Madrid outline, dissolved from the INE's 179 municipal polygons. `transformConstrain` limits all gestures and programmatic camera moves to that outline; a neutral mask hides the territory outside it. The region's bounding box and minimum zoom also limit navigation. This is a simplified administrative display boundary, not cadastral precision.

Every completed geographic search automatically fits **all** returned points, independent of the listing-card pagination. A single listing can zoom to street/neighborhood scale (maximum automatic zoom 16). Panning, changing layers and switching modes do not reframe an unchanged result set. Explicit focus actions take precedence. Pending/stale responses do not move the camera.

**Capas y entorno** now includes:

- All **4,518 INE 2025 census sections** across the Community, lazily loaded from the bundled WGS84 snapshot.
- Read-only inspection on hover (or tap on mobile). The card shows all available section variables, independent of the highlighted variable. End users cannot edit colors.
- A single layer selector for choropleth variables with owner-configured hexadecimal color stops. No census-only tab, section search, or unavailable “other layers” list is exposed. Missing measurements stay gray. The API controls the palette and any per-section colors.
- A legend showing units, source, observed/estimated/demo status, and a section inspector showing the selected value.
- All polygon, point and line overlays insert **before the listing layers**. Listings and popups stay above them.

Geographic shapes are real INE data. In mock mode, acoustic pollution and NO₂ values are **explicitly synthetic demonstration fixtures**, not environmental measurements. The population variable comes from the INE 2025 census and is labeled separately. Production loads environmental metrics from `GET /api/geo/census-metrics`, returning `CensusMetric[]` with `id`, `name`, `unit`, `kind`, `source`, optional `year`/`description`, sorted `stops: [{value,color}]` and `values: { [censusSectionId]: number | null }`. No environmental values are invented on production failures. GeoJSON features may also carry an optional per-section `properties.color`, set by the application owner/backend. Palette colors come from the API’s `CensusMetric.stops[].color`; demo palettes live in `src/lib/mock/census.ts`. These are configuration inputs, not user-editable controls.

Override `NEXT_PUBLIC_CENSUS_GEOJSON_URL` to use the backend's full census collection instead of the bundled snapshot. Features require `properties.id` (CUSEC), `properties.municipality` and a Polygon/MultiPolygon geometry; optional `population` and `color` remain optional. Keep the geometry snapshot and metric identifiers on the same census vintage.

Source and attribution: [INE Censo 2025 geographic service](https://www.ine.es/servergis/rest/services/Hosted/Censo_2025___N%C3%BAmero_de_personas/FeatureServer). **Seccionado cedido por el Instituto Nacional de Estadística.** See `public/geo/README.md`. Rebuild the public assets and bundled navigation boundary using `npm run geo:refresh` (network required). No housing backend is implemented by this preparation script.

## Latency handling

Chat, initial queries, filter changes, background result refreshes and census data show an accessible indeterminate progress bar, contextual status, elapsed time, and a reassuring message after ten seconds. No fabricated completion percentage is shown. Previous markers/cards remain visible and are identified as previous results during updates. Map panning stays available. The API timeout defaults to 90 seconds, configurable with `NEXT_PUBLIC_API_TIMEOUT_MS` (1–300 seconds). `NEXT_PUBLIC_MOCK_LATENCY_MS` controls demo latency.

Hovering a census polygon gives it a subtle raised appearance (3 px elevation and a small shadow), preserving its configured thematic color and keeping listings above it. Listing and cluster hit tests always take precedence over census hover. **Ocultar viviendas / Mostrar viviendas** toggles only map markers and property popups; search criteria, cards, selection and conversation are preserved. **Sin resaltado** disables the census overlay entirely. Missing readings appear as “Sin datos”, and demo/estimated/observed provenance is shown per metric.

Section hover details and the raised hover effect require **5 seconds on the same section at zoom 14 or closer**. Moving within that section does not restart the timer; entering a different section, a listing, empty space, leaving the map, panning/zooming, changing the variable, or unmounting cancels it. Clicking a section opens its information immediately at the same detail zoom. The delay and zoom threshold live in `src/lib/census-hover-intent.ts`. Listing hover uses a color change on the existing price layer, with zero paint-transition duration and MapLibre symbol fading disabled, so leaving a listing restores its normal appearance immediately.
