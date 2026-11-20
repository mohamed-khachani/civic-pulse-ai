# Atlas · Madrid

Rental search with real Pisos.com and Fotocasa listings, Madrid census data, and a Spanish conversational assistant powered by Claude. Next.js serves the interface and forwards data requests to an Express/TypeScript API backed by PostgreSQL/PostGIS.

## Run locally

Requires Node.js 22+, npm, and PostgreSQL with PostGIS. Install the two applications:

```sh
npm --prefix backend install
npm --prefix front-end install
```

Create `backend/.env` from `backend/.env.example`, then set `DATABASE_URL` and `ANTHROPIC_API_KEY`. Create `front-end/.env.local` from `front-end/.env.example`. The frontend's server-only `ATLAS_API_BASE_URL` should point to `http://127.0.0.1:8000`. Keep the Claude key in the backend only.

With the local database prepared, start both services from the repository root:

```sh
docker compose -f db/docker-compose.yml up -d
npm run build
npm start
```

Open http://localhost:3000. Express listens on `127.0.0.1:8000`; `/health` reports database counts. The application uses real data and reports provider errors without a demo fallback. Development remains available separately through `npm run dev`.

For a fresh database, follow [the database setup and ingestion instructions](db/README.md). For the API contracts, conversation behavior, limits and logs, see [the backend README](backend/README.md). The [frontend README](front-end/README.md) covers map behavior and browser checks.

## Search and area data

The backend sends Claude relevant census variables as compact tables with an ordered column list and arrays of values. Claude returns a structured search plan; the API translates its supported conditions into parameterized SQL. It assesses listing batches and saves a shared result set for the cards, map and CSV export. Area data is enriched for Madrid city; listings outside the loaded coverage retain missing area values.

Existing files in `datos/` supply the measurements. External metadata is used only where needed to locate stations. Environmental section values are nearest-station estimates with source/distance information, not measurements at each property. Missing readings remain missing.

For this MVP, Claude estimates journeys (public transport by default, or the mode requested) to university, work, family, friends and other destinations. The interface labels these as unverified AI estimates. They are not timetable-based routes or guaranteed commute times.

## Checks

```sh
npm test
npm run build
```

With both services running, `npm run test:integration` checks real listing filters, the Next.js gateway, compact environmental arrays and complete section data. It does not call Claude.

Claude usage and request logs are written to `backend/logs/api.jsonl`. They include token counts, latency, batches and estimated model cost, without logging the API key or full prompts.

---

The original hackathon brief follows.

<img width="3950" height="868" alt="2c1c-encadenados-logo-fondo-oscuro" src="https://github.com/user-attachments/assets/6c74e246-e94f-417c-8e98-ac9a276aa3a9" />

# 🚀 2Campus1Code - Hackatón DAETSISI-DAETSIINF-ORANGE

Desarrolla un MVP de una aplicación web que consuma al menos una fuente oficial de datos abiertos y la transforme en un servicio útil, visual e interactivo para la ciudadanía. Al acabar, presenta tu solución a los jueces.

## 🎯 Hitos mínimos

- 📊 Consumir datos abiertos de una fuente oficial (API o datasets CSV/JSON/GeoJSON).
- 🏗️ Disponer de frontend y backend (o funciones serverless) con una arquitectura estructurada.
- ✨ Aportar valor más allá de mostrar datos: filtrado, visualizaciones, recomendaciones, cruce de fuentes, etc.
- 🐙 Mantener el código en un repositorio público con un historial de commits coherente.

## 🤖 Uso de IA

Se permite y fomenta el uso de herramientas de IA para el desarrollo.

Durante la evaluación:

- 🧠 Debéis poder explicar cualquier parte del código o decisión técnica
- 📝 El repositorio debe incluir un archivo `AI_USAGE.md` describiendo brevemente las herramientas utilizadas y su contribución al desarrollo.


## ⏱️ Duración

6 horas de desarrollo en total, repartidas entre los dos días que dura la hackatón.

## 📦 Entregables

El repositorio final debe incluir:

- 💻 Código fuente completo y funcional.
- 📄 `AI_USAGE.md`.
- 🔗 Enlaces a las fuentes de datos abiertas utilizadas.

## Production build and service shutdown

From the repository root, start PostgreSQL, compile both applications, then run the compiled services:

```sh
docker compose -f db/docker-compose.yml up -d
npm run build
npm start
```

Open http://localhost:3000. The Express API listens on http://127.0.0.1:8000. `npm start` uses `backend/dist` and `next start`; it does not run development servers. Existing `backend/.env` and `db/.env` supply credentials. Use `npm install --prefix backend` and `npm install --prefix front-end` first only if dependencies are missing. After code changes, rebuild before starting.

`Ctrl+C` stops both application services. To stop the application listeners and the repository database from another terminal, run:

```sh
npm run stop
```

The stop command checks that listeners on ports 3000/8000 belong to this repository before sending SIGTERM. It stops the database container without removing its volume.

During a chat, previous listing cards and map points are hidden. Real inventory curiosities rotate every eight seconds with a short fade. On completion, cards, map and CSV share only the query result set. Explicit residential neighborhoods resolve through official census membership; travel destinations do not become housing-area constraints. The planner receives relevant census fields with identical vectors grouped by section IDs. Each batch of up to 300 eligible homes is evaluated in two parallel parts (small batches use one call), then up to five shortlisted homes get compact journey estimates. Public transport is the default; explicit car, walking or bicycle requests are preserved. Repeated route explanations are removed.

Backend stdout and `backend/logs/api.jsonl` contain `claude_started`, per-call `claude_usage`, and a final `chat_usage_total` with input/output/cache tokens, estimated USD cost, call count, status and total duration. Costs are estimates using configurable rates; parallel calls do not mix usage between users. No new latency guarantee has been measured with the services stopped.
