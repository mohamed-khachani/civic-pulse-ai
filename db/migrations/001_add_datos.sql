BEGIN;

CREATE TABLE IF NOT EXISTS housing.schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS madrid;

CREATE TABLE IF NOT EXISTS madrid.datasets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    source_url TEXT,
    reference_year SMALLINT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS madrid.municipalities (
    code TEXT PRIMARY KEY CHECK (code ~ '^[0-9]{5}$'),
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS madrid.districts (
    municipality_code TEXT NOT NULL REFERENCES madrid.municipalities (code),
    code TEXT NOT NULL CHECK (code ~ '^[0-9]{2}$'),
    name TEXT NOT NULL,
    area_km2 DOUBLE PRECISION CHECK (area_km2 > 0),
    PRIMARY KEY (municipality_code, code)
);

CREATE TABLE IF NOT EXISTS madrid.neighborhoods (
    municipality_code TEXT NOT NULL,
    code TEXT NOT NULL CHECK (code ~ '^[0-9]{3}$'),
    district_code TEXT NOT NULL,
    name TEXT NOT NULL,
    area_km2 DOUBLE PRECISION CHECK (area_km2 > 0),
    PRIMARY KEY (municipality_code, code),
    UNIQUE (municipality_code, district_code, code),
    FOREIGN KEY (municipality_code, district_code)
        REFERENCES madrid.districts (municipality_code, code),
    CHECK (left(code, 2) = district_code)
);

CREATE TABLE IF NOT EXISTS madrid.census_sections (
    dataset_id TEXT NOT NULL REFERENCES madrid.datasets (id),
    municipality_code TEXT NOT NULL,
    section_code TEXT NOT NULL CHECK (section_code ~ '^[0-9]{5}$'),
    cusec TEXT GENERATED ALWAYS AS (municipality_code || section_code) STORED,
    district_code TEXT GENERATED ALWAYS AS (left(section_code, 2)) STORED,
    neighborhood_code TEXT,
    geom geometry(MultiPolygon, 4326) NOT NULL,
    PRIMARY KEY (dataset_id, cusec),
    FOREIGN KEY (municipality_code, district_code)
        REFERENCES madrid.districts (municipality_code, code),
    FOREIGN KEY (municipality_code, district_code, neighborhood_code)
        REFERENCES madrid.neighborhoods (municipality_code, district_code, code),
    CHECK (NOT ST_IsEmpty(geom) AND ST_IsValid(geom))
);

CREATE INDEX IF NOT EXISTS census_sections_geom_idx
    ON madrid.census_sections USING GIST (geom);

-- Boundaries are derived from the sections in each dataset, so vintages stay separate.
CREATE OR REPLACE VIEW madrid.district_boundaries AS
SELECT dataset_id, municipality_code, district_code,
       ST_Multi(ST_Union(geom)) AS geom
FROM madrid.census_sections
GROUP BY dataset_id, municipality_code, district_code;

CREATE OR REPLACE VIEW madrid.neighborhood_boundaries AS
SELECT dataset_id, municipality_code, district_code, neighborhood_code,
       ST_Multi(ST_Union(geom)) AS geom
FROM madrid.census_sections
WHERE neighborhood_code IS NOT NULL
GROUP BY dataset_id, municipality_code, district_code, neighborhood_code;

CREATE OR REPLACE VIEW madrid.municipality_boundaries AS
SELECT dataset_id, municipality_code, ST_Multi(ST_Union(geom)) AS geom
FROM madrid.census_sections
GROUP BY dataset_id, municipality_code;

CREATE TABLE IF NOT EXISTS madrid.metrics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('section', 'district', 'neighborhood', 'station', 'postal')),
    description TEXT
);

CREATE TABLE IF NOT EXISTS madrid.section_metrics (
    census_dataset_id TEXT NOT NULL,
    cusec TEXT NOT NULL,
    metric_id TEXT NOT NULL REFERENCES madrid.metrics (id),
    source_id TEXT NOT NULL REFERENCES madrid.datasets (id),
    value DOUBLE PRECISION,
    kind TEXT NOT NULL CHECK (kind IN ('observed', 'estimated')),
    source_area_code TEXT NOT NULL,
    PRIMARY KEY (census_dataset_id, cusec, metric_id, source_id),
    FOREIGN KEY (census_dataset_id, cusec)
        REFERENCES madrid.census_sections (dataset_id, cusec),
    CHECK (value IS NULL OR value NOT IN ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8))
);

INSERT INTO madrid.municipalities (code, name)
VALUES ('28079', 'Madrid') ON CONFLICT (code) DO NOTHING;

INSERT INTO madrid.datasets (id, name, source, notes)
VALUES (
    'madrid-municipal', 'Madrid city census boundaries',
    'datos/geografia/seccionado-censa.json',
    'Municipal snapshot with 2462 sections. Boundary reference year is unverified; do not label it INE 2025.'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO housing.schema_migrations (version) VALUES ('001_add_datos')
ON CONFLICT (version) DO NOTHING;

COMMIT;
