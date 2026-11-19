#!/usr/bin/env python3
"""Extract structured, typed property metadata from saved pisos.com listing HTML.

Usage:
    python pisos_html_to_json.py listing.html
    python pisos_html_to_json.py listing.html --output listing.json
    python pisos_html_to_json.py ./html_pages/ --output ./json_pages/

Dependency: pip install beautifulsoup4
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urljoin

from bs4 import BeautifulSoup


NUMBER_RE = re.compile(r"[-+]?\d[\d.,]*")

# Canonical feature names used by the scoring/database layer.
FIELD_ALIASES = {
    "superficie construida": "built_area_sqm",
    "superficie util": "usable_area_sqm",
    "superficie": "area_sqm",
    "referencia": "reference",
    "habitaciones": "bedrooms",
    "habitacion": "bedrooms",
    "dormitorios": "bedrooms",
    "dormitorio": "bedrooms",
    "numero de habitaciones": "bedrooms",
    "numero de dormitorios": "bedrooms",
    "banos": "bathrooms",
    "bano": "bathrooms",
    "numero de banos": "bathrooms",
    "cuartos de bano": "bathrooms",
    "aseos": "toilets",
    "planta": "floor",
    "altura": "floor",
    "antiguedad": "age",
    "ano de construccion": "year_built",
    "orientacion": "orientation",
    "estado de conservacion": "condition",
}

# Match *only* explicit HTML features. Absence remains null (unknown), not false.
BOOLEAN_ALIASES = {
    "furnished": ["amueblado", "amueblada", "con muebles", "sin amueblar", "sin muebles", "no amueblado"],
    "air_conditioning": ["aire acondicionado", "climatizacion"],
    "elevator": ["ascensor"],
    "parking": ["plaza de garaje", "garaje", "parking", "aparcamiento"],
    "terrace": ["terraza"],
    "balcony": ["balcon"],
    "swimming_pool": ["piscina"],
    "garden": ["jardin"],
    "heating": ["calefaccion"],
    "storage_room": ["trastero"],
    "exterior": ["exterior", "interior"],
    "accessible": ["accesible", "adaptado", "movilidad reducida"],
    "pets_allowed": ["mascotas", "animales de compania"],
    "security": ["vigilancia", "seguridad"],
}

NEGATIVE_PREFIX_RE = re.compile(r"^(sin|no|ningun[ao]?|carece de)\b")


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return clean(re.sub(r"[^a-z0-9]+", " ", text.casefold()))


def slug(text: str) -> str:
    return normalize(text).replace(" ", "_")


def number(value: str | None) -> int | float | None:
    if not value:
        return None
    match = NUMBER_RE.search(value)
    if not match:
        return None
    value = match.group().rstrip(".,")
    if not value:
        return None

    # 1.250,50 -> 1250.50, 1,250.50 -> 1250.50
    if "." in value and "," in value:
        decimal = "." if value.rfind(".") > value.rfind(",") else ","
        thousand = "," if decimal == "." else "."
        value = value.replace(thousand, "").replace(decimal, ".")
    elif "." in value or "," in value:
        sep = "," if "," in value else "."
        chunks = value.split(sep)
        if (len(chunks) > 2 and all(len(c) == 3 for c in chunks[1:])) or (
            len(chunks) == 2 and len(chunks[1]) == 3
        ):
            value = "".join(chunks)
        elif len(chunks) > 2:
            value = "".join(chunks[:-1]) + "." + chunks[-1]
        else:
            value = value.replace(sep, ".")
    try:
        result = float(value)
        return int(result) if result.is_integer() else result
    except ValueError:
        return None


def typed_value(text: str | None, *, bare_flag: bool = False):
    """Convert literal boolean/numeric values while preserving strings & IDs."""
    if text is None or not clean(text):
        return True if bare_flag else None
    value = clean(text)
    canonical = normalize(value)
    if canonical in {"true", "verdadero", "si", "yes", "yes true"}:
        return True
    if canonical in {"false", "falso", "no"}:
        return False
    if re.fullmatch(r"[-+]?\d[\d.,]*", value):
        return number(value)
    if re.fullmatch(r"[-+]?\d[\d.,]*\s*(?:m2|m²|€|eur|euros?|anos?|años?|hab(?:itaciones)?\.?|banos?|baños?)", value, re.I):
        return number(value)
    return value


def first_text(soup: BeautifulSoup, selector: str) -> str | None:
    el = soup.select_one(selector)
    return clean(el.get_text(" ", strip=True)) or None if el else None


def first_attr(soup: BeautifulSoup, selector: str, attribute: str) -> str | None:
    el = soup.select_one(selector)
    return el.get(attribute) if el else None


def feature_boolean(label: str, value: str | None):
    name = normalize(label)
    for key, phrases in BOOLEAN_ALIASES.items():
        if any(phrase in name for phrase in phrases):
            if value:
                converted = typed_value(value)
                if isinstance(converted, bool):
                    return key, converted
            negative = bool(NEGATIVE_PREFIX_RE.search(name))
            if key == "furnished" and ("sin amueblar" in name or "sin muebles" in name):
                negative = True
            if key == "exterior" and name == "interior":
                negative = True
            if key == "pets_allowed" and any(s in name for s in ["no se admiten", "no permitidas", "prohibidas"]):
                negative = True
            return key, not negative
    return None, None


def parse_features(soup: BeautifulSoup):
    group_dict = {}
    feature_list = []
    flags = {key: None for key in BOOLEAN_ALIASES}
    facts = {key: None for key in set(FIELD_ALIASES.values())}

    for container in soup.select(".features-container .features"):
        group = "other"
        for child in container.children:
            if getattr(child, "name", None) == "h3":
                group = slug(child.get_text(" ", strip=True))
                group_dict.setdefault(group, {})
            elif getattr(child, "name", None) == "div" and "features__content" in child.get("class", []):
                for el in child.select(".features__feature"):
                    label = first_text(el, ".features__label")
                    if not label:
                        continue
                    value_text = first_text(el, ".features__value")
                    base_name = normalize(label.rstrip(":"))
                    canonical = FIELD_ALIASES.get(base_name)
                    boolean_name, boolean_val = feature_boolean(label, value_text)
                    key = canonical or boolean_name or slug(label.rstrip(":"))
                    if boolean_name:
                        value = boolean_val
                        flags[boolean_name] = boolean_val
                    elif canonical == "reference":
                        value = value_text  # IDs are always strings
                    else:
                        value = typed_value(value_text, bare_flag=value_text is None)
                    if canonical:
                        facts[canonical] = value
                    group_dict.setdefault(group, {})[key] = value
                    feature_list.append({
                        "group": group,
                        "label": label.rstrip(": "),
                        "key": key,
                        "value": value,
                    })

    return group_dict, feature_list, flags, facts


def parse_listing(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    detail = soup.select_one(".details[data-ad-id]")
    raw_id = (detail.get("data-ad-id") if detail else None) or first_attr(soup, "#hdnIdPiso", "value")
    if not raw_id:
        raise ValueError("This HTML does not look like a pisos.com property detail page")

    feature_groups, all_features, flags, facts = parse_features(soup)
    page_title = first_text(soup, "h1") or first_text(soup, "title")
    meta_title = first_attr(soup, 'meta[property="og:title"]', "content")
    page_url = first_attr(soup, 'link[rel="canonical"]', "href") or first_attr(soup, 'meta[property="og:url"]', "content")
    base_url = "https://www.pisos.com"

    # Extract transaction and type from visible listing heading, not promotional text.
    kind_match = re.match(r"^(.*?)\s+en\s+(alquiler|venta|traspaso)\b", page_title or "", re.I)
    property_type = clean(kind_match.group(1)).lower() if kind_match else None
    transaction = {"alquiler": "rent", "venta": "sale", "traspaso": "transfer"}.get(kind_match.group(2).lower()) if kind_match else None

    price_el = soup.select_one(".price__value.jsPriceValue, .price__value")
    price_display = clean(price_el.get_text(" ", strip=True)) if price_el else None
    price_value = number(detail.get("data-ad-price")) if detail and detail.has_attr("data-ad-price") else number(price_display)
    price_period = "month" if price_display and ("/mes" in price_display or "mes" in normalize(price_display)) else None
    price_per_sqm = None
    for el in soup.select(".features-summary__item"):
        content = clean(el.get_text(" ", strip=True))
        if "€/m" in content or "eur/m" in normalize(content):
            price_per_sqm = number(content)
            break
    currency = "EUR" if (price_display and "€" in price_display) or (meta_title and "€" in meta_title) else None

    # Visible location + explicit geo URL parameters.
    location_label = None
    title_el = soup.select_one(".details__col-right h1")
    if title_el:
        nxt = title_el.find_next_sibling("p")
        location_label = clean(nxt.get_text(" ", strip=True)) if nxt else None
    if not location_label:
        location_label = first_text(soup, ".details__col-right h1 + p")
    neighborhood = location_label.split("(", 1)[0].strip() if location_label else None
    district_match = re.search(r"Distrito\s+([^.)]+)", location_label or "", re.I)
    district = clean(district_match.group(1)) if district_match else None
    municipality_match = re.search(r"Distrito\s+[^.)]+\.\s*([^)]+)", location_label or "", re.I)
    municipality = clean(municipality_match.group(1)) if municipality_match else None

    geo_el = soup.select_one(".location[data-params]")
    geo_params = parse_qs(geo_el.get("data-params", "")) if geo_el else {}
    def param_num(name):
        values = geo_params.get(name)
        return number(values[0]) if values else None
    lat, lon = param_num("latitude"), param_num("longitude")
    note = first_text(soup, ".location__ask-address > span")
    approximate = True if note and "aproximad" in normalize(note) else None

    # Description HTML uses <br> rather than separate paragraphs.
    description_el = soup.select_one(".description-block .description__content")
    description = None
    if description_el:
        lines = [clean(line) for line in description_el.get_text("\n", strip=True).splitlines()]
        description = "\n".join(line for line in lines if line) or None

    # Site-specific, machine-readable metadata (may contain defaults such as 0 bedrooms).
    extra_attr = first_attr(soup, "#vtmExtraVars", "data-var")
    try:
        extra = json.loads(extra_attr) if extra_attr else {}
    except (ValueError, TypeError):
        extra = {}

    def parse_spanish_date(value):
        match = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", value or "")
        return datetime.strptime(match.group(1), "%d/%m/%Y").date().isoformat() if match else None

    # Photos in the initial HTML include lazy-loading data-src URLs.
    images = []
    seen_photo_ids = set()
    og_image = first_attr(soup, 'meta[property="og:image"]', "content")
    candidates = ([og_image] if og_image else [])
    candidates.extend((img.get("src") or img.get("data-src")) for img in soup.select(".masonry__item:not(.masonry__item--contact) img"))
    candidates.extend(el.get("data-bg") for el in soup.select(".carousel__slide [data-bg]"))
    candidates.extend(img.get("src") for img in soup.select(".carousel__slide img[src]"))
    for url in candidates:
        if not url:
            continue
        photo_id = url.split("?", 1)[0].rsplit("/", 1)[-1]
        if photo_id not in seen_photo_ids:
            seen_photo_ids.add(photo_id)
            images.append(urljoin(base_url, url))
    advertised_photos = number(first_text(soup, ".media-types-menu__button--photos .media-types-menu__number"))

    # Energy and update date, stored with machine-readable representations.
    energy_text = first_text(soup, ".energy-certificate > p")
    energy_classification = clean(energy_text.split(":", 1)[-1]) if energy_text else None
    energy_rating = energy_classification.upper() if energy_classification and re.fullmatch(r"[A-G]", energy_classification, re.I) else None
    energy_status = "pending" if energy_classification and "tramite" in normalize(energy_classification) else ("rated" if energy_rating else None)
    updated_text = first_text(soup, ".last-update__date")
    updated_at = parse_spanish_date(updated_text) or parse_spanish_date(extra.get("fechaModificacion"))
    published_at = parse_spanish_date(extra.get("fechaPrimeraPublicacion"))

    owner_name = first_text(soup, ".owner-info__name")
    landlord_text = first_text(soup, ".owner-large-landlord__text")
    landlord_norm = normalize(landlord_text or "")
    large_landlord = None
    if "no indica" not in landlord_norm:
        if "gran tenedor" in landlord_norm:
            large_landlord = True
        elif "pequeno tenedor" in landlord_norm:
            large_landlord = False

    hdn = lambda id: first_attr(soup, f"#{id}", "value")
    listing = {
        "source": "pisos.com",
        "listing_id": raw_id,  # Do not convert IDs into floats.
        "url": page_url,
        "title": page_title,
        "seo_title": meta_title,
        "description": description or first_attr(soup, 'meta[name="description"]', "content"),
        "transaction": transaction,
        "property_type": property_type,
        "price": {
            "amount": price_value,
            "currency": currency,
            "period": price_period,
            "per_sqm": price_per_sqm,
            "display": price_display,
        },
        "area": {
            "built_sqm": facts.get("built_area_sqm"),
            "usable_sqm": facts.get("usable_area_sqm"),
            "other_sqm": facts.get("area_sqm"),
        },
        "rooms": {
            "bedrooms": facts.get("bedrooms"),
            "bathrooms": facts.get("bathrooms"),
            "toilets": facts.get("toilets"),
        },
        "building": {
            "floor": facts.get("floor"),
            "year_built": facts.get("year_built"),
            "age": facts.get("age"),
            "orientation": facts.get("orientation"),
            "condition": facts.get("condition"),
        },
        "location": {
            "label": location_label,
            "neighborhood": neighborhood,
            "district": district,
            "municipality": municipality,
            "latitude": lat,
            "longitude": lon,
            "approximate": approximate,
            "note": note,
        },
        "amenities": flags,
        "features": feature_groups,
        "all_features": all_features,
        "reference": facts.get("reference"),
        "media": {
            "advertised_photo_count": advertised_photos,
            "extracted_photo_count": len(images),
            "photos": images,
            "photo_ids": [el.get("data-id") for el in soup.select(".masonry__item[data-id]")],
        },
        "energy": {
            "classification": energy_classification,
            "rating": energy_rating,
            "status": energy_status,
        },
        "advertiser": {
            "name": owner_name,
            "advertiser_id": hdn("hdnAdvertiserId"),
            "phone": extra.get("telefono") or None,
            "large_landlord": large_landlord,
            "large_landlord_text": landlord_text,
        },
        "external_listing_url": first_attr(soup, 'a.u-external-link[href]', "href"),
        "published_at": published_at,
        "updated_at": updated_at,
        "platform_metadata": {
            "origin": hdn("hdnOrigin"),
            "is_new_development": typed_value(detail.get("data-is-newdevelopment")) if detail else None,
            "is_aggregator": typed_value(hdn("hdnIsAggregator")),
            "is_typology": typed_value(hdn("hdnIsTipology")),
            "total_zone_ads": typed_value(hdn("hdnTotalAds")),
            "embedded_room_counts": {
                "bedrooms": typed_value(extra.get("nHabitaciones")),
                "bathrooms": typed_value(extra.get("nBanios")),
            },
            "embedded_area_sqm": typed_value(extra.get("superficieInmueble")),
            "other_embedded_values": {
                key: typed_value(value) for key, value in extra.items()
                if key not in {"nHabitaciones", "nBanios", "superficieInmueble", "telefono", "fechaModificacion", "fechaPrimeraPublicacion"}
            },
        },
    }
    return listing


def main():
    parser = argparse.ArgumentParser(description="Parse pisos.com HTML into clean, typed JSON")
    parser.add_argument("input", type=Path, help="HTML file OR folder containing HTML files")
    parser.add_argument("-o", "--output", type=Path, help="Output JSON file OR folder")
    args = parser.parse_args()

    if not args.input.exists():
        parser.error(f"Input not found: {args.input}")
    paths = sorted(p for p in args.input.rglob("*") if p.suffix.lower() in {".html", ".htm"}) if args.input.is_dir() else [args.input]
    if not paths:
        parser.error("No .html or .htm files found")
    if args.input.is_dir() and args.output and args.output.suffix.lower() == ".json":
        parser.error("When input is a folder, --output must be an output folder")

    success = 0
    for path in paths:
        try:
            data = parse_listing(path.read_text(encoding="utf-8-sig", errors="replace"))
            if args.input.is_dir():
                rel = path.relative_to(args.input).with_suffix(".json")
                output = (args.output or (args.input / "json")) / rel
            else:
                output = args.output or path.with_suffix(".json")
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"[OK] {path} -> {output} | price={data['price']['amount']} | features={len(data['all_features'])}")
            success += 1
        except Exception as exc:
            print(f"[ERROR] {path}: {exc}")
    print(f"Done: {success}/{len(paths)} HTML files converted")
    if success != len(paths):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
