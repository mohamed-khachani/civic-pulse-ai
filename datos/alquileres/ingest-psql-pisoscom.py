
def fix_latitude(value):
    if value is None:
        return None
    try:
        lat = float(value)
        if 35000 <= lat <= 45000:
            return lat / 1000
        return lat if -90 <= lat <= 90 else None
    except (ValueError, TypeError):
        return None

#!/usr/bin/env python3
"""Import normalized pisos.com and Fotocasa JSON files into housing.listings."""
import argparse
import json
import logging
import os
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

LOG = logging.getLogger('ingest')


def at(obj, *keys):
    for key in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def first(*values):
    return next((v for v in values if v is not None), None)


def boolean(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return {'true': True, 'yes': True, 'si': True, 'sí': True, 'false': False, 'no': False}.get(value.strip().lower())
    return None


def number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        result = Decimal(str(value).strip())
        return result if result.is_finite() else None
    except (InvalidOperation, ValueError):
        return None


def integer(value):
    n = number(value)
    return int(n) if n is not None and n == int(n) else None


def parse_date(value):
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def parse_datetime(value):
    if not value or not isinstance(value, str) or value.startswith('0001-'):
        return None
    try:
        # Portal timestamps are naive; schema expects TIMESTAMP WITHOUT TIME ZONE.
        return datetime.fromisoformat(value.replace('Z', '+00:00')).replace(tzinfo=None)
    except ValueError:
        return None


def floor_parts(value):
    if value is None:
        return None, None
    if isinstance(value, int):
        return ('ground', None) if value == 0 else ('standard', value)
    s = str(value).strip().lower()
    if not s:
        return None, None
    for token, label in [('semisótano', 'semi_basement'), ('semisotano', 'semi_basement'),
                         ('sótano', 'basement'), ('sotano', 'basement'),
                         ('entreplanta', 'mezzanine'), ('principal', 'main'),
                         ('ático', 'penthouse'), ('atico', 'penthouse'),
                         ('bajo', 'ground'), ('planta baja', 'ground')]:
        if token in s:
            return label, None
    match = re.search(r'(?<!\d)-?\d+', s)
    if match:
        n = int(match.group())
        return ('ground', None) if n == 0 else ('standard', n)
    return None, None


def normalize(data):
    if not isinstance(data, dict):
        raise ValueError('JSON root must be an object')
    src = data.get('source')
    portal = src.get('portal') if isinstance(src, dict) else src
    if portal in ('pisos.com', 'pisoscom', 'Pisos'):
        return normalize_pisos(data)
    if portal == 'fotocasa':
        return normalize_fotocasa(data)
    raise ValueError(f'Unknown source: {portal!r}')


def common_amenities(row, flags):
    mapping = {'furnished': 'furnished', 'air_conditioning': 'air_conditioning',
               'heating': 'heating', 'elevator': 'elevator', 'parking': 'parking',
               'terrace': 'terrace', 'balcony': 'balcony', 'swimming_pool': 'swimming_pool',
               'garden': 'garden', 'storage_room': 'storage_room', 'exterior': 'exterior',
               'accessible': 'accessible', 'security': 'security', 'internet': 'internet',
               'wifi': 'wifi', 'equipped_kitchen': 'equipped_kitchen', 'oven': 'oven',
               'microwave': 'microwave', 'dishwasher': 'dishwasher',
               'washing_machine': 'washing_machine', 'dryer': 'dryer',
               'outdoor_space': 'outdoor_space', 'bed_linen_towels': 'bed_linen_towels',
               'pets_allowed': 'pets_allowed'}
    for dest, key in mapping.items():
        row[dest] = boolean(at(flags, key))


def normalize_pisos(d):
    loc, price, area, rooms = (d.get(k) or {} for k in ('location', 'price', 'area', 'rooms'))
    building, features, energy, advertiser = (d.get(k) or {} for k in ('building', 'features', 'energy', 'advertiser'))
    basic = features.get('datos_basicos') or {}
    equip = features.get('equipamiento_e_instalaciones') or {}
    am = d.get('amenities') or {}
    row = {
        'portal': 'pisoscom', 'portal_listing_id': str(d['listing_id']), 'url': d['url'],
        'listing_reference': d.get('reference'), 'title': d.get('title'),
        'seo_title': d.get('seo_title'), 'description': d.get('description'),
        'transaction_type': d.get('transaction') or 'rent',
        'property_type': d.get('property_type'),
        'price_amount': number(price.get('amount')), 'price_currency': price.get('currency'),
        'price_period': price.get('period'), 'price_per_sqm': number(price.get('per_sqm')),
        'built_sqm': number(area.get('built_sqm')), 'usable_sqm': number(area.get('usable_sqm')),
        'other_sqm': number(area.get('other_sqm')),
        'bedrooms': integer(rooms.get('bedrooms')), 'bathrooms': integer(rooms.get('bathrooms')),
        'toilets': integer(rooms.get('toilets')),
        'year_built': integer(building.get('year_built')),
        'orientation': building.get('orientation'),
        'property_condition': first(building.get('condition'), basic.get('conservacion')),
        'district': loc.get('district'), 'neighborhood': loc.get('neighborhood'),
        'latitude': fix_latitude(loc.get('latitude')),
        'longitude': float(loc['longitude']) if loc.get('longitude') is not None else None,
        'coordinates_exact': (not loc['approximate']) if isinstance(loc.get('approximate'), bool) else None,
        'energy_classification': energy.get('classification'), 'energy_rating': energy.get('rating'),
        'energy_status': energy.get('status'),
        'advertiser_id': str(advertiser['advertiser_id']) if advertiser.get('advertiser_id') is not None else None,
        'advertiser_name': advertiser.get('name'), 'advertiser_phone': advertiser.get('phone'),
        'large_landlord': boolean(advertiser.get('large_landlord')),
        'published_at': parse_date(d.get('published_at')), 'updated_at': parse_date(d.get('updated_at')),
    }
    row['floor_label'], row['floor_number'] = floor_parts(building.get('floor'))
    common_amenities(row, am)
    row['equipped_kitchen'] = first(boolean(equip.get('cocina_equipada')), row['equipped_kitchen'])
    metadata = d.get('platform_metadata') or {}
    for key in ('is_new_development', 'is_aggregator', 'is_typology'):
        row[key] = boolean(metadata.get(key))
    # Building age is a numeric column; 'Más de 50 años' is not an exact age.
    row['building_age'] = integer(building.get('age'))
    # Description-derived rental terms are not promoted without a separate NLP/extraction pass.
    return row


def normalize_fotocasa(d):
    listing, price, loc, prop = (d.get(k) or {} for k in ('listing', 'pricing', 'location', 'property'))
    terms, energy, agency = (d.get(k) or {} for k in ('rental_terms', 'energy', 'agency'))
    flags = at(d, 'amenities', 'flags') or {}
    row = {
        'portal': 'fotocasa', 'portal_listing_id': str(first(listing.get('id'), listing.get('composite_id'))),
        'url': at(d, 'source', 'url'), 'listing_reference': listing.get('reference'),
        'title': listing.get('title'), 'description': listing.get('description'),
        'description_translations': listing.get('description_translations'),
        'transaction_type': listing.get('transaction') or 'rent',
        'property_type': prop.get('typology'), 'building_type': prop.get('building_type'),
        'construction_type': listing.get('construction_type'),
        'price_amount': number(price.get('amount')), 'price_currency': price.get('currency'),
        'price_period': price.get('period'), 'price_per_sqm': number(price.get('price_per_m2')),
        'built_sqm': number(prop.get('surface_m2')), 'land_sqm': number(prop.get('land_surface_m2')),
        'bedrooms': integer(prop.get('rooms')), 'bathrooms': integer(prop.get('bathrooms')),
        'orientation': prop.get('orientation_code'), 'property_condition': prop.get('condition_code'),
        'district': loc.get('district'), 'neighborhood': loc.get('neighborhood'),
        'postal_code': loc.get('postal_code'), 'street_name': loc.get('street_name'),
        'street_number': str(loc['street_number']) if loc.get('street_number') is not None else None,
        'latitude': float(loc['latitude']) if loc.get('latitude') is not None else None,
        'longitude': float(loc['longitude']) if loc.get('longitude') is not None else None,
        'coordinates_exact': boolean(loc.get('coordinates_exact')),
        'temporary_rental': boolean(terms.get('is_temporary')),
        'min_rental_days': integer(terms.get('min_duration_days')),
        'max_occupants': integer(terms.get('max_occupants')),
        'bills_included': boolean(terms.get('bills_included')),
        'available_now': boolean(terms.get('available_now')),
        'available_from_text': terms.get('available_from_text'),
        'occupancy_status': terms.get('occupancy_status'),
        'smoking_allowed': boolean(terms.get('smoking_allowed')),
        'energy_rating': energy.get('rating'), 'emissions_rating': energy.get('emissions_rating'),
        'energy_certificate_type': energy.get('certificate_type'),
        'energy_value': number(energy.get('energy_value')),
        'emissions_value': number(energy.get('emissions_value')),
        'advertiser_id': str(agency['id']) if agency.get('id') is not None else None,
        'advertiser_name': agency.get('name'), 'advertiser_type': agency.get('publisher_type'),
        'advertiser_phone': agency.get('phone'), 'advertiser_email': agency.get('email'),
        'portal_created_at': parse_datetime(listing.get('created_at')),
    }
    row['floor_label'], row['floor_number'] = floor_parts(prop.get('floor'))
    common_amenities(row, flags)
    row['pets_allowed'] = first(boolean(terms.get('pets_allowed')), row['pets_allowed'])
    for key in ('is_new', 'is_new_construction', 'is_premium', 'is_auctioned',
                'is_occupied', 'is_rented_with_tenants', 'is_bare_ownership'):
        row[key] = boolean(listing.get(key))
    return row


def import_file(cur, path, columns):
    data = json.loads(path.read_text(encoding='utf-8'))
    row = normalize(data)
    if not row.get('portal_listing_id') or row['portal_listing_id'] == 'None':
        raise ValueError('Missing portal listing ID')
    if not row.get('url'):
        raise ValueError('Missing portal listing URL')
    row['raw_data'] = Jsonb(data)
    unknown = set(row) - columns
    if unknown:
        raise ValueError(f'Columns missing from schema: {sorted(unknown)}')
    keys = list(row)
    quoted = ', '.join('"' + k + '"' for k in keys)
    placeholders = ', '.join(['%s'] * len(keys))
    updates = ', '.join(f'"{k}" = EXCLUDED."{k}"' for k in keys if k not in ('portal', 'portal_listing_id'))
    query = f'''INSERT INTO housing.listings ({quoted}) VALUES ({placeholders})
                ON CONFLICT (portal, portal_listing_id) DO UPDATE SET {updates}
                RETURNING id'''
    cur.execute(query, [row[k] for k in keys])
    return cur.fetchone()[0], row['portal'], row['portal_listing_id']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, type=Path, help='JSON file or folder (recursive)')
    parser.add_argument('--database-url', default=os.getenv('DATABASE_URL'))
    parser.add_argument('--log-file', default='ingest.log')
    args = parser.parse_args()
    if not args.database_url:
        parser.error('Set DATABASE_URL or pass --database-url')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s',
                        handlers=[logging.StreamHandler(), logging.FileHandler(args.log_file)])
    if not args.input.exists():
        parser.error(f'Input does not exist: {args.input}')
    paths = sorted(args.input.rglob('*.json')) if args.input.is_dir() else [args.input]
    if not paths:
        parser.error('No JSON files found')
    ok = failed = 0
    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute('''SELECT column_name FROM information_schema.columns
                           WHERE table_schema='housing' AND table_name='listings' ''')
            columns = {r[0] for r in cur.fetchall()}
            if not columns:
                raise RuntimeError('housing.listings not found; apply the SQL schema first')
            for path in paths:
                try:
                    result = import_file(cur, path, columns)
                    conn.commit()
                    ok += 1
                    LOG.info('OK %s id=%s portal=%s listing=%s', path, *result)
                except Exception as exc:
                    conn.rollback()
                    failed += 1
                    LOG.error('FAILED %s: %s', path, exc)
    LOG.info('FINISHED: imported=%d failed=%d total=%d', ok, failed, len(paths))
    if failed:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
