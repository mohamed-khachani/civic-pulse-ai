# Atlas · Madrid

Spanish rental discovery with real Pisos.com and Fotocasa listings, a MapLibre map, shared filters, property details, census information and complete CSV exports.

## Run locally

Requires Node.js 20.9+ and the Express backend running on port 8000. From this directory:

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The browser calls same-origin `/api/...` routes. Next.js forwards every data request to the server-only `ATLAS_API_BASE_URL` (default `http://127.0.0.1:8000`). There is no runtime demo mode or synthetic-data fallback. Provider and database credentials belong in the backend environment, never in `NEXT_PUBLIC_*` variables.

`NEXT_PUBLIC_MAP_STYLE_URL` controls the map style. The default CARTO Positron style needs no paid key; tiles, glyphs and listing photographs require internet access. `NEXT_PUBLIC_API_TIMEOUT_MS` defaults to 300000 ms to allow multi-stage searches.

## Data flow

Express provides listing search, details, map points, filter options, geographic layers, census sections and metrics, chat and CSV export. The gateway preserves response status, streamed chat, CSV headers and request IDs. Errors remain errors; previous results stay visible while a search is running.

Chat changes filters and returns a `result_set_id`. Cards, map points and exports use the same result set. Detail and map popups also pass that ID to retrieve the matching property assessment. Manual filter edits invalidate the result set; manual changes made while a chat request is pending take precedence when the response arrives. UI state is held in Zustand and query results in TanStack Query.

The MVP uses Claude to estimate journeys to destinations such as a university, workplace, family or friends. The interface labels these as AI estimates without verified timetables. They are separate from observed census measurements.

## Census data

`GET /api/geo/census-sections` returns the backend geometry for the loaded coverage. The wider Community of Madrid navigation outline is bundled separately. Section inspection calls `/api/geo/census-sections/:id/insights` on hover or click at zoom 14 and closer.

`GET /api/geo/census-metrics` uses an ordered transport format:

```json
{
  "sections": ["2807901001", "2807901002"],
  "metrics": [{
    "id": "noise", "name": "Ruido", "unit": "dB",
    "kind": "estimated", "source": "Municipal monitoring stations",
    "stops": [{"value": 40, "color": "#c9e8d4"}, {"value": 70, "color": "#dd7a65"}],
    "values": [52.1, null]
  }]
}
```

Every metric array aligns with the single `sections` array. The client validates unique identifiers and matching lengths before creating local lookup data for rendering. Zero is a valid value; NULL stays unavailable. Units, source, observed/estimated status and optional reference year are preserved. Nearest-station environmental proxies are estimates for a section, not measurements of every address inside it.

Listing/cluster interactions take precedence over census polygons. Hiding listing markers preserves the search, cards and selection. `Sin resaltado` disables the thematic layer. Color palettes are supplied by the backend.

Click a cluster to browse all its listings immediately, six summaries per page. Only the visible summaries fetch property details. Zooming into the group is optional; it keeps the group indicator and open preview while the markers remain close, up to the maximum supported zoom. At close zoom, clicking a price marker also exposes listings at the same point or within its screen footprint, including labels hidden by symbol collisions.

Listing titles and images open the original advert in a new tab. Separate detail buttons retain the in-app view. While chat is pending, a real advert from the database is shown; its price rank refers only to our loaded inventory.

Census inspection and thematic layers expose only NO2, PM2.5, PM10, ozone and total/night noise, with available sources and dates. Full section data remains available to backend search.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Unit tests use isolated fixtures under `tests/fixtures`; those fixtures are not imported by application code. Gateway tests cover real upstream forwarding, response errors, streaming, downloads and compact metric validation. Browser journeys use intercepted API responses to exercise the interface without consuming Claude tokens.
