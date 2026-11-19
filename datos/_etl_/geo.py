"""Decode TopoJSON into GeoJSON census polygons and base section metadata."""
from __future__ import annotations
import json
from collections import Counter
from shapely.geometry import shape, mapping
from shapely.ops import transform
from common import source, district_code, section_code, WGS84_TO_UTM, iter_csv, as_number, barrio_code, CensusIndex, normalized


def _decode_arcs(topology):
    sx, sy = topology['transform']['scale']
    tx, ty = topology['transform']['translate']
    result = []
    for arc in topology['arcs']:
        x = y = 0
        coords = []
        for dx, dy in arc:
            x += dx
            y += dy
            coords.append([x * sx + tx, y * sy + ty])
        result.append(coords)
    return result


def _ring(ids, arcs):
    points = []
    for index in ids:
        arc = arcs[index] if index >= 0 else list(reversed(arcs[~index]))
        points.extend(arc if not points else arc[1:])
    if points and points[0] != points[-1]:
        points.append(points[0])
    return points


def _geometry(geom, arcs):
    typ = geom['type']
    if typ == 'Polygon':
        return {'type': 'Polygon', 'coordinates': [_ring(r, arcs) for r in geom['arcs']]}
    if typ == 'MultiPolygon':
        return {'type': 'MultiPolygon', 'coordinates': [[_ring(r, arcs) for r in poly] for poly in geom['arcs']]}
    raise ValueError(f'Unknown section geometry: {typ}')


def build_sections(cfg):
    input_file = source(cfg, 'census_topojson', required=True)
    topology = json.loads(input_file.read_text(encoding='utf-8-sig'))
    obj = topology['objects'].get('Secciones_Censales')
    if not obj:
        raise ValueError('TopoJSON does not contain objects.Secciones_Censales')
    arcs = _decode_arcs(topology)
    districts = {}
    barrios = {}
    district_file = source(cfg, 'districts')
    if district_file:
        for r in iter_csv(district_file):
            k = district_code(r.get('COD_DIS'))
            if k:
                districts[k] = r
    barrio_file = source(cfg, 'neighbourhoods')
    if barrio_file:
        for r in iter_csv(barrio_file):
            key = str(r.get('COD_BAR', '')).strip()
            if key:
                barrios[key] = r
    features, records = [], {}
    for g in obj['geometries']:
        props = g.get('properties', {})
        d = district_code(props.get('COD_DIS'))
        code = section_code(props.get('COD_SECCIO'))
        if not code or not d:
            continue
        if code in records:
            raise ValueError(f'Duplicate census section ID {code}')
        geometry = _geometry(g, arcs)
        polygon = shape(geometry)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
            geometry = mapping(polygon)
        if polygon.is_empty:
            continue
        projected = transform(WGS84_TO_UTM, polygon)
        area = projected.area / 1e6
        center = polygon.representative_point()
        b = str(props.get('COD_BAR', '')).strip()
        brec = barrios.get(b, {})
        drec = districts.get(d, {})
        rec = {
            'section_code': code, 'district_code': d,
            'district_name': drec.get('NOMBRE') or props.get('NOM_DIS') or '',
            'barrio_code': b,
            'barrio_name': brec.get('NOMBRE') or props.get('NOM_BAR') or '',
            'section_area_km2': area,
            'section_centroid_lon': center.x, 'section_centroid_lat': center.y,
            'district_area_km2': (as_number(drec.get('AREA')) or 0) / 1e6 if drec else None,
            'barrio_area_km2': (as_number(brec.get('AREA')) or 0) / 1e6 if brec else None,
        }
        records[code] = rec
        features.append({'type': 'Feature', 'properties': {
            'section_code': code, 'district_code': d, 'district_name': rec['district_name'],
            'barrio_code': b, 'barrio_name': rec['barrio_name'],
        }, 'geometry': geometry})
    if not records:
        raise ValueError('No census sections decoded from supplied TopoJSON')
    print(f'[GEO] {len(records)} census polygons loaded')
    return records, sorted(features, key=lambda f: f['properties']['section_code'])
