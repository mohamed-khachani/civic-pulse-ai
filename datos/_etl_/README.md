# HABITAT AI — Madrid census-section ETL

This is a complete, reproducible ETL based on the **19 datasets provided in this conversation**. The primary output is one **single-row CSV for each census section**, with the inherited district/neighbourhood fields and spatially joined section attributes.

The complete rows and metric metadata can also be loaded into PostgreSQL using `python db/ingest-sections.py` from the repository root. See `db/README.md` for schema, credentials and ingestion commands. The current run contains 2,462 sections and 528 fields per row, including district rental references and real nearest-station air/noise proxies. The original observation files are reused locally; only missing station-location metadata was obtained externally, with provenance under `reference_data/`.

## Setup

Python 3.10+:

```bash
python -m pip install -r requirements.txt
python main.py --config paths.json
python validate.py --config paths.json
python lookup.py --config paths.json --lat 40.4168 --lon -3.7038 --rent 1200
```

Edit **`paths.json`** to point every source to its actual location. Paths can be absolute or relative to the location of `paths.json`, **not** to the current working directory. Blank optional paths are explicitly unsupported/unprovided data; do not substitute made-up values.

The default `../filename` paths refer to the original uploaded filenames and are usable when this project folder sits next to the original uploads. Windows absolute paths also work (escape backslashes in JSON or use forward slashes).

To run just some stages:

```bash
python main.py --config paths.json --steps padron housing facilities accidents
```

### Optional: obtain station locations automatically (official Madrid open-data portal)

After configuring your files, run:

```bash
python fetch_station_locations.py --config paths.json
python main.py --config paths.json
```

This downloads station-location metadata from official sources and stores it in `reference_data/`, updating only the corresponding paths in `paths.json`. Air metadata falls back to the official EEA station service when the municipal download is unavailable. Traffic requests the **October 2026** location snapshot to match the local October readings. Network access is required only for this optional metadata refresh. Failed downloads do not replace working local reference paths or invent station locations. URLs and resource IDs may need updating when a dataset changes. The full traffic archive is over 800MB uncompressed.

Official sources: [traffic-location dataset](https://datos.madrid.es/dataset/202468-0-intensidad-trafico), [air-monitoring stations](https://datos.madrid.es/dataset/212629-0-estaciones-control-aire), [noise-monitoring stations](https://datos.madrid.es/dataset/211346-0-estaciones-acusticas).

## Output

```text
output/
  sections_master.csv           # exactly one row for each section
  sections.geojson              # point-in-polygon geometry for listing lookups
  section_index.csv             # census code to per-section CSV path
  study_metric_dictionary.csv   # original 2026 indicator labels, update years/sources
  coverage_report.json         # per-column completeness and input status
  validation_report.json       # written by validate.py
  by_section/
    01001.csv                   # same schema as sections_master.csv; one row
    01002.csv
    ...
```

The **geometric section code is authoritative**, represented as a 5-character Madrid code (district 2 chars + section 3 chars). The neighbourhood code is separate (district 2 chars + barrio 1 char). For incoming listings call `lookup.find_section(output_dir, lon, lat)` or CLI with `--lon --lat`; no geocoding is done here because listings must already have coordinates.

## Inputs and joins

| Source | Spatial level | Implemented behaviour |
|---|---|---|
| `seccionado-censa.json` | Section polygons, TopoJSON | Decode deltas/reversed arcs, repair invalid geometries, spatial STRtree |
| `distritos.csv` / `Barrios.csv` | District / barrio | Proper hierarchy and administrative areas |
| `padron.csv` | Census section & age | Aggregate population and age bands, density from polygon area |
| `referencia-precio-alquiler-seccion-censa;.xlsx` | Section | 2024 median/p25/p75 rental and dwelling stats |
| `referencias-precio-alquiler-distrito.xlsx` | District | 2024 rental stats inherited for each section |
| `estudio-2026.xlsx` | District and neighbourhood | Extract numeric indicators and inherit with distinct prefixes; source years in dictionary |
| `centros-educativos.csv` | Points | In-section count, counts within 500/1000 m, nearest distance |
| `centros-atencion-medica.csv` | Points | Ditto |
| `instalaciones-deportivas.csv` | Points | Ditto |
| `bibliotecas.csv` | Points | Ditto |
| `parques-y-jardines.csv` | Points | Ditto (park records, **not actual park-area polygons**) |
| `arbolado-superficie.csv` | Named park areas | Name-matches parks; area attributed to containing park *marker*, NOT land cover |
| `accidentes-trafico.xlsx` | Incident UTM coordinates | Count unique accident IDs in census polygons (no per-person double counting) |
| `accidentes-bici.xlsx` | Incident UTM coordinates | Separate unique bike incident counts; these may overlap road incidents |
| `alquiler-medio.csv` | 2023 postal codes | Optional `section_postal_crosswalk` required; **not** joined without evidence |
| `calidad-aire.csv` | Daily monitoring stations | Optional `air_station_locations`, nearest station <= configurable distance |
| `contaminacion-acustica.csv` | Daily noise monitoring stations | Optional `noise_station_locations`, nearest station <= configurable distance |
| `trafico-2026.zip` | Sensor-time-series (October 2026) | Optional `traffic_sensor_locations`, stream ZIP without extraction |

### Additional CSVs that are needed for complete environmental and traffic coverage

The uploaded observation data do not contain coordinates for monitoring stations. You must obtain the official station/sensor geocoding reference or create a **verified** mapping. These are optional paths in `paths.json`:

- `traffic_sensor_locations` CSV columns: `sensor_id,lat,lon` (or `id,lat,lon`). Example headers only; actual rows must use authoritative coordinates.
- `air_station_locations` CSV columns: `station_id,lat,lon` (`station_id` matches `ESTACION`).
- `noise_station_locations` CSV columns: `station_id,lat,lon` (`station_id` matches `Estación`).
- `section_postal_crosswalk` CSV columns: `section_code,postal_code,weight`. Here `weight` is the **fractional overlap or another explicitly documented measured weight**, not arbitrary 1s. A section can intersect several postcodes.

You can add paths and call individual stages independently. If geographic sensor data are not provided, environmental and traffic measurements remain **missing**, never zero.

## Critical scientific/ethical limitations

1. **Spatial granularity is not uniform**: section statistics, inherited district/barrio metrics, sensor point measurements and points of interest have different semantics; prefixes label source scale (`district_`, `barrio_`, `section_`, `*_nearest_station`). Avoid portraying inherited district statistics as measured inside a section.
2. **Distance means straight-line Euclidean distance in EPSG:25830**, not walking time or network distance. Use your multimodal router separately for actual commute/travel times.
3. **The 2024 rents are reference medians**, not live listing prices; compare them with actual scraped listings using date/context.
4. **POI locations are points, not polygons.** Park coverage area cannot be derived from a list of park markers. For real green coverage, supply official park/green-space polygon geometry.
5. **Monitoring values are nearest-station proxies**, with an explicit station distance cutoff, not an exposure model. Air `MAGNITUD` codes preserve their original measurement code and are not merged across pollutants; consult official unit definitions. Equal-duration noise LAeq readings combine as energy, not arithmetic dB. Current noise station coordinates are a partial verified 2025 municipal table; three inconsistent entries were excluded. Air station coordinates come from official EEA sampling-point metadata. Station moves are not reconstructed across historical years. Latest-year observations may cover only part of the year.
6. **Traffic intensity is a reported sensor rate**, not a counted traffic flow sum. 2026 input contains October observations; do not label it yearly traffic.
7. **Population demographic columns are context only, not protected-characteristic filters**. Do not score housing suitability based on age, nationality, gender, ethnicity or proxies for protected traits. Score property suitability by stated user requirements, price, transit and amenities.
8. The source studies bundle indicators from **different years**. Each source's year is preserved in names or metadata; never claim all variables are 2026 observations.
9. Missing values are blank; computed/verified zero counts are 0. Check `coverage_report.json` to distinguish coverage gaps.

## Extending

Each stage implements `enrich(cfg, records[, index])`; records are dictionaries keyed by census code. To add bike lanes, transport stops, actual parks polygons or crime data, create a new stage, match at the correct scale and include it in `main.py`. The manifest makes source gaps visible. Rerunning regenerates section files deterministically, without modifying original inputs.
