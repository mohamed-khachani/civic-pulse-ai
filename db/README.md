# Database

The enriched rental search covers **Madrid city** (municipality `28079`). The frontend can still display the whole Community of Madrid, but the other municipalities do not have enriched local data yet. A listing outside the loaded polygons stays in the database with `outside_coverage` status.

## Geography and identifiers

- Municipality: five-character INE code, `28079` for Madrid.
- District: two characters within a municipality, such as `01`.
- Neighborhood: three characters within a municipality, such as `011` (Palacio).
- Municipal census section: five characters, district plus section, such as `01001`.
- Full census identifier (`cusec`): municipality plus municipal section, such as `2807901001`.

Keep these as text to preserve leading zeroes. Districts and neighborhoods use municipality + local code as their keys. Census sections use dataset + full identifier because section boundaries can change between snapshots.

The `madrid-municipal` dataset uses the existing municipal geometry in `datos/_etl_/output/sections.geojson`, generated from `datos/geografia/seccionado-censa.json`. Its reference year is unknown and remains NULL. All 2,462 section codes also exist in the frontend's INE 2025 snapshot, but this does not establish that their boundaries are identical. The frontend snapshot is not replaced or relabeled.

`madrid.census_sections` stores section polygons. The municipality, district and neighborhood boundary views dissolve those polygons within the same dataset. District and neighborhood areas from the original CSVs are stored separately; those published areas can differ from the dissolved geometry.

`madrid.section_data` has one row per section, with every ETL column in its `data` JSONB object. Identifiers stay strings; numeric values are numbers; missing values are NULL. This preserves the complete row while allowing the API to select relevant fields and serialize them as ordered arrays.

`madrid.metrics` defines each numeric variable's name, unit and source scope. `madrid.section_metrics` stores its value for a target section, the source dataset, observed/estimated status, and original area/station code. For inherited district/barrio values, preserve that scope and original area code. Sources and years belong in `madrid.datasets`; unknown years/URLs stay NULL. Unknown study units use `valor` rather than an invented unit. Missing values are NULL, and measured zeroes remain zero.

## Existing database

From the repository root, apply the migrations:

```sh
psql "$DATABASE_URL" -X -f db/migrate.sql
```

For the existing Docker service:

```sh
docker exec -i postgres-db psql -U habitat_admin -d habitat_ai -X -v ON_ERROR_STOP=1 < db/migrations/001_add_datos.sql
docker exec -i postgres-db psql -U habitat_admin -d habitat_ai -X -v ON_ERROR_STOP=1 < db/migrations/002_listing_sections.sql
docker exec -i postgres-db psql -U habitat_admin -d habitat_ai -X -v ON_ERROR_STOP=1 < db/migrations/003_section_data.sql
```

Each migration runs in a transaction and records its version in `housing.schema_migrations`. They can be reapplied without dropping data. Migration 002 adds nullable section links and the matching trigger; the geography load below backfills existing listings after the polygons are available.

## Load the local geography

The loader uses Python's standard library and prints SQL. It verifies municipal/frontend identifier coverage before producing any SQL. Run with pipe failure handling enabled:

```sh
set -o pipefail
python3 db/load-geography.py | psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1
```

Or with Docker:

```sh
set -o pipefail
python3 db/load-geography.py | docker exec -i postgres-db psql -U habitat_admin -d habitat_ai -X -v ON_ERROR_STOP=1
```

The transaction upserts districts, neighborhoods and sections, then matches all existing listings. Rerunning it does not duplicate geography or listings. It does not delete obsolete sections automatically; unexpected sections make the transaction fail for review.

## Listing matches

Listings retain their portal district/neighborhood names and `coordinates_exact` flag. Section matching uses advertised coordinates, not those text labels, and never changes coordinate precision.

- `pending`: not matched yet, normally before the initial geography load.
- `matched`: the coordinate is covered by exactly one polygon. Read `coordinates_exact` to determine the advertised precision; a successful match is not proof of an exact address.
- `boundary`: more than one polygon covers the point; no section is assigned.
- `outside_coverage`: no loaded polygon covers the coordinate. This can include points near simplified boundaries, not just properties outside the city.
- `missing_coordinates`: coordinates are unavailable.

Inserts and coordinate updates automatically recalculate these fields. If you change the polygon dataset, rerun the geography loader to recalculate existing matches.

## Fresh database

The Docker image applies `schema.sql` and the migrations during first initialization. Rebuild the image for new volumes; an existing volume still needs the migration commands above. Run the geography loader after startup. Do not remove the database volume to apply a schema update. Compose reads database credentials from `db/.env`; use `db/.env.example` for the expected names.

For a fresh database outside Docker, apply `db/schema.sql`, then `db/migrate.sql`, then load the geography.

## Regenerate and ingest census data

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r datos/_etl_/requirements.txt
.venv/bin/python datos/_etl_/main.py --config datos/_etl_/paths.json
.venv/bin/python datos/_etl_/validate.py --config datos/_etl_/paths.json
.venv/bin/python db/ingest-sections.py
```

The importer reads `DATABASE_URL` when set, otherwise it uses the local `db/.env`. It checks section coverage against the loaded polygons, upserts complete section rows and metadata, and replaces only its own `etl:` metric observations in one data transaction. Repeating it does not duplicate rows. It does not call any external service.

The current output has **2,462 sections, 528 columns, 520 numeric metrics, and 1,280,240 metric rows**, including explicit NULL readings. Original measurement files are used locally and never redownloaded by the ETL. The district-rental source is now included. Study indicator years are read from the workbook dictionary after removing chapter-number prefixes.

Air and noise measurements come entirely from `datos/calidad-vida/calidad-aire.csv` and `contaminacion-acustica.csv`. Because those files lack coordinates, reference metadata is stored in `datos/_etl_/reference_data/`, with a `.source.json` provenance file beside each CSV. Air coordinates come from the official EEA monitoring service and retain national sampling-point identifiers. Noise coordinates are a partial verified extract from the municipal PAMCA 2025 station table; stations 16, 24 and 54 were excluded because their published coordinates are inconsistent. No replacement coordinates were guessed.

Environmental readings use the latest available year in the local observations (2026), which may be incomplete. Each section inherits the nearest station's reading only within 2 km of its representative point. These are **estimated area proxies**, not measurements across an entire polygon. The current coverage is 1,983 sections for at least one air pollutant and 1,906 for noise; individual pollutants can have lower coverage. Noise LAeq averages combine equal-duration observations energetically, not by arithmetic averaging of decibels. Air magnitude IDs keep their distinct pollutants and units.

The traffic archive is present locally, but no verified sensor-coordinate file is available yet, so geographic traffic metrics remain unavailable. Postal-code rental estimates likewise remain unavailable without a verified section/postcode crosswalk. `coverage_report.json` records these gaps. Optional reference metadata can be refreshed separately using `fetch_station_locations.py`; this downloads reference files only, not the local observation datasets.

## Checks

After loading geography into a separate test database, run `psql "$TEST_DATABASE_URL" -X -f db/tests.sql`. It checks the real geometry and hierarchy, coordinate updates, ambiguous boundaries, missing coordinates, approximate locations, separate vintages, and metric zeroes/NULLs. The test data is rolled back. Use a separate database because PostgreSQL identity sequences still advance on rollback.
