
import argparse
import csv
import re
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup


BASE_URL = "https://www.fotocasa.es"

FIELDS = [
    "id",
    "url",
    "title",
    "price_eur_month",
    "price_reduction_eur",
    "rooms",
    "bathrooms",
    "area_m2",
    "floor",
    "location",
    "property_type",
    "agency",
    "description",
    "features",
    "tags",
    "published",
    "image_url",
    "image_urls",
    "source_file",
]


def clean(text):
    """Normaliza espacios sin perder el contenido."""
    return re.sub(r"\s+", " ", text or "").strip()


def get_text(element):
    if element is None:
        return ""
    return clean(element.get_text(" ", strip=True))


def get_number(text):
    """Convierte '2.300 €' en 2300."""
    if not text:
        return None

    match = re.search(r"\d[\d.,]*", text)

    if not match:
        return None

    value = match.group()

    # Separadores de miles españoles
    value = value.replace(".", "").replace(",", ".")

    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except ValueError:
        return None


def get_url(article):
    """Obtiene la URL principal del inmueble."""
    link = article.select_one(
        'h3 a[href], a[href*="/rental/home/"], '
        'a[href*="/alquiler/vivienda/"]'
    )

    if not link:
        return None

    href = link.get("href", "")

    if not href:
        return None

    url = urljoin(BASE_URL, href)
    parsed = urlsplit(url)

    # Eliminar query params y fragmentos
    return urlunsplit((
        parsed.scheme,
        parsed.netloc,
        parsed.path,
        "",
        ""
    ))


def get_id(url):
    """Extrae el ID numérico del anuncio."""
    if not url:
        return ""

    match = re.search(r"/(\d{7,})/d/?$", url)

    return match.group(1) if match else ""


def get_title(article):
    return get_text(article.select_one("h3"))


def get_price(article):
    """Extrae el precio de alquiler mensual."""
    # En el HTML proporcionado el precio está
    # en un span con la clase text-display-3.
    element = article.select_one('[class*="text-display-3"]')

    if element:
        text = get_text(element)

        match = re.search(
            r"([\d.,]+)\s*€\s*(?:/month|/mes)?",
            text,
            re.IGNORECASE
        )

        if match:
            return get_number(match.group(1))

    return None


def get_price_reduction(article):
    """Obtiene la reducción de precio si aparece."""
    element = article.select_one('[class*="text-success"]')

    if not element:
        return None

    return get_number(get_text(element))


def get_location(article):
    """Ubicación que aparece debajo del título."""
    h3 = article.select_one("h3")

    if not h3:
        return ""

    location = h3.find_next_sibling("p")

    return get_text(location)


def get_features(article):
    """Obtiene características del anuncio."""
    h3 = article.select_one("h3")

    if not h3:
        return []

    # En el HTML original las características
    # están en un UL después de la ubicación.
    parent = h3.parent

    ul = parent.find("ul", class_=lambda c: (
        c is not None and "text-body-1" in c
    ))

    if not ul:
        return []

    return [
        get_text(li).strip(" ·")
        for li in ul.find_all("li", recursive=False)
        if get_text(li)
    ]


def get_rooms(features):
    for feature in features:
        if re.search(
            r"\b(room|rooms|habitación|habitaciones|dormitorio|dormitorios)\b",
            feature,
            re.IGNORECASE
        ):
            return get_number(feature)

    return None


def get_bathrooms(features):
    for feature in features:
        if re.search(
            r"\b(bath|baths|baño|baños)\b",
            feature,
            re.IGNORECASE
        ):
            return get_number(feature)

    return None


def get_area(features):
    for feature in features:
        if re.search(r"m²|m2", feature, re.IGNORECASE):
            return get_number(feature)

    return None


def get_floor(features):
    for feature in features:
        if re.search(
            r"\b(floor|planta|piso|bajo|ground floor)\b",
            feature,
            re.IGNORECASE
        ):
            return feature

    return ""


def get_property_type(title):
    """Identifica el tipo de inmueble."""
    types = {
        "flat": "piso",
        "apartment": "apartamento",
        "studio": "estudio",
        "penthouse": "ático",
        "duplex": "dúplex",
        "house": "casa",
        "chalet": "chalet",
        "loft": "loft",
        "piso": "piso",
        "apartamento": "apartamento",
        "estudio": "estudio",
        "ático": "ático",
    }

    title = title.lower()

    for word, property_type in types.items():
        if re.search(rf"\b{re.escape(word)}\b", title):
            return property_type

    return ""


def get_agency(article):
    """Extrae el nombre de la inmobiliaria."""
    # Agencia destacada en la cabecera
    leader = article.select_one(
        'a[data-panot-component="link-box-link"]'
    )

    if leader:
        text = get_text(leader)

        if "Area leader" in text:
            return clean(text.replace("Area leader", "").strip(" ·"))

    # Alternativa: logo de la agencia
    img = article.select_one('img[alt^="Properties "]')

    if img:
        return img.get("alt", "").replace("Properties ", "").strip()

    return ""


def get_description(article):
    """Extrae la descripción del inmueble."""
    description = article.select_one(
        '[data-panot-component="collapsible-content"] p'
    )

    if description:
        return get_text(description)

    return ""


def get_tags(article):
    """Etiquetas como Short-term, New, etc."""
    tags = article.select('[data-panot-component="tag"]')

    return [
        get_text(tag)
        for tag in tags
        if get_text(tag)
    ]


def get_published(article):
    """Antigüedad de publicación si aparece."""
    for li in article.select("li"):
        text = get_text(li)

        if re.search(
            r"\b(days? ago|hours? ago|minutes? ago|"
            r"días?|horas?|minutos?)\b",
            text,
            re.IGNORECASE
        ):
            return text

    return ""


def get_images(article):
    """Obtiene todas las imágenes del inmueble."""
    images = []
    seen = set()

    carousel = article.select_one(
        '[data-e2e="product-card-multimedia-carousel"]'
    )

    if not carousel:
        return []

    for img in carousel.select("img[src]"):
        src = img.get("src", "")

        if not src or "/images/ads/" not in src:
            continue

        # Quitar parámetros de tamaño
        parsed = urlsplit(src)
        url = urlunsplit((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            "",
            ""
        ))

        if url not in seen:
            seen.add(url)
            images.append(url)

    return images


def parse_listing(article, source_file):
    """Convierte un artículo HTML en un registro."""
    url = get_url(article)

    if not url:
        return None

    listing_id = get_id(url)

    if not listing_id:
        return None

    title = get_title(article)
    features = get_features(article)
    images = get_images(article)

    return {
        "id": listing_id,
        "url": url,
        "title": title,
        "price_eur_month": get_price(article),
        "price_reduction_eur": get_price_reduction(article),
        "rooms": get_rooms(features),
        "bathrooms": get_bathrooms(features),
        "area_m2": get_area(features),
        "floor": get_floor(features),
        "location": get_location(article),
        "property_type": get_property_type(title),
        "agency": get_agency(article),
        "description": get_description(article),
        "features": " | ".join(features),
        "tags": " | ".join(get_tags(article)),
        "published": get_published(article),
        "image_url": images[0] if images else "",
        "image_urls": " | ".join(images),
        "source_file": source_file,
    }


def parse_html(file_path):
    """Procesa todos los anuncios de un HTML."""
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        soup = BeautifulSoup(f, "lxml")

    listings = []

    for article in soup.select("article"):
        listing = parse_listing(article, file_path.name)

        if listing:
            listings.append(listing)

    return listings


def merge_listings(old, new):
    """Combina registros duplicados conservando datos disponibles."""
    merged = old.copy()

    for key in FIELDS:
        if key in ("id", "url"):
            continue

        old_value = merged.get(key)
        new_value = new.get(key)

        if old_value in ("", None) and new_value not in ("", None):
            merged[key] = new_value

    return merged


def process_directory(input_dir, output_dir):
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)

    if not input_dir.is_dir():
        raise ValueError(f"No existe la carpeta: {input_dir}")

    output_dir.mkdir(parents=True, exist_ok=True)

    # Incluye subdirectorios
    html_files = sorted(
        file for file in input_dir.rglob("*")
        if file.is_file() and file.suffix.lower() in (".html", ".htm")
    )

    if not html_files:
        print("No se encontraron archivos HTML.")
        return

    print(f"Archivos HTML encontrados: {len(html_files)}")

    listings_by_id = {}

    for index, file_path in enumerate(html_files, 1):
        print(f"[{index}/{len(html_files)}] {file_path.name}")

        try:
            listings = parse_html(file_path)

            print(f"  Anuncios encontrados: {len(listings)}")

            for listing in listings:
                listing_id = listing["id"]

                if listing_id in listings_by_id:
                    listings_by_id[listing_id] = merge_listings(
                        listings_by_id[listing_id],
                        listing
                    )
                else:
                    listings_by_id[listing_id] = listing

        except Exception as e:
            print(f"  ERROR: {e}")

    results = list(listings_by_id.values())

    # 1. URLs
    urls_path = output_dir / "urls.txt"

    with open(urls_path, "w", encoding="utf-8") as f:
        for listing in results:
            f.write(listing["url"] + "\n")

    # 2. CSV
    csv_path = output_dir / "listings.csv"

    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(results)

    print()
    print("=" * 50)
    print("PROCESAMIENTO COMPLETADO")
    print("=" * 50)
    print(f"HTML procesados: {len(html_files)}")
    print(f"Anuncios únicos: {len(results)}")
    print(f"URLs: {urls_path}")
    print(f"CSV: {csv_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Extrae anuncios de Fotocasa desde HTML locales"
    )

    parser.add_argument(
        "input",
        help="Carpeta con archivos HTML"
    )

    parser.add_argument(
        "--output",
        default="./output",
        help="Carpeta de salida (por defecto ./output)"
    )

    args = parser.parse_args()

    process_directory(args.input, args.output)


if __name__ == "__main__":
    main()
