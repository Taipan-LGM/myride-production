from __future__ import annotations

import json
import logging
import math
from typing import Iterable

import geohash2

from app.models import DriverProfile, GeoPoint, NearbyDriver

logger = logging.getLogger(__name__)

# Geohash precision ~1.2km at 6 chars, ~150m at 7 chars
DEFAULT_PRECISION = 7


def encode_location(point: GeoPoint, precision: int = DEFAULT_PRECISION) -> str:
    return geohash2.encode(point.lat, point.lng, precision)


def decode_geohash(geohash: str) -> GeoPoint:
    lat, lng = geohash2.decode(geohash)
    return GeoPoint(lat=lat, lng=lng)


def haversine_km(a: GeoPoint, b: GeoPoint) -> float:
    r = 6371.0
    lat1, lon1 = math.radians(a.lat), math.radians(a.lng)
    lat2, lon2 = math.radians(b.lat), math.radians(b.lng)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def geohash_neighbors(geohash: str) -> list[str]:
    return list(geohash2.neighbors(geohash))


def search_radius_prefixes(center: GeoPoint, radius_km: float, precision: int = DEFAULT_PRECISION) -> list[str]:
    """Return geohash prefixes covering a search disc (neighbor expansion)."""
    center_hash = encode_location(center, precision)
    prefixes = {center_hash[: max(4, precision - 1)]}
    for neighbor in geohash_neighbors(center_hash):
        prefixes.add(neighbor[: max(4, precision - 1)])
    # Wider radius → shorter prefix
    if radius_km > 3:
        prefixes.add(center_hash[:5])
    if radius_km > 10:
        prefixes.add(center_hash[:4])
    return sorted(prefixes)


def filter_nearby_drivers(
    drivers: Iterable[DriverProfile],
    center: GeoPoint,
    radius_km: float,
    limit: int = 10,
) -> list[NearbyDriver]:
    online = [d for d in drivers if d.is_online and d.location]
    ranked: list[NearbyDriver] = []
    for driver in online:
        assert driver.location is not None
        distance = haversine_km(center, driver.location)
        if distance <= radius_km:
            ranked.append(NearbyDriver(driver=driver, distance_km=round(distance, 3)))
    ranked.sort(key=lambda item: item.distance_km)
    return ranked[:limit]


def driver_matches_prefix(driver: DriverProfile, prefix: str) -> bool:
    if not driver.geohash:
        return False
    return driver.geohash.startswith(prefix)


def debug_search_summary(center: GeoPoint, radius_km: float) -> str:
    payload = {
        "center": center.model_dump(),
        "radius_km": radius_km,
        "prefixes": search_radius_prefixes(center, radius_km),
    }
    return json.dumps(payload)
