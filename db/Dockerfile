
FROM postgis/postgis:17-3.5

# PostgreSQL and PostGIS are already installed.
# SQL files in this directory are executed automatically
# when the database is initialized for the first time.

COPY schema.sql /docker-entrypoint-initdb.d/01-schema.sql

EXPOSE 5432
