BEGIN;

CREATE TABLE IF NOT EXISTS madrid.section_data (
    census_dataset_id TEXT NOT NULL,
    cusec TEXT NOT NULL,
    data JSONB NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (census_dataset_id, cusec),
    FOREIGN KEY (census_dataset_id, cusec)
        REFERENCES madrid.census_sections (dataset_id, cusec)
);

CREATE INDEX IF NOT EXISTS section_metrics_lookup_idx
    ON madrid.section_metrics (metric_id, census_dataset_id, value, cusec);

INSERT INTO housing.schema_migrations (version) VALUES ('003_section_data')
ON CONFLICT (version) DO NOTHING;

COMMIT;
