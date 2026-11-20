
FROM postgis/postgis:17-3.5

# PostgreSQL and PostGIS are already installed.
# SQL files in this directory are executed automatically
# when the database is initialized for the first time.

COPY schema.sql /docker-entrypoint-initdb.d/01-schema.sql
COPY migrations/001_add_datos.sql /docker-entrypoint-initdb.d/02-madrid.sql
COPY migrations/002_listing_sections.sql /docker-entrypoint-initdb.d/03-listing-sections.sql
COPY migrations/003_section_data.sql /docker-entrypoint-initdb.d/04-section-data.sql

EXPOSE 5432
