# Atlas API

Express + TypeScript service for the real PostgreSQL listings and Madrid census data. Next.js forwards its `/api` requests to this server; no fixtures or demo fallback are used.

## Run

Requires Node 22+ and the database migrations/data described in `../db/README.md`.

```sh
cd backend
npm install
cp .env.example .env
# Fill DATABASE_URL and ANTHROPIC_API_KEY in .env.
npm run build
npm start
```

The default listener is `127.0.0.1:8000`. Use `npm run dev` for development. In Next.js set server-only `ATLAS_API_BASE_URL=http://127.0.0.1:8000`. Keep keys in `backend/.env`, never in public frontend variables. `/health` checks the database and reports listing/section counts.

## Data

The service reads `housing.listings` and the `madrid` tables. Official section/district/neighborhood names take precedence over differing portal labels. All rental listings with known prices and monthly/unspecified periods are searchable; unknown characteristics remain NULL. Images are read from the portals' preserved JSON. CSV export includes the full filtered result set with quoting and spreadsheet-formula protection.

Supported endpoints:

- `POST /api/chat`
- `GET /api/listings`, `/api/listings/geo`, `/api/listings/export`
- `GET /api/listings/:id`, `/api/listings/:id/insights`
- `GET /api/filters/options`
- `GET /api/geo/census-sections`, `/api/geo/census-metrics`
- `GET /api/geo/census-sections/:id/insights`, `/api/geo/census-sections/:id/data`
- `GET /api/geo/metric-catalog`, `/api/geo/districts`, `/api/geo/layers`

`census-metrics` returns `{sections: [...ids], metrics: [{..., values: [...]}]}`. Values align with the shared section order. Full section data uses `{columns, rows, section_id}`. Empty overlay lists indicate unsupported standalone layers, not synthetic data.

## Conversation

The first Claude request receives the current filters, recent conversation, relevant selected property, available non-demographic metric metadata, and relevant area values as ordered arrays, grouped by identical vectors with all section IDs preserved; explicit residential neighborhoods restrict that context to their official sections. The model returns a validated search plan. Property constraints use flat field/value entries in the provider schema and are converted to typed filters locally; this avoids the provider’s limit on nullable schema parameters. The backend compiles allowlisted property/area conditions into parameterized SQL; it never executes model-written SQL. Missing environmental values cannot pass a numerical condition.

Prompt-only area values are rounded to two decimals; stored values retain their full precision. Coverage/sample counts are omitted from relevance vectors unless requested. Candidate batches contain up to 300 rows. Batches above 100 eligible homes are split into two independent parallel calls with a shared acceptance quota; smaller batches use one call. Claude assesses them until 50 accepted results, exhausted candidates, or the configured batch/time budget. The target and batch limit are configurable. Accepted IDs, order, assessments, and plan are stored in `housing.result_sets`; conversation context is stored in `housing.conversations`. These two operational tables are created on startup. Results expire after 24 hours. The listings, map, and export endpoints use the same result-set ID. Changing manual criteria without that ID runs a fresh database search.

A shortlist is not a global optimum across unexamined candidates. Budget-limited searches say that more candidates remain. The model evaluates qualitative preferences; the SQL enforces hard numerical/property limits. Candidate descriptions are treated as untrusted data. Protected demographic traits and health indicators are excluded from suitability criteria. Entire-home requests also exclude recognizable room adverts before assessment, including source adverts mislabeled as flats.

## Journey estimates

For the MVP Claude estimates transit journeys to work, university, relatives, friends, or other destinations. The plan preserves destination purpose, relevant days/times, direction and transport mode. Public transport is assumed unless car, bicycle or walking is requested. Ambiguous destinations prompt a question. Unless provided otherwise, university/work arrival is assumed to be 09:00 on a weekday and identified as an assumption.

To shorten the response time, the assessment ranks candidates without generating repeated itineraries for every home. A separate small Claude request prepares journeys for the first five selected homes. The chat includes only one short route summary rather than repeating individual itineraries. Durations are intervals explicitly labeled unverified AI estimates, not timetable results or guaranteed commute times. The other shortlisted homes have no individual itinerary yet. Returned IDs and destination labels are validated. Routine destinations carry more weight than occasional visits, based on the stated days and the user's explicit priorities. A daily family visit therefore takes precedence over a weekly university trip.

The map's census inspector and thematic selector expose only NO₂, PM2.5, PM10, O₃ and total/night noise measurements. The complete dataset remains available for search and the full section-data endpoint.

## Logs and limits

A `chat_usage_total` event sums all calls, input/output/cache tokens, estimated USD cost and duration per chat, including failed chats. `claude_started` shows stages as they begin. JSON logs go to stdout and `logs/api.jsonl`. Each Claude call records request ID, stage, model, provider request ID, attempt, input/output/cache tokens, estimated cost, elapsed time, and stop reason. Batch and completed-search logs record fetched/accepted totals and stopping conditions. Logs omit prompts, API keys, personal addresses, and full listing descriptions.

Cost estimates default to Haiku 5.5 rates configured in code; the >100k-input tier is handled separately. Optional environment price overrides can be used for a different model. These are estimates, not a billing ledger. Provider failures are shown as errors and never replaced with fixture results. Abort signals cancel model calls when the browser disconnects. Database statements have a 30-second timeout, and conversations have a configurable overall deadline.

```sh
npm test
npm run typecheck
npm run build
```
