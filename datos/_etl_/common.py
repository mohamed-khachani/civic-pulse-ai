"""Shared path handling, CSV/XLSX readers, numeric coercion and spatial helpers."""
from __future__ import annotations

import csv
import json
import math
import re
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Iterator
from xml.etree import ElementTree as ET

from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform
from shapely.strtree import STRtree

WGS84_TO_UTM = Transformer.from_crs('EPSG:4326', 'EPSG:25830', always_xy=True).transform
UTM_TO_WGS84 = Transformer.from_crs('EPSG:25830', 'EPSG:4326', always_xy=True).transform
XMLNS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def read_config(filename: str | Path) -> dict:
    file = Path(filename).expanduser().resolve()
    cfg = json.loads(file.read_text(encoding='utf-8'))
    cfg['_file'] = str(file)
    cfg['_base'] = str(file.parent)
    return cfg


def source(cfg: dict, key: str, required: bool = False) -> Path | None:
    value = cfg.get('files', {}).get(key)
    if not value:
        if required:
            raise FileNotFoundError(f'Missing required files.{key} in {cfg["_file"]}')
        return None
    p = Path(value).expanduser()
    p = (Path(cfg['_base']) / p).resolve() if not p.is_absolute() else p.resolve()
    if not p.is_file():
        if required:
            raise FileNotFoundError(f'files.{key}: {p} does not exist')
        print(f'[SKIP] Optional files.{key} not found: {p}')
        return None
    return p


def output_path(cfg: dict) -> Path:
    p = Path(cfg.get('output_dir', 'output')).expanduser()
    p = (Path(cfg['_base']) / p).resolve() if not p.is_absolute() else p
    p.mkdir(parents=True, exist_ok=True)
    return p


def as_number(value):
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else None
    if value is None:
        return None
    text = str(value).strip().replace('\u00a0', '').replace(' ', '')
    if text in ('', '..', '-', 'N/D', 'N.D.', 'nan', 'None', 'null', 's.d.'):
        return None
    text = text.replace('€', '').replace('%', '')
    if ',' in text and '.' in text:
        if text.rfind(',') > text.rfind('.'):
            text = text.replace('.', '').replace(',', '.')
        else:
            text = text.replace(',', '')
    elif ',' in text:
        text = text.replace(',', '.')
    try:
        result = float(text)
        return result if math.isfinite(result) else None
    except ValueError:
        return None


def as_int(value):
    n = as_number(value)
    return int(n) if n is not None else None


def normalized(value: str) -> str:
    s = unicodedata.normalize('NFKD', str(value or ''))
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


def section_code(district, section=None) -> str | None:
    if section is None:
        digits = re.sub(r'\D', '', str(district or ''))
        return digits.zfill(5) if digits and len(digits) <= 5 else None
    d = as_int(district)
    s = as_int(section)
    return f'{d:02d}{s:03d}' if d is not None and s is not None and 1 <= d <= 21 and s >= 0 else None


def district_code(value) -> str | None:
    i = as_int(value)
    return f'{i:02d}' if i is not None and 1 <= i <= 21 else None


def barrio_code(district, barrio) -> str | None:
    d, b = as_int(district), as_int(barrio)
    return f'{d:02d}{b}' if d is not None and b is not None and 1 <= d <= 21 else None


def iter_csv(file: Path) -> Iterator[dict[str, str]]:
    """Stream Madrid CSV files (UTF-8 or CP1252; comma/semicolon dialect)."""
    with file.open('rb') as binary:
        head = binary.read(8192)
    encoding = 'utf-8-sig'
    try:
        head.decode(encoding)
    except UnicodeDecodeError:
        encoding = 'cp1252'
    sample = head.decode(encoding, errors='replace')
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t')
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ';' if sample.splitlines()[0].count(';') > sample.splitlines()[0].count(',') else ','
    # Sniffer can mistake embedded punctuation. Delimiters are unquoted in source headers.
    header_line = sample.splitlines()[0]
    if header_line.count(';') >= 2 and header_line.count(';') > header_line.count(','):
        delimiter = ';'
    with file.open('r', encoding=encoding, newline='', errors='replace') as fh:
        yield from csv.DictReader(fh, delimiter=delimiter)


def iter_xlsx(file: Path, sheet: int = 0) -> Iterator[dict[str, str]]:
    """Read .xlsx in streaming mode using Python standard library (cell letters -> text).

    Formula cells without cached values are blank; our supplied data workbooks are cached.
    """
    with zipfile.ZipFile(file) as archive:
        strings: list[str] = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            with archive.open('xl/sharedStrings.xml') as fh:
                for _, elem in ET.iterparse(fh, events=('end',)):
                    if elem.tag == XMLNS + 'si':
                        strings.append(''.join((t.text or '') for t in elem.iter(XMLNS + 't')))
                        elem.clear()
        sheets = sorted((name for name in archive.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', name)),
                        key=lambda x: int(re.search(r'sheet(\d+)\.xml', x).group(1)))
        if sheet >= len(sheets):
            return
        with archive.open(sheets[sheet]) as fh:
            for _, elem in ET.iterparse(fh, events=('end',)):
                if elem.tag != XMLNS + 'row':
                    continue
                result = {'_row': str(elem.get('r', ''))}
                for cell in elem.findall(XMLNS + 'c'):
                    reference = cell.get('r', '')
                    col = re.sub(r'\d', '', reference)
                    v = cell.find(XMLNS + 'v')
                    value = v.text if v is not None and v.text is not None else ''
                    typ = cell.get('t')
                    if typ == 's' and value:
                        value = strings[int(value)]
                    elif typ == 'inlineStr':
                        value = ''.join((t.text or '') for t in cell.iter(XMLNS + 't'))
                    if value != '':
                        result[col] = value
                elem.clear()
                yield result


def write_csv(file: Path, records: list[dict], fields: list[str]):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        for record in records:
            writer.writerow({k: scalar(record.get(k)) for k in fields})


def scalar(v):
    if v is None or isinstance(v, float) and not math.isfinite(v):
        return ''
    if isinstance(v, float):
        return round(v, 5)
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return v


def add(row: dict, name: str, value):
    if value is not None:
        row[name] = value


def point_of(row: dict):
    """Accept official Madrid field aliases in both cases and coordinate systems."""
    fields = {normalized(k): v for k, v in row.items() if isinstance(k, str)}

    def first(*keys):
        for key in keys:
            val = fields.get(normalized(key))
            if val is not None and str(val).strip():
                return as_number(val)
        return None

    lat = first('LATITUD', 'latitude', 'lat', 'LATITUD_ETRS89')
    lon = first('LONGITUD', 'longitude', 'lon', 'LONGITUD_ETRS89')
    if lat is not None and lon is not None and 40.0 < lat < 40.8 and -4.3 < lon < -3.2:
        return Point(lon, lat)
    x = first('COORDENADA-X', 'coordenada_x_utm', 'x_utm', 'utm_x')
    y = first('COORDENADA-Y', 'coordenada_y_utm', 'y_utm', 'utm_y')
    if x is not None and y is not None and 350000 < x < 550000 and 4400000 < y < 4550000:
        return Point(*UTM_TO_WGS84(x, y))
    return None


class CensusIndex:
    """Reusable spatial index; all buffer/distances use metric EPSG:25830."""
    def __init__(self, features: list[dict]):
        self.features = features
        self.codes = [f['properties']['section_code'] for f in features]
        self.polygons_wgs = [shape(f['geometry']) for f in features]
        self.polygons = [transform(WGS84_TO_UTM, g) for g in self.polygons_wgs]
        self.tree = STRtree(self.polygons)
        self.by_code = {code: j for j, code in enumerate(self.codes)}
        self.centroids = [g.representative_point() for g in self.polygons]

    def locate_utm(self, x, y) -> str | None:
        p = Point(x, y)
        for i in self.tree.query(p):
            if self.polygons[int(i)].covers(p):
                return self.codes[int(i)]
        return None

    def locate(self, lon, lat) -> str | None:
        return self.locate_utm(*WGS84_TO_UTM(lon, lat))

    def for_point(self, point: Point) -> str | None:
        return self.locate(point.x, point.y)


class PointIndex:
    def __init__(self, points: list[Point]):
        self.points = [transform(WGS84_TO_UTM, p) for p in points]
        self.tree = STRtree(self.points) if self.points else None

    def count_within(self, point, radius: float) -> int | None:
        if self.tree is None:
            return None
        return sum(self.points[int(i)].distance(point) <= radius for i in self.tree.query(point.buffer(radius)))

    def nearest(self, point) -> tuple[int, float] | None:
        if self.tree is None:
            return None
        i = int(self.tree.nearest(point))
        return i, point.distance(self.points[i])
