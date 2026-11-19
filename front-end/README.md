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
