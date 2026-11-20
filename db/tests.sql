\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
    ASSERT (SELECT count(*) FROM madrid.districts WHERE municipality_code = '28079') = 21;
    ASSERT (SELECT count(*) FROM madrid.census_sections WHERE dataset_id = 'madrid-municipal') = 2462;
    ASSERT (SELECT reference_year IS NULL FROM madrid.datasets WHERE id = 'madrid-municipal');
    ASSERT NOT EXISTS (
        SELECT 1 FROM madrid.census_sections
        WHERE NOT ST_IsValid(geom) OR ST_IsEmpty(geom) OR ST_SRID(geom) <> 4326
    );
    ASSERT EXISTS (SELECT 1 FROM madrid.census_sections WHERE cusec = '2807901001' AND section_code = '01001');
END
$$;

-- Small adjacent squares make boundary cases independent of simplification in the source data.
INSERT INTO madrid.census_sections (dataset_id, municipality_code, section_code, neighborhood_code, geom)
VALUES
    ('madrid-municipal', '28079', '01998', '011', ST_Multi(ST_MakeEnvelope(0, 0, 1, 1, 4326))),
    ('madrid-municipal', '28079', '01999', '011', ST_Multi(ST_MakeEnvelope(1, 0, 2, 1, 4326)));

INSERT INTO housing.listings (portal, portal_listing_id, url, raw_data, latitude, longitude, coordinates_exact)
VALUES
    ('pisoscom', 'test-inside', 'https://www.pisos.com/test-inside', '{}', 0.5, 0.5, false),
    ('pisoscom', 'test-boundary', 'https://www.pisos.com/test-boundary', '{}', 0.5, 1, true),
    ('pisoscom', 'test-outside', 'https://www.pisos.com/test-outside', '{}', 20, 20, NULL),
    ('pisoscom', 'test-missing', 'https://www.pisos.com/test-missing', '{}', NULL, NULL, NULL);

DO $$
BEGIN
    ASSERT (SELECT section_match_status = 'matched' AND census_section_id = '2807901998'
            AND census_dataset_id = 'madrid-municipal' AND coordinates_exact = false
            FROM housing.listings WHERE portal_listing_id = 'test-inside');
    ASSERT (SELECT section_match_status = 'boundary' AND census_section_id IS NULL
            FROM housing.listings WHERE portal_listing_id = 'test-boundary');
    ASSERT (SELECT section_match_status = 'outside_coverage' AND census_section_id IS NULL
            FROM housing.listings WHERE portal_listing_id = 'test-outside');
    ASSERT (SELECT section_match_status = 'missing_coordinates' AND census_section_id IS NULL
            FROM housing.listings WHERE portal_listing_id = 'test-missing');
END
$$;

UPDATE housing.listings SET longitude = 1.5 WHERE portal_listing_id = 'test-inside';
DO $$
BEGIN
    ASSERT (SELECT census_section_id = '2807901999' AND coordinates_exact = false
            FROM housing.listings WHERE portal_listing_id = 'test-inside');
END
$$;

UPDATE housing.listings SET latitude = NULL, longitude = NULL WHERE portal_listing_id = 'test-inside';
DO $$
BEGIN
    ASSERT (SELECT census_section_id IS NULL AND census_dataset_id IS NULL
            AND section_match_status = 'missing_coordinates'
            FROM housing.listings WHERE portal_listing_id = 'test-inside');
END
$$;

-- The same CUSEC can exist in another vintage without affecting municipal matches.
INSERT INTO madrid.datasets (id, name, source, reference_year)
VALUES ('test-other-vintage', 'Other boundaries', 'test fixture', 2025);
INSERT INTO madrid.census_sections (dataset_id, municipality_code, section_code, neighborhood_code, geom)
VALUES ('test-other-vintage', '28079', '01999', '011', ST_Multi(ST_MakeEnvelope(1, 0, 2, 1, 4326)));
UPDATE housing.listings SET longitude = 1.5 WHERE portal_listing_id = 'test-outside';
UPDATE housing.listings SET latitude = 0.5 WHERE portal_listing_id = 'test-outside';
DO $$
BEGIN
    ASSERT (SELECT census_dataset_id = 'madrid-municipal' AND section_match_status = 'matched'
            FROM housing.listings WHERE portal_listing_id = 'test-outside');
    BEGIN
        INSERT INTO madrid.census_sections (dataset_id, municipality_code, section_code, neighborhood_code, geom)
        VALUES ('madrid-municipal', '28079', '02998', '011', ST_Multi(ST_MakeEnvelope(3, 0, 4, 1, 4326)));
        RAISE EXCEPTION 'A section must not reference a neighborhood in another district';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;
END
$$;

INSERT INTO madrid.datasets (id, name, source, reference_year)
VALUES ('test-rents', 'Rental reference', 'test fixture', 2024);
INSERT INTO madrid.metrics (id, name, unit, scope)
VALUES ('test-district-rent', 'District rental reference', 'EUR/month', 'district');
INSERT INTO madrid.section_metrics (census_dataset_id, cusec, metric_id, source_id, value, kind, source_area_code)
VALUES ('madrid-municipal', '2807901998', 'test-district-rent', 'test-rents', 0, 'observed', '2807901');
DO $$
BEGIN
    ASSERT (SELECT value = 0 FROM madrid.section_metrics WHERE metric_id = 'test-district-rent');
    BEGIN
        UPDATE madrid.section_metrics SET value = 'NaN' WHERE metric_id = 'test-district-rent';
        RAISE EXCEPTION 'Non-finite metric values must be rejected';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END
$$;
UPDATE madrid.section_metrics SET value = NULL WHERE metric_id = 'test-district-rent';
DO $$
BEGIN
    ASSERT (SELECT value IS NULL FROM madrid.section_metrics WHERE metric_id = 'test-district-rent');
END
$$;

ROLLBACK;
\echo Geography checks passed. Test rows were rolled back.
