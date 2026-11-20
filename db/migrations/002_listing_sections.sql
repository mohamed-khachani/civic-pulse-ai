BEGIN;

ALTER TABLE housing.listings
    ADD COLUMN IF NOT EXISTS census_dataset_id TEXT,
    ADD COLUMN IF NOT EXISTS census_section_id TEXT,
    ADD COLUMN IF NOT EXISTS section_match_status TEXT NOT NULL DEFAULT 'pending';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'housing.listings'::regclass AND conname = 'listings_census_section_fk'
    ) THEN
        ALTER TABLE housing.listings ADD CONSTRAINT listings_census_section_fk
            FOREIGN KEY (census_dataset_id, census_section_id)
            REFERENCES madrid.census_sections (dataset_id, cusec) MATCH FULL;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'housing.listings'::regclass AND conname = 'listings_section_match_valid'
    ) THEN
        ALTER TABLE housing.listings ADD CONSTRAINT listings_section_match_valid CHECK (
            (section_match_status = 'matched' AND census_section_id IS NOT NULL AND census_dataset_id IS NOT NULL)
            OR (section_match_status IN ('pending', 'missing_coordinates', 'outside_coverage', 'boundary')
                AND census_section_id IS NULL AND census_dataset_id IS NULL)
        );
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS listings_census_section_idx
    ON housing.listings (census_dataset_id, census_section_id);

CREATE OR REPLACE FUNCTION madrid.match_listing_section()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    matches TEXT[];
BEGIN
    NEW.census_dataset_id := NULL;
    NEW.census_section_id := NULL;

    IF NEW.latitude IS NULL OR NEW.longitude IS NULL THEN
        NEW.section_match_status := 'missing_coordinates';
        RETURN NEW;
    END IF;

    -- Generated listing geometry is unavailable in a BEFORE trigger.
    SELECT array_agg(cusec ORDER BY cusec) INTO matches
    FROM madrid.census_sections
    WHERE dataset_id = 'madrid-municipal'
      AND ST_Covers(geom, ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326));

    IF cardinality(matches) = 1 THEN
        NEW.census_dataset_id := 'madrid-municipal';
        NEW.census_section_id := matches[1];
        NEW.section_match_status := 'matched';
    ELSIF cardinality(matches) > 1 THEN
        NEW.section_match_status := 'boundary';
    ELSE
        NEW.section_match_status := 'outside_coverage';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS listings_match_section ON housing.listings;
CREATE TRIGGER listings_match_section
BEFORE INSERT OR UPDATE OF latitude, longitude, census_dataset_id, census_section_id, section_match_status
ON housing.listings FOR EACH ROW EXECUTE FUNCTION madrid.match_listing_section();

INSERT INTO housing.schema_migrations (version) VALUES ('002_listing_sections')
ON CONFLICT (version) DO NOTHING;

COMMIT;
