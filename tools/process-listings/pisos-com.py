#!/usr/bin/env python3
"""Extrae anuncios de pisos.com desde archivos HTML locales."""
import argparse
import csv
import html
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

BASE = 'https://www.pisos.com'
FIELDS = [
    'id', 'url', 'operacion', 'titulo', 'precio_eur', 'precio_texto',
    'ubicacion', 'habitaciones', 'banos', 'superficie_m2', 'planta',
    'descripcion', 'latitud', 'longitud', 'imagen_principal',
    'numero_fotos', 'agencia', 'agencia_url', 'telefono', 'tipo_inmueble',
    'caracteristicas', 'etiquetas', 'archivo_origen',
]


def text(node):
    return node.get_text(' ', strip=True) if node else ''


def normalize_description(value):
    """Normaliza descripciones sin perder acentos ni puntuación."""
    value = html.unescape(str(value or ''))
    value = unicodedata.normalize('NFKC', value)
    value = ''.join(' ' if unicodedata.category(c)[0] == 'C' else c for c in value)
    return re.sub(r'\s+', ' ', value).strip()


def number(value):
    """Convierte números españoles: 1.250,50 -> 1250.50."""
    if not value:
        return None
    match = re.search(r'\d[\d.,]*', str(value))
    if not match:
        return None
    value = match.group().rstrip('.,')
    if ',' in value:
        value = value.replace('.', '').replace(',', '.')
    elif '.' in value:
        parts = value.split('.')
        if len(parts) > 1 and all(len(p) == 3 for p in parts[1:]):
            value = value.replace('.', '')
    try:
        return float(value)
    except ValueError:
        return None


def integer(value):
    n = number(value)
    return int(n) if n is not None else ''


def json_ld(card):
    for script in card.select('script[type="application/ld+json"]'):
        try:
            obj = json.loads(html.unescape(script.string or script.get_text()))
            if isinstance(obj, dict):
                return obj
        except (ValueError, TypeError):
            pass
    return {}


def extract(card, source):
    title_el = card.select_one('a.ad-preview__title[href]')
    ld = json_ld(card)
    href = (title_el.get('href') if title_el else None) or card.get('data-lnk-href') or ld.get('url', '')
    if not href:
        return None
    url = urljoin(BASE, href)
    parsed = urlparse(url)
    if parsed.netloc not in ('www.pisos.com', 'pisos.com') or not re.match(r'^/(comprar|alquilar)/', parsed.path):
        return None

    price_text = text(card.select_one('.ad-preview__price'))
    contact = card.select_one('.contact-box')
    price = number(contact.get('data-ad-price')) if contact and contact.get('data-ad-price') else number(price_text)
    chars = [text(el) for el in card.select('.ad-preview__char')]
    features = {'habitaciones': '', 'banos': '', 'superficie_m2': '', 'planta': ''}
    extras = []
    for char in chars:
        low = char.lower()
        if re.search(r'\b(hab\.?|habs\.?|habitacion(?:es)?|dormitorio(?:s)?)\b', low):
            features['habitaciones'] = integer(char)
        elif re.search(r'\b(baño|baños|aseo|aseos)\b', low):
            features['banos'] = integer(char)
        elif re.search(r'\b(m²|m2)\b', low):
            features['superficie_m2'] = number(char) or ''
        elif 'planta' in low or re.search(r'\b(bajo|ático|entresuelo)\b', low):
            features['planta'] = char
        else:
            extras.append(char)

    geo = ld.get('geo') or {}
    if not isinstance(geo, dict):
        geo = {}
    img = card.select_one('.carousel__main-photo img')
    image_url = (img.get('src') or img.get('data-src') or '') if img else ''
    if not image_url:
        image_url = ld.get('image', '')
    counter = card.select_one('.carousel__container[data-counter]')
    photos = integer(counter.get('data-counter')) if counter else ''
    agency = card.select_one('.ad-preview__logo [data-lnk-href], .ad-preview__logo a[href]')
    agency_href = (agency.get('data-lnk-href') or agency.get('href')) if agency else ''
    agency_img = card.select_one('.ad-preview__logo img')
    agency_name = (agency_img.get('alt', '') if agency_img else '')
    if agency_name.lower() in ('logo', 'logotipo'):
        agency_name = ''
    badge_nodes = card.select('[class*="product-badge"]')
    badges = [text(b) for b in badge_nodes if text(b)]
    phone = card.select_one('[data-number]')
    title = text(title_el) or html.unescape(str(ld.get('name', '')))
    return {
        'id': card.get('id') or ld.get('@id', ''),
        'url': url,
        'operacion': 'alquiler' if parsed.path.startswith('/alquilar/') else 'venta',
        'titulo': title,
        'precio_eur': price if price is not None else '',
        'precio_texto': price_text,
        'ubicacion': text(card.select_one('.ad-preview__subtitle')),
        **features,
        'descripcion': normalize_description(text(card.select_one('.ad-preview__description'))),
        'latitud': geo.get('latitude', ''),
        'longitud': geo.get('longitude', ''),
        'imagen_principal': urljoin(BASE, image_url) if image_url else '',
        'numero_fotos': photos,
        'agencia': agency_name,
        'agencia_url': urljoin(BASE, agency_href) if agency_href else '',
        'telefono': phone.get('data-number', '') if phone else '',
        'tipo_inmueble': title.split(' en ')[0] if ' en ' in title else '',
        'caracteristicas': ' | '.join(extras),
        'etiquetas': ' | '.join(badges),
        'archivo_origen': str(source),
    }


def main():
    parser = argparse.ArgumentParser(description='Extrae anuncios de HTML locales de pisos.com')
    parser.add_argument('carpeta', type=Path, help='Carpeta con archivos HTML')
    parser.add_argument('--output', type=Path, default=Path('resultados_pisos'), help='Carpeta de salida')
    parser.add_argument('--recursive', action='store_true', help='Buscar HTML en subcarpetas')
    args = parser.parse_args()
    if not args.carpeta.is_dir():
        parser.error(f'No existe la carpeta: {args.carpeta}')
    files = sorted(args.carpeta.rglob('*.html') if args.recursive else args.carpeta.glob('*.html'))
    files += sorted(args.carpeta.rglob('*.htm') if args.recursive else args.carpeta.glob('*.htm'))
    if not files:
        parser.error('No se encontraron archivos .html o .htm')
    found = {}
    for file in files:
        try:
            soup = BeautifulSoup(file.read_bytes(), 'html.parser')
            cards = soup.select('.ad-preview')
            added = 0
            for card in cards:
                item = extract(card, file.name)
                if item and item['url'] not in found:
                    found[item['url']] = item
                    added += 1
            print(f'{file.name}: {len(cards)} tarjetas, {added} anuncios nuevos')
        except Exception as exc:
            print(f'ERROR {file}: {exc}')
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'urls.txt').write_text(''.join(url + '\n' for url in found), encoding='utf-8')
    with (args.output / 'pisos.csv').open('w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(found.values())
    print(f'\nProcesados {len(files)} archivos. {len(found)} anuncios únicos.')
    print(f'URLs: {args.output / "urls.txt"}')
    print(f'CSV:  {args.output / "pisos.csv"}')


if __name__ == '__main__':
    main()
