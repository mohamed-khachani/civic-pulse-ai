-- CIVIC / HABITAT AI - PostgreSQL schema
-- Base listing schema. Apply db/migrate.sql afterwards for Madrid geography.
-- One canonical portal listing URL; no price history/snapshots;
-- no database-side ingestion (Python parses and upserts).
-- All portal JSON content, including fields without a dedicated column,
-- is preserved in raw_data JSONB. NULL means 'unknown/not supplied'.
-- PostgreSQL 15+ with PostGIS installed.
-- IMPORTANT: CREATE TABLE IF NOT EXISTS does not migrate an existing table.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS housing;

-- floor_label classifies the kind of floor, not its number.
-- Examples: "Bajo" -> 'ground'; "3ª planta" -> 'standard' with floor_number=3;
-- "Ático" -> 'penthouse'; unknown/unprovided -> NULL.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'housing'
          AND t.typname = 'floor_label_enum'
    ) THEN
        CREATE TYPE housing.floor_label_enum AS ENUM (
            'basement',
            'semi_basement',
            'ground',
            'mezzanine',
            'main',
            'standard',
            'penthouse'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS housing.listings (
    -- Source identity. Python maps source='pisos.com' to portal='pisoscom',
    -- and source.portal='fotocasa' to portal='fotocasa'.
    id                        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    portal                    TEXT NOT NULL
                              CHECK (portal IN ('pisoscom', 'fotocasa')),
    portal_listing_id TEXT NOT NULL,
    url                       TEXT NOT NULL,  -- The ONLY standalone URL: portal ad URL.
    listing_reference         TEXT,

    -- Text: both JSONs supply title + description.
    title                     TEXT,
    seo_title                 TEXT,           -- Pisos.com
    description               TEXT,
    description_translations  JSONB,          -- Fotocasa

    -- Listing and advertised price.
    transaction_type          TEXT NOT NULL DEFAULT 'rent',
    property_type             TEXT,           -- Pisos property_type / Fotocasa typology
    building_type             TEXT,           -- Fotocasa
    construction_type         TEXT,           -- Fotocasa
    price_amount              NUMERIC(14,2),
    price_currency            TEXT,
    price_period              TEXT,
    price_per_sqm             NUMERIC(14,2),

    -- Property measurements and building attributes.
    built_sqm                 NUMERIC(12,2),
    usable_sqm                NUMERIC(12,2),
    other_sqm                 NUMERIC(12,2),
    land_sqm                  NUMERIC(12,2),
    bedrooms                  SMALLINT,
    bathrooms                 SMALLINT,
    toilets                   SMALLINT,
    floor_label               housing.floor_label_enum,
    floor_number              SMALLINT,       -- Derived from the same JSON floor value.
    year_built                SMALLINT,
    building_age              SMALLINT,
    orientation               TEXT,
    property_condition        TEXT,

    -- Geo data
    district                  TEXT,
    neighborhood              TEXT,
    postal_code               TEXT,
    street_name               TEXT,
    street_number             TEXT,
    latitude                  DOUBLE PRECISION,
    longitude                 DOUBLE PRECISION,
    coordinates_exact         BOOLEAN,        -- Pisos 'approximate' -> NOT approximate
                                               -- Fotocasa 'coordinates_exact' directly.
    geom                      geometry(Point,4326) GENERATED ALWAYS AS (
        CASE
            WHEN latitude IS NOT NULL AND longitude IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
            ELSE NULL
        END
    ) STORED,

    -- All amenities below appear as keys in at least one of the two samples.
    furnished                 BOOLEAN,
    air_conditioning          BOOLEAN,
    heating                   BOOLEAN,
    elevator                  BOOLEAN,
    parking                   BOOLEAN,
    terrace                   BOOLEAN,
    balcony                   BOOLEAN,
    swimming_pool             BOOLEAN,
    garden                    BOOLEAN,
    storage_room              BOOLEAN,
    exterior                  BOOLEAN,
    accessible                BOOLEAN,
    security                  BOOLEAN,
    internet                  BOOLEAN,
    wifi                      BOOLEAN,
    equipped_kitchen          BOOLEAN,
    oven                      BOOLEAN,
    microwave                 BOOLEAN,
    dishwasher                BOOLEAN,
    washing_machine           BOOLEAN,
    dryer                     BOOLEAN,
    outdoor_space             BOOLEAN,
    bed_linen_towels          BOOLEAN,

    -- Rental conditions: Fotocasa rental_terms and Pisos amenities.
    pets_allowed              BOOLEAN,
    smoking_allowed           BOOLEAN,
    temporary_rental          BOOLEAN,
    min_rental_days           INTEGER,
    max_occupants             SMALLINT,
    bills_included            BOOLEAN,
    available_now             BOOLEAN,
    available_from_text       TEXT,
    occupancy_status          TEXT,

    -- Energy: Pisos 'classification'/'status', Fotocasa 'certificate_type'.
    energy_classification     TEXT,
    energy_rating             TEXT,
    emissions_rating          TEXT,
    energy_status             TEXT,
    energy_certificate_type   TEXT,
    energy_value              NUMERIC(12,3),
    emissions_value           NUMERIC(12,3),

    -- Advertiser details; other links/logo/media remain solely in raw_data.
    advertiser_id             TEXT,
    advertiser_name           TEXT,
    advertiser_type           TEXT,
    advertiser_phone          TEXT,
    advertiser_email          TEXT,
    large_landlord            BOOLEAN,

    -- Sample-specific listing flags.
    is_new                    BOOLEAN,
    is_new_construction       BOOLEAN,
    is_new_development        BOOLEAN,
    is_aggregator             BOOLEAN,
    is_typology               BOOLEAN,
    is_premium                BOOLEAN,
    is_auctioned              BOOLEAN,
    is_occupied               BOOLEAN,
    is_rented_with_tenants    BOOLEAN,
    is_bare_ownership         BOOLEAN,

    -- Source dates only (Pisos published/updated, Fotocasa created).
    published_at              DATE,
    updated_at                DATE,
    portal_created_at         TIMESTAMP WITHOUT TIME ZONE,

    -- Complete, original parsed JSON: photos, videos, feature lists,
    -- source IDs, energy/advertiser metadata, external links and unknown keys.
    raw_data                  JSONB NOT NULL,

    CONSTRAINT listings_portal_id_unique UNIQUE (portal, portal_listing_id),
    CONSTRAINT listings_external_id_nonempty
        CHECK (btrim(portal_listing_id) <> ''),
    CONSTRAINT listings_url_nonempty
        CHECK (btrim(url) <> ''),
    CONSTRAINT listings_portal_url_match CHECK (
        (portal = 'pisoscom' AND url ~* '^https?://(www\.)?pisos\.com(/|$)')
        OR
        (portal = 'fotocasa' AND url ~* '^https?://(www\.)?fotocasa\.es(/|$)')
    ),
    CONSTRAINT listings_raw_data_object CHECK (jsonb_typeof(raw_data) = 'object'),
    CONSTRAINT listings_latlon_valid CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL
            AND latitude BETWEEN -90 AND 90
            AND longitude BETWEEN -180 AND 180)
    ),
    CONSTRAINT listings_price_nonnegative
        CHECK (price_amount IS NULL OR price_amount >= 0),
    CONSTRAINT listings_area_nonnegative CHECK (
        (built_sqm IS NULL OR built_sqm >= 0)
        AND (usable_sqm IS NULL OR usable_sqm >= 0)
        AND (other_sqm IS NULL OR other_sqm >= 0)
        AND (land_sqm IS NULL OR land_sqm >= 0)
    ),
    CONSTRAINT listings_rooms_nonnegative CHECK (
        (bedrooms IS NULL OR bedrooms >= 0)
        AND (bathrooms IS NULL OR bathrooms >= 0)
        AND (toilets IS NULL OR toilets >= 0)
    ),
    CONSTRAINT listings_floor_consistent CHECK (
        floor_number IS NULL OR floor_label IS NOT DISTINCT FROM 'standard'
    )
);

-- Only a few targeted indexes: Python ingest writes often; CIVIC reads/filter often.
CREATE INDEX IF NOT EXISTS listings_geom_gist_idx
    ON housing.listings USING GIST (geom);

CREATE INDEX IF NOT EXISTS listings_district_neighborhood_idx
    ON housing.listings (district, neighborhood);

CREATE INDEX IF NOT EXISTS listings_rent_filter_idx
    ON housing.listings (price_amount, bedrooms, built_sqm)
    WHERE transaction_type = 'rent' AND price_period = 'month';
