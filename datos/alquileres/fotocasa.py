#!/usr/bin/env python3
"""Extract and normalize Fotocasa detail pages saved as HTML.

Usage:
    python fotocasa_to_json.py listing.html
    python fotocasa_to_json.py ./html_pages --output ./json_pages
    python fotocasa_to_json.py ./html_pages --output ./json_pages --compact

The complete two original property objects are kept under `raw` unless --compact
is set. Unknown attributes remain null, never silently false.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

BASE_URL = "https://www.fotocasa.es"


class FotocasaHTMLParser(HTMLParser):
    """Collect only relevant structured data and page metadata."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.props_chunks: list[str] = []
        self.capture_props = False
        self.capture_title = False
        self.title_chunks: list[str] = []
        self.meta: dict[str, str] = {}
        self.canonical: str | None = None
        self.lang: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        if tag == "html":
            self.lang = attrs_dict.get("lang")
        elif tag == "script" and attrs_dict.get("id") == "__initial_props__":
            self.capture_props = True
        elif tag == "title":
            self.capture_title = True
        elif tag == "meta":
            key = attrs_dict.get("property") or attrs_dict.get("name")
            if key and attrs_dict.get("content"):
                self.meta[key] = attrs_dict["content"]  # type: ignore[index]
        elif tag == "link" and attrs_dict.get("rel") == "canonical":
            self.canonical = attrs_dict.get("href")

    def handle_data(self, data: str) -> None:
        if self.capture_props:
            self.props_chunks.append(data)
        if self.capture_title:
            self.title_chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self.capture_props = False
        elif tag == "title":
            self.capture_title = False


def at(obj: Any, *keys: str, default: Any = None) -> Any:
    for key in keys:
        if not isinstance(obj, dict):
            return default
        obj = obj.get(key)
        if obj is None:
            return default
    return obj


def first(*values: Any) -> Any:
    """First meaningful value; zero and False are meaningful."""
    return next((v for v in values if v is not None and v != ""), None)


def as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        clean = value.strip().casefold()
        if clean in {"yes", "true", "si", "sí", "1", "allowed", "permitido"}:
            return True
        if clean in {"no", "false", "0", "not allowed", "no permitido", "prohibido"}:
            return False
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    return None


def as_number(value: Any) -> int | float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if not isinstance(value, str):
        return None
    clean = value.strip().replace("\u00a0", "").replace(" ", "")
    if re.fullmatch(r"-?\d{1,3}(?:\.\d{3})+(?:,\d+)?", clean):
        clean = clean.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"-?\d+(?:,\d+)?", clean):
        clean = clean.replace(",", ".")
    if not re.fullmatch(r"-?\d+(?:\.\d+)?", clean):
        return None
    result = float(clean) if "." in clean else int(clean)
    return result


def positive_number(value: Any) -> int | float | None:
    n = as_number(value)
    return n if n is not None and n > 0 else None


def norm(text: Any) -> str:
    s = unicodedata.normalize("NFKD", str(text or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.casefold()).strip()


def typed_features(v2: dict[str, Any], old: dict[str, Any]) -> dict[str, Any]:
    """Combine Fotocasa's two typed-feature representations."""
    result: dict[str, Any] = {}
    for feature in old.get("featuresList") or []:
        if isinstance(feature, dict) and feature.get("label"):
            result[str(feature["label"]).upper()] = feature.get("value")
    for feature in v2.get("features") or []:
        if isinstance(feature, dict) and feature.get("type"):
            result[str(feature["type"]).upper()] = feature.get("value")
    return result


AMENITY_ALIASES: dict[str, tuple[str, ...]] = {
    "air_conditioning": ("aire acondicionado", "air conditioning"),
    "heating": ("calefaccion", "heating", "calefaccio"),
    "furnished": ("amueblado", "furnished", "moblat", "mobiliado"),
    "elevator": ("ascensor", "elevator", "lift"),
    "internet": ("internet", "conexion a internet"),
    "wifi": ("wifi", "wi-fi"),
    "equipped_kitchen": ("cocina equipada", "fully equipped kitchen"),
    "oven": ("horno", "oven"),
    "microwave": ("microondas", "microwave"),
    "dishwasher": ("lavavajillas", "dishwasher"),
    "washing_machine": ("lavadora", "washing machine"),
    "dryer": ("secadora", "tumble dryer"),
    "parking": ("parking", "garaje", "garage"),
    "balcony": ("balcon", "balcony"),
    "terrace": ("terraza", "terrace"),
    "garden": ("jardin", "garden"),
    "swimming_pool": ("piscina", "swimming pool", "pool"),
    "storage_room": ("trastero", "storage room"),
    "outdoor_space": ("area exterior", "outdoor space"),
    "bed_linen_towels": ("sabanas y toallas", "bed linen", "towels"),
}


def description_amenities(description: str) -> list[str]:
    """Only parse amenity lines in a clearly labelled Features section."""
    match = re.search(
        r"(?im)^\s*(?:caracter[ií]sticas|features)\s*$([\s\S]*?)(?=^\s*(?:sobre\s+|about\s+|condiciones|terms)\b|\Z)",
        description,
    )
    if not match:
        return []
    return [m.group(1).strip() for m in re.finditer(r"(?m)^\s*-\s+(.+?)\s*$", match.group(1))]


def amenities_data(v2: dict[str, Any], old: dict[str, Any], feats: dict[str, Any], description: str) -> dict[str, Any]:
    raw_names = [
        *(v2.get("extraFeatures") or []),
        *(old.get("extras") or []),
        *description_amenities(description),
    ]
    raw_names = list(dict.fromkeys(str(x).strip() for x in raw_names if str(x).strip()))
    normalized = [norm(x) for x in raw_names]
    amenities: dict[str, bool | None] = {}
    for name, aliases in AMENITY_ALIASES.items():
        amenities[name] = True if any(any(alias in item for alias in aliases) for item in normalized) else None
    # Explicit YES/NO beats mere presence in an advertisement's free-text features.
    for name, key in (("furnished", "FURNISHED"), ("elevator", "ELEVATOR")):
        flag = as_bool(feats.get(key))
        if flag is not None:
            amenities[name] = flag
    return {"flags": amenities, "labels": raw_names}


def rental_terms(description: str, v2: dict[str, Any], old: dict[str, Any]) -> dict[str, Any]:
    def capture(pattern: str) -> str | None:
        m = re.search(pattern, description, flags=re.IGNORECASE)
        return m.group(1).strip() if m else None

    duration = re.search(
        r"(?:duraci[oó]n m[ií]nima del alquiler|minimum rental duration)\s*:\s*(\d+)\s*(d[ií]as|days|meses|months)",
        description, re.IGNORECASE,
    )
    min_days = None
    duration_info = None
    if duration:
        quantity = int(duration.group(1))
        unit = "days" if norm(duration.group(2)) in {"dias", "days"} else "months"
        duration_info = {"value": quantity, "unit": unit}
        if unit == "days":
            min_days = quantity

    pets = capture(r"(?:mascotas|pets)\s*[:\-]?\s*(no permitido|permitido|yes|no|s[ií])\b")
    smoking = capture(r"(?:fumar|smoking)\s*[:\-]?\s*(no permitido|permitido|yes|no|s[ií])\b")
    bills = capture(r"(?:todas las facturas incluidas|all bills included)\s*:\s*(s[ií]|no|yes)\b")
    available = capture(r"(?:fecha de disponibilidad|availability date)\s*:\s*([^\n]+)")
    available_now = bool(re.search(r"disponible ahora|available now", available, re.I)) if available else None
    f = typed_features(v2, old)
    status = f.get("OCCUPANCY_STATUS")
    rental_duration = f.get("RENTAL_DURATION")
    temporary_flag = (rental_duration == "IS_TEMPORARY") if rental_duration in {"IS_TEMPORARY", "IS_PERMANENT"} else None

    return {
        "is_temporary": first(v2.get("isTemporaryRental"), old.get("isTemporaryRental"), temporary_flag),
        "min_duration": duration_info,
        "min_duration_days": min_days,
        "max_occupants": as_number(capture(r"(?:m[aá]ximo de hu[eé]spedes|maximum guests)\s*:\s*(\d+)")),
        "available_from_text": available,
        "available_now": available_now,
        "bills_included": as_bool(bills),
        "pets_allowed": as_bool(pets),
        "smoking_allowed": as_bool(smoking),
        "occupancy_status": status,
    }


def normalized_listing(props: dict[str, Any], page: FotocasaHTMLParser, source: Path, include_raw: bool) -> dict[str, Any]:
    v2: dict[str, Any] = props.get("realEstateAdDetailEntityV2") or {}
    old: dict[str, Any] = props.get("realEstate") or {}
    if not v2 and not old:
        raise ValueError("Found initial props, but no realEstate property objects")

    feats = typed_features(v2, old)
    old_feats = old.get("features") or {}
    a2 = v2.get("address") or {}
    a1 = old.get("address") or {}
    coordinates = first(a2.get("coordinates"), old.get("coordinates")) or {}
    p2 = v2.get("price") or {}
    amount = as_number(first(p2.get("amount"), old.get("price")))
    surface = positive_number(first(old_feats.get("surface"), v2.get("groundSurface")))
    desc = first(v2.get("description"), at(old, "descriptions", "es-ES"), page.meta.get("description"), "")
    url = first(page.canonical, page.meta.get("og:url"))
    if not url:
        uris = v2.get("uris") or []
        preferred = next((x.get("value") for x in uris if x.get("language") == "en_US"), None)
        url = first(preferred, at(old, "detail", "en-GB"))
    url = urljoin(BASE_URL, url) if url else None
    listing_id = as_number(first(v2.get("propertyId"), old.get("id")))
    if listing_id is None and url:
        m = re.search(r"/(\d+)/d(?:[/?#]|$)", url)
        listing_id = int(m.group(1)) if m else None

    publisher = v2.get("publisher") or {}
    agency = v2.get("agency") or {}
    media = v2.get("multimedias") or old.get("multimedia") or []
    pictures = [first(m.get("url"), m.get("src")) for m in media if m.get("type") == "image"]
    videos = [first(m.get("url"), m.get("src")) for m in media if m.get("type") != "image"]
    pictures = list(dict.fromkeys(x for x in pictures if x))
    videos = list(dict.fromkeys(x for x in videos if x))

    e2 = v2.get("energyCertificate") or {}
    ef = feats.get("ENERGY") or {}
    em = feats.get("EMISSIONS") or {}
    rent_index = v2.get("rentReferenceIndex") or {}

    out: dict[str, Any] = {
        "source": {
            "portal": "fotocasa",
            "html_file": str(source),
            "url": url,
            "language": first(page.lang, props.get("browserLanguage")),
        },
        "listing": {
            "id": listing_id,
            "composite_id": v2.get("id"),
            "ad_uuid": first(v2.get("realEstateAdId"), old.get("realEstateAdId")),
            "reference": first(publisher.get("reference"), old.get("reference")),
            "title": first(props.get("seoTitle"), page.meta.get("og:title"),
                           " ".join(page.title_chunks).strip()),
            "description": desc,
            "description_translations": old.get("descriptions") or {},
            "created_at": v2.get("creationDate"),
            "transaction": "rent" if "/rental/" in (url or "") or "/alquiler/" in (url or "") else None,
            "construction_type": v2.get("constructionType"),
            "is_new": old.get("isNew"),
            "is_new_construction": old.get("isNewConstruction"),
            "is_premium": old.get("isPremium"),
            "is_auctioned": v2.get("isAuctioned"),
            "is_occupied": v2.get("isOccupied"),
            "is_rented_with_tenants": v2.get("isRentedWithTenants"),
            "is_bare_ownership": v2.get("isBareOwnership"),
        },
        "pricing": {
            "amount": amount,
            "currency": "EUR",
            "period": "month" if p2.get("periodicity") == 3 or old.get("periodicityId") == 3 else None,
            "price_per_m2": round(amount / surface, 2) if amount is not None and surface else None,
            "previous_price": as_number(old.get("reducedPrice")),
            "price_drop": as_number(p2.get("amountDrop")),
            "rent_reference_index": positive_number(rent_index.get("rentPriceIndex")),
            "last_rent": positive_number(rent_index.get("lastRentPrice")),
        },
        "location": {
            "country": first(a2.get("country"), a1.get("country")),
            "autonomous_community": first(a2.get("autonomousCommunity"), a1.get("regionLevel1")),
            "province": first(a2.get("province"), a1.get("province")),
            "municipality": (first(a1.get("municipality"), a2.get("locality")) or "").strip() or None,
            "district": first(a1.get("district"), a2.get("district")),
            "neighborhood": first(a2.get("neighborhood"), a1.get("neighborhood")),
            "postal_code": first(a2.get("zipCode"), a1.get("zipCode")),
            "street_name": at(a2, "street", "name"),
            "street_number": positive_number(at(a2, "street", "number")),
            "latitude": as_number(first(coordinates.get("lat"), coordinates.get("latitude"))),
            "longitude": as_number(first(coordinates.get("lng"), coordinates.get("longitude"))),
            "coordinates_exact": a2.get("isExact"),
            "combined_location_id": first(a2.get("combinedLocationId"), a1.get("combinedLocationId")),
            "location_ids": a2.get("locationIds") or {},
        },
        "property": {
            "typology": first(feats.get("TYPOLOGY"), old.get("buildingSubtype")),
            "building_type": old.get("buildingType"),
            "rooms": as_number(old_feats.get("rooms")),
            "bathrooms": as_number(old_feats.get("bathrooms")),
            "surface_m2": surface,
            "land_surface_m2": positive_number(first(old_feats.get("surfaceLand"), v2.get("groundSurface"))),
            "floor": positive_number(old_feats.get("floor")),
            "orientation_code": positive_number(old_feats.get("orientation")),
            "construction_age_code": positive_number(old_feats.get("antiquity")),
            "condition_code": positive_number(old_feats.get("conservationState")),
        },
        "amenities": amenities_data(v2, old, feats, desc),
        "rental_terms": rental_terms(desc, v2, old),
        "energy": {
            "rating": first(e2.get("energyEfficiencyRatingType"), at(ef, "letter"), old.get("energyCertificate")),
            "emissions_rating": first(e2.get("environmentImpactRatingType"), at(em, "letter")),
            "certificate_type": e2.get("energyPerformanceCertificateType"),
            "energy_value": positive_number(e2.get("energyEfficiency")) if e2.get("energyEfficiency") != 999 else None,
            "emissions_value": positive_number(e2.get("environmentImpact")) if e2.get("environmentImpact") != 999 else None,
        },
        "media": {"images": pictures, "videos": videos,
                  "image_count": len(pictures), "video_count": len(videos)},
        "agency": {
            "id": first(publisher.get("id"), agency.get("id"), old.get("clientId")),
            "name": first(publisher.get("name"), agency.get("name"), old.get("clientName")),
            "publisher_type": publisher.get("type"),
            "phone": first(publisher.get("phone"), old.get("phone")),
            "email": first(old.get("clientContactEmail"), old.get("clientEmail")),
            "website": first(agency.get("web"), old.get("clientUrl")),
            "profile_url": urljoin(BASE_URL, publisher["url"]) if publisher.get("url") else None,
            "logo": first(publisher.get("logo"), agency.get("logo")),
        },
    }
    if include_raw:
        out["raw"] = {"real_estate_v2": v2, "real_estate_legacy": old}
    return out


def parse_file(path: Path, include_raw: bool = True) -> dict[str, Any]:
    page = FotocasaHTMLParser()
    page.feed(path.read_text(encoding="utf-8", errors="replace"))
    if not page.props_chunks:
        raise ValueError("Missing <script id='__initial_props__'> (incomplete/blocked/non-detail HTML?)")
    props = json.loads("".join(page.props_chunks))
    if not isinstance(props, dict):
        raise ValueError("__initial_props__ is not a JSON object")
    return normalized_listing(props, page, path, include_raw)


def main() -> int:
    base_dir = Path(__file__).resolve().parent

    input_dir = Path("/Users/mohamedkhachaniupm/civic/tools/scraper/fotocasa_output/source1/")
    output_dir = base_dir / "fotocasa_json"

    if not input_dir.is_dir():
        print(f"[ERROR] Folder not found: {input_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    paths = sorted(
        p for p in input_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in {".html", ".htm"}
    )

    print(f"Found {len(paths)} HTML files")

    success = 0
    failed = 0

    for i, path in enumerate(paths, start=1):
        try:
            data = parse_file(path, include_raw=True)

            relative_path = path.relative_to(input_dir)
            output_path = output_dir / relative_path.with_suffix(".json")

            output_path.parent.mkdir(parents=True, exist_ok=True)

            output_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8"
            )

            success += 1
            print(f"[{i}/{len(paths)}] [OK] {path.name}")

        except Exception as exc:
            failed += 1
            print(f"[{i}/{len(paths)}] [ERROR] {path.name}: {exc}")

    print("\nProcessing completed")
    print(f"Total:   {len(paths)}")
    print(f"Success: {success}")
    print(f"Failed:  {failed}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
