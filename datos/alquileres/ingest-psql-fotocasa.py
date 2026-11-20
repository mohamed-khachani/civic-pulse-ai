
#!/usr/bin/env python3
"""
Import Fotocasa JSON listings into housing.listings.

Install:
    pip install "psycopg[binary]"

Run:
    export DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/habitat_ai"
    python ingest-psql-fotocasa.py --input ./outputs/fotocasa

Features:
- Recursive JSON discovery
- PostgreSQL UPSERT (no duplicate portal IDs)
- Complete original JSON stored in raw_data
- Per-file transactions and error handling
- Coordinate, floor, date and boolean normalization
- Progress logs
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import unicodedata

from datetime import datetime, date, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb


LOG = logging.getLogger("fotocasa_ingest")

AMENITY_COLUMNS = (
    "furnished",
    "air_conditioning",
    "heating",
    "elevator",
    "parking",
    "terrace",
    "balcony",
    "swimming_pool",
    "garden",
    "storage_room",
    "exterior",
    "accessible",
    "security",
    "internet",
    "wifi",
    "equipped_kitchen",
    "oven",
    "microwave",
    "dishwasher",
    "washing_machine",
    "dryer",
    "outdoor_space",
    "bed_linen_towels",
)

FLAG_COLUMNS = (
    "is_new",
    "is_new_construction",
    "is_premium",
    "is_auctioned",
    "is_occupied",
    "is_rented_with_tenants",
    "is_bare_ownership",
)


def at(obj, *keys):
    for key in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def first(*values):
    return next(
        (v for v in values if v is not None and v != ""),
        None,
    )


def text(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    result = str(value).strip()
    return result or None


def boolean(value):
    if isinstance(value, bool):
        return value

    if isinstance(value, int) and value in (0, 1):
        return bool(value)

    if isinstance(value, str):
        return {
            "true": True,
            "yes": True,
            "si": True,
            "sí": True,
            "1": True,
            "allowed": True,
            "permitido": True,
            "false": False,
            "no": False,
            "0": False,
            "not allowed": False,
            "no permitido": False,
            "prohibido": False,
        }.get(value.strip().casefold())

    return None


def number(value):
    if value is None or isinstance(value, bool):
        return None

    try:
        if isinstance(value, str):
            value = value.strip().replace(" ", "")

            if re.fullmatch(
                r"-?\d{1,3}(?:\.\d{3})+(?:,\d+)?",
                value,
            ):
                value = value.replace(".", "").replace(",", ".")
            elif "," in value and "." not in value:
                value = value.replace(",", ".")

        result = Decimal(str(value))
        return result if result.is_finite() else None

    except (InvalidOperation, ValueError, TypeError):
        return None


def integer(value, minimum=None, maximum=None):
    n = number(value)

    if n is None or n != n.to_integral_value():
        return None

    result = int(n)

    if minimum is not None and result < minimum:
        return None
    if maximum is not None and result > maximum:
        return None

    return result


def nonnegative(value):
    n = number(value)
    return n if n is not None and n >= 0 else None


def smallint(value, minimum=0):
    return integer(value, minimum=minimum, maximum=32767)


def coordinate(value, latitude=True):
    n = number(value)

    if n is None:
        return None

    n = float(n)

    # Some scraped coordinates may lose their decimal point.
    # Only correct the known Madrid latitude representation.
    if latitude and 35000 <= n <= 45000:
        n /= 1000

    limit = 90 if latitude else 180
    return n if -limit <= n <= limit else None


def parse_date(value):
    if not isinstance(value, str) or not value:
        return None

    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def parse_datetime(value):
    if not isinstance(value, str) or not value:
        return None

    if value.startswith("0001-"):
        return None

    try:
        dt = datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )

        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc)

        return dt.replace(tzinfo=None)

    except ValueError:
        return None


def normalize_string(value):
    value = unicodedata.normalize("NFKD", str(value))
    value = "".join(
        c for c in value
        if not unicodedata.combining(c)
    )
    return value.strip().casefold()


def floor_parts(value):
    if value is None or isinstance(value, bool):
        return None, None

    s = normalize_string(value)

    special = (
        ("semisotano", "semi_basement"),
        ("semi sotano", "semi_basement"),
        ("sotano", "basement"),
        ("entreplanta", "mezzanine"),
        ("principal", "main"),
        ("atico", "penthouse"),
        ("bajo", "ground"),
        ("planta baja", "ground"),
    )

    for token, label in special:
        if token in s:
            return label, None

    n = integer(value)

    if n is None:
        match = re.search(r"(?<!\d)-?\d+", s)
        n = int(match.group()) if match else None

    if n is None or not -32768 <= n <= 32767:
        return None, None

    if n == 0:
        return "ground", None

    if n < 0:
        return "basement", None

    return "standard", n


def valid_fotocasa_url(value):
    if not isinstance(value, str):
        return None

    value = value.strip()
    parsed = urlparse(value)

    if (
        parsed.scheme.lower() not in ("http", "https")
        or parsed.hostname not in (
            "fotocasa.es",
            "www.fotocasa.es",
        )
    ):
        return None

    return value


def normalize_fotocasa(data):
    if not isinstance(data, dict):
        raise ValueError("JSON root must be an object")

    source = data.get("source") or {}

    if not isinstance(source, dict):
        raise ValueError("Invalid Fotocasa source")

    if source.get("portal") != "fotocasa":
        raise ValueError("JSON is not from Fotocasa")

    listing = data.get("listing") or {}
    pricing = data.get("pricing") or {}
    location = data.get("location") or {}
    prop = data.get("property") or {}
    amenities = data.get("amenities") or {}
    terms = data.get("rental_terms") or {}
    energy = data.get("energy") or {}
    agency = data.get("agency") or {}

    flags = amenities.get("flags") or {}

    listing_id = first(
        listing.get("id"),
        listing.get("composite_id"),
    )

    if listing_id is None:
        raise ValueError("Missing Fotocasa listing ID")

    url = valid_fotocasa_url(source.get("url"))

    if not url:
        raise ValueError("Missing or invalid Fotocasa URL")

    lat = coordinate(
        location.get("latitude"),
        latitude=True,
    )

    lon = coordinate(
        location.get("longitude"),
        latitude=False,
    )

    # Coordinates must be stored as a complete pair.
    if lat is None or lon is None:
        lat = None
        lon = None

    row = {
        # Identity
        "portal": "fotocasa",
        "portal_listing_id": str(listing_id),
        "url": url,
        "listing_reference": text(listing.get("reference")),

        # Text
        "title": text(listing.get("title")),
        "description": text(listing.get("description")),
        "description_translations": (
            Jsonb(listing["description_translations"])
            if listing.get("description_translations") is not None
            else None
        ),

        # Listing
        "transaction_type": (
            text(listing.get("transaction")) or "rent"
        ),
        "property_type": text(prop.get("typology")),
        "building_type": text(prop.get("building_type")),
        "construction_type": text(
            listing.get("construction_type")
        ),

        # Pricing
        "price_amount": nonnegative(pricing.get("amount")),
        "price_currency": text(pricing.get("currency")),
        "price_period": text(pricing.get("period")),
        "price_per_sqm": nonnegative(
            pricing.get("price_per_m2")
        ),

        # Property
        "built_sqm": nonnegative(prop.get("surface_m2")),
        "land_sqm": nonnegative(
            prop.get("land_surface_m2")
        ),
        "bedrooms": smallint(prop.get("rooms")),
        "bathrooms": smallint(prop.get("bathrooms")),

        # Location
        "district": text(location.get("district")),
        "neighborhood": text(
            location.get("neighborhood")
        ),
        "postal_code": text(
            location.get("postal_code")
        ),
        "street_name": text(
            location.get("street_name")
        ),
        "street_number": text(
            location.get("street_number")
        ),
        "latitude": lat,
        "longitude": lon,
        "coordinates_exact": boolean(
            location.get("coordinates_exact")
        ),

        # Rental terms
        "temporary_rental": boolean(
            terms.get("is_temporary")
        ),
        "min_rental_days": integer(
            terms.get("min_duration_days"),
            minimum=0,
        ),
        "max_occupants": smallint(
            terms.get("max_occupants")
        ),
        "bills_included": boolean(
            terms.get("bills_included")
        ),
        "available_now": boolean(
            terms.get("available_now")
        ),
        "available_from_text": text(
            terms.get("available_from_text")
        ),
        "occupancy_status": text(
            terms.get("occupancy_status")
        ),
        "smoking_allowed": boolean(
            terms.get("smoking_allowed")
        ),
        "pets_allowed": boolean(
            terms.get("pets_allowed")
        ),

        # Energy
        "energy_rating": text(energy.get("rating")),
        "emissions_rating": text(
            energy.get("emissions_rating")
        ),
        "energy_certificate_type": text(
            energy.get("certificate_type")
        ),
        "energy_value": nonnegative(
            energy.get("energy_value")
        ),
        "emissions_value": nonnegative(
            energy.get("emissions_value")
        ),

        # Advertiser
        "advertiser_id": text(agency.get("id")),
        "advertiser_name": text(agency.get("name")),
        "advertiser_type": text(
            agency.get("publisher_type")
        ),
        "advertiser_phone": text(agency.get("phone")),
        "advertiser_email": text(agency.get("email")),

        # Dates
        "portal_created_at": parse_datetime(
            listing.get("created_at")
        ),
    }

    # Floor
    row["floor_label"], row["floor_number"] = floor_parts(
        prop.get("floor")
    )

    # Only store orientation and condition codes
    # if the source provides them.
    row["orientation"] = text(
        prop.get("orientation_code")
    )
    row["property_condition"] = text(
        prop.get("condition_code")
    )

    # Amenities
    for column in AMENITY_COLUMNS:
        row[column] = boolean(flags.get(column))

    # Listing flags
    for column in FLAG_COLUMNS:
        row[column] = boolean(listing.get(column))

    # Entire original document
    row["raw_data"] = Jsonb(data)

    return row


def build_upsert_query(columns):
    keys = list(columns)

    insert_columns = sql.SQL(", ").join(
        sql.Identifier(k) for k in keys
    )

    placeholders = sql.SQL(", ").join(
        sql.Placeholder() for _ in keys
    )

    update_columns = [
        k for k in keys
        if k not in ("portal", "portal_listing_id")
    ]

    updates = sql.SQL(", ").join(
        sql.SQL("{} = EXCLUDED.{}").format(
            sql.Identifier(k),
            sql.Identifier(k),
        )
        for k in update_columns
    )

    return sql.SQL("""
        INSERT INTO housing.listings ({})
        VALUES ({})
        ON CONFLICT (portal, portal_listing_id)
        DO UPDATE SET {}
        RETURNING id
    """).format(
        insert_columns,
        placeholders,
        updates,
    )


def import_file(cur, path, db_columns):
    data = json.loads(
        path.read_text(encoding="utf-8-sig")
    )

    row = normalize_fotocasa(data)

    unknown = set(row) - db_columns

    if unknown:
        raise ValueError(
            f"Columns missing from schema: {sorted(unknown)}"
        )

    query = build_upsert_query(row.keys())

    cur.execute(query, list(row.values()))

    result = cur.fetchone()

    return {
        "id": result[0],
        "portal_listing_id": row["portal_listing_id"],
        "price": row["price_amount"],
    }


def main():
    parser = argparse.ArgumentParser(
        description="Ingest Fotocasa JSON into PostgreSQL"
    )

    parser.add_argument(
        "--input",
        type=Path,
        default=Path("./outputs/fotocasa"),
        help="JSON file or folder (recursive)",
    )

    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL"),
    )

    parser.add_argument(
        "--log-file",
        default="ingest-fotocasa.log",
    )

    args = parser.parse_args()

    if not args.database_url:
        parser.error(
            "Set DATABASE_URL or pass --database-url"
        )

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(args.log_file),
        ],
    )

    if not args.input.exists():
        parser.error(
            f"Input path does not exist: {args.input}"
        )

    if args.input.is_dir():
        paths = sorted(
            p for p in args.input.rglob("*")
            if p.is_file() and p.suffix.lower() == ".json"
        )
    else:
        paths = [args.input]

    if not paths:
        parser.error("No JSON files found")

    LOG.info("Found %d JSON files", len(paths))

    success = 0
    failed = 0

    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'housing'
                  AND table_name = 'listings'
            """)

            db_columns = {
                r[0] for r in cur.fetchall()
            }

            if not db_columns:
                raise RuntimeError(
                    "housing.listings does not exist. "
                    "Apply the SQL schema first."
                )

            for i, path in enumerate(paths, start=1):
                try:
                    result = import_file(
                        cur, path, db_columns
                    )

                    conn.commit()
                    success += 1

                    LOG.info(
                        "[%d/%d] OK %s | db_id=%s "
                        "listing=%s price=%s",
                        i,
                        len(paths),
                        path.name,
                        result["id"],
                        result["portal_listing_id"],
                        result["price"],
                    )

                except Exception as exc:
                    conn.rollback()
                    failed += 1

                    LOG.error(
                        "[%d/%d] FAILED %s: %s",
                        i,
                        len(paths),
                        path.name,
                        exc,
                    )

    LOG.info(
        "FINISHED: total=%d imported=%d failed=%d",
        len(paths),
        success,
        failed,
    )

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
