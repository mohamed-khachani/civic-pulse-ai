# AI usage

Codex assisted with repository analysis, database migrations, census-data ingestion, the Express/TypeScript API, Next.js integration, tests, and documentation. Parallel agents worked on ingestion, backend, and frontend changes, with integration checks against the local database and running applications.

At runtime, Claude interprets search requests and assesses real listing batches using property and area data. It returns structured plans that the backend validates and compiles into parameterized SQL. Claude also provides the MVP's clearly labeled journey estimates; no routing or timetable service verifies those estimates.

Measurements come from the datasets in `datos/`. AI is not used to invent environmental readings, station coordinates, or missing census values. Model usage is recorded in server logs. API keys are stored in ignored, server-only environment files.
