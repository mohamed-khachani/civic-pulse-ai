-- CIVIC / HABITAT AI
-- Single-table PostgreSQL schema for normalized Pisos.com / Fotocasa listings.
-- PostgreSQL 15+ and PostGIS. Python is responsible for parsing and upserting.
-- Every source field is preserved in raw_data (JSONB).
-- NULL = unknown / not provided. FALSE = explicitly absent.
-- No history tables, snapshots, SQL parsing functions or ingestion triggers.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS housing;

CREATE TABLE IF NOT EXISTS housing.listings (
    -- Identity: each portal has its own listing ID namespace.
    id                         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    portal                     TEXT NOT NULL,
    portal_listing_id          TEXT NOT NULL,
    listing_reference          TEXT,
    url                        TEXT,
    external_listing_url       TEXT,

    -- Text (kept here for direct API access; also exists in raw_data).
    title                      TEXT,
    seo_title                  TEXT,
    description                TEXT,
    description_translations   JSONB,

    -- Classification and asking price.
    transaction_type           TEXT,           -- e.g. 'rent', 'sale'
    property_type              TEXT,           -- normalized by Python
    building_type              TEXT,
    construction_type          TEXT,
    price_amount               NUMERIC(14,2),
    price_currency             TEXT,
    price_period               TEXT,           -- e.g. 'month'
    price_per_sqm              NUMERIC(14,2),
    previous_price_amount      NUMERIC(14,2),  -- current portal metadata, NOT history

    -- Dwelling.
    built_sqm                  NUMERIC(12,2),
    usable_sqm                 NUMERIC(12,2),
    other_sqm                  NUMERIC(12,2),
    land_sqm                   NUMERIC(12,2),
    bedrooms                   SMALLINT,
    bathrooms                  NUMERIC(4,1),
    toilets                    SMALLINT,
    floor_label                TEXT,           -- preserves 'Bajo', 'Ático', etc.
    floor_number               SMALLINT,
    year_built                 SMALLINT,
    building_age               SMALLINT,
    orientation                TEXT,
    property_condition         TEXT,

    -- Place names and spatial coordinates.
    country                    TEXT,
    autonomous_community       TEXT,
    province                   TEXT,
    municipality               TEXT,
    district                   TEXT,
    neighborhood               TEXT,
    postal_code                TEXT,
    street_name                TEXT,
    street_number              TEXT,
    location_label             TEXT,
    latitude                   DOUBLE PRECISION,
    longitude                  DOUBLE PRECISION,
    coordinates_exact          BOOLEAN,
    geom                       geometry(Point, 4326) GENERATED ALWAYS AS (
        CASE
            WHEN latitude IS NOT NULL AND longitude IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
            ELSE NULL
        END
    ) STORED,

    -- Enrichment by CIVIC's Python geospatial pipeline, not by the portal.
    census_section_code        TEXT,
    census_assignment_confident BOOLEAN NOT NULL DEFAULT FALSE,
    census_assignment_method   TEXT,            -- e.g. 'exact_point', 'manual', 'approximate'

    -- Searchable amenities; leave unknown portal values as NULL.
    furnished                  BOOLEAN,
    air_conditioning           BOOLEAN,
    heating                    BOOLEAN,
    elevator                   BOOLEAN,
    parking                    BOOLEAN,
    terrace                    BOOLEAN,
    balcony                    BOOLEAN,
    swimming_pool              BOOLEAN,
    garden                     BOOLEAN,
    storage_room               BOOLEAN,
    exterior                   BOOLEAN,
    accessible                 BOOLEAN,
    security                   BOOLEAN,
    internet                   BOOLEAN,
    wifi                       BOOLEAN,
    equipped_kitchen           BOOLEAN,
    oven                       BOOLEAN,
    microwave                  BOOLEAN,
    dishwasher                 BOOLEAN,
    washing_machine            BOOLEAN,
    dryer                      BOOLEAN,
    outdoor_space              BOOLEAN,
    bed_linen_towels           BOOLEAN,

    -- Rental rules.
    pets_allowed               BOOLEAN,
    smoking_allowed            BOOLEAN,
    temporary_rental           BOOLEAN,
    min_rental_days            INTEGER,
    max_occupants              SMALLINT,
    bills_included             BOOLEAN,
    available_now              BOOLEAN,
    available_from             DATE,
    occupancy_status           TEXT,

    -- EPC / environmental disclosure.
    energy_rating              TEXT,
    emissions_rating           TEXT,
    energy_status              TEXT,
    energy_value               NUMERIC(12,3),
    emissions_value            NUMERIC(12,3),

    -- Advertiser / agency.
    advertiser_id              TEXT,
    advertiser_name            TEXT,
    advertiser_type            TEXT,
    advertiser_phone           TEXT,
    advertiser_email           TEXT,
    advertiser_website         TEXT,
    advertiser_logo            TEXT,
    large_landlord             BOOLEAN,

    -- Photos / video and full feature lists can be consumed by the API.
    media                      JSONB,
    features                   JSONB,
    amenities_extra            JSONB,

    -- Portal-specific flags.
    is_new_development         BOOLEAN,
    is_aggregator              BOOLEAN,
    is_typology                BOOLEAN,
    is_premium                 BOOLEAN,
    is_occupied                BOOLEAN,
    is_active                  BOOLEAN,        -- set from scraper checks, NULL if unknown

    -- Source dates vs. database observation dates.
    source_published_at        TIMESTAMP WITHOUT TIME ZONE,
    source_updated_at          TIMESTAMP WITHOUT TIME ZONE,
    first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- LOSSLESS SOURCE OF TRUTH: every key, including unrecognized ones.
    raw_data                   JSONB NOT NULL,

    CONSTRAINT listings_portal_id_unique UNIQUE (portal, portal_listing_id),
    CONSTRAINT listings_portal_nonempty CHECK (btrim(portal) <> ''),
    CONSTRAINT listings_external_id_nonempty CHECK (btrim(portal_listing_id) <> ''),
    CONSTRAINT listings_raw_json_object CHECK (jsonb_typeof(raw_data) = 'object'),
    CONSTRAINT listings_latlon_pair_valid CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL
            AND latitude BETWEEN -90 AND 90
            AND longitude BETWEEN -180 AND 180)
    ),
    CONSTRAINT listings_price_nonnegative CHECK (price_amount IS NULL OR price_amount >= 0),
    CONSTRAINT listings_built_sqm_nonnegative CHECK (built_sqm IS NULL OR built_sqm >= 0),
    CONSTRAINT listings_usable_sqm_nonnegative CHECK (usable_sqm IS NULL OR usable_sqm >= 0),
    CONSTRAINT listings_bedrooms_nonnegative CHECK (bedrooms IS NULL OR bedrooms >= 0),
    CONSTRAINT listings_bathrooms_nonnegative CHECK (bathrooms IS NULL OR bathrooms >= 0),
    CONSTRAINT listings_census_confidence_requires_code CHECK (
        NOT census_assignment_confident OR census_section_code IS NOT NULL
    )
);

-- Indexes selected for a write-heavy scraper + read-heavy CIVIC API.
CREATE INDEX IF NOT EXISTS listings_geom_gist_idx
    ON housing.listings USING GIST (geom);

CREATE INDEX IF NOT EXISTS listings_rent_price_idx
    ON housing.listings (price_amount, built_sqm)
    WHERE transaction_type = 'rent'
      AND price_currency = 'EUR'
      AND price_period = 'month';

CREATE INDEX IF NOT EXISTS listings_location_idx
    ON housing.listings (municipality, district, neighborhood);

CREATE INDEX IF NOT EXISTS listings_census_section_idx
    ON housing.listings (census_section_code)
    WHERE census_section_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS listings_last_seen_idx
    ON housing.listings (last_seen_at DESC);
