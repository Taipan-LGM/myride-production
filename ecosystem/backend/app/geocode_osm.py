"""OpenStreetMap Nominatim geocoding proxy (search + reverse).

Labels prefer house_number + road so drivers can find riders.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.parse
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

_NOMINATIM = "https://nominatim.openstreetmap.org"
_UA = "MyRideSA/1.0 (ecosystem; contact=dev@myride.co.za)"
_HOUSE_RE = re.compile(r"^(\d+[A-Za-z]?)\b")


def _fetch(url: str) -> Any:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": _UA, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _house_from_query(query: str) -> str | None:
    m = _HOUSE_RE.match((query or "").strip())
    return m.group(1) if m else None


def _format_label(item: dict[str, Any], query: str = "") -> str:
    """Build a driver-friendly label that keeps the street number."""
    addr = item.get("address") or {}
    house = str(addr.get("house_number") or "").strip()
    road = (
        addr.get("road")
        or addr.get("pedestrian")
        or addr.get("residential")
        or addr.get("street")
        or ""
    )
    suburb = addr.get("suburb") or addr.get("neighbourhood") or addr.get("quarter") or ""
    city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("municipality") or ""
    state = addr.get("state") or ""
    postcode = addr.get("postcode") or ""

    typed_house = _house_from_query(query)
    if not house and typed_house:
        house = typed_house

    line1 = ""
    if house and road:
        line1 = f"{house} {road}"
    elif road:
        line1 = str(road)
        if typed_house and typed_house not in line1:
            line1 = f"{typed_house} {line1}"
    elif item.get("display_name"):
        dn = str(item["display_name"])
        if typed_house and typed_house not in dn.split(",")[0]:
            return f"{typed_house} {dn}"
        return dn

    parts = [p for p in [line1, suburb, city, state, postcode] if p]
    if parts:
        label = ", ".join(parts)
        # Never drop a typed house number
        if typed_house and typed_house not in label.split(",")[0]:
            label = f"{typed_house} {label}"
        return label
    return str(item.get("display_name") or query or "Address")


def _to_result(item: dict[str, Any], query: str = "") -> dict[str, Any] | None:
    try:
        addr = item.get("address") or {}
        house = str(addr.get("house_number") or "").strip() or _house_from_query(query)
        return {
            "label": _format_label(item, query),
            "lat": float(item["lat"]),
            "lng": float(item["lon"]),
            "place_id": item.get("place_id"),
            "type": item.get("type"),
            "house_number": house,
            "road": addr.get("road") or addr.get("pedestrian") or None,
            "suburb": addr.get("suburb") or addr.get("neighbourhood") or None,
            "city": addr.get("city") or addr.get("town") or None,
            "display_name": item.get("display_name"),
        }
    except (KeyError, TypeError, ValueError):
        return None


def search_places(query: str, *, limit: int = 6, country_codes: str = "za") -> list[dict[str, Any]]:
    q = (query or "").strip()
    if len(q) < 2:
        return []
    params = urllib.parse.urlencode(
        {
            "q": q,
            "format": "json",
            "addressdetails": 1,
            "limit": max(1, min(limit, 10)),
            "countrycodes": country_codes,
        }
    )
    try:
        raw = _fetch(f"{_NOMINATIM}/search?{params}")
    except Exception as exc:
        logger.warning("Nominatim search failed: %s", exc)
        return []

    out: list[dict[str, Any]] = []
    typed_house = _house_from_query(q)
    for item in raw or []:
        row = _to_result(item, q)
        if not row:
            continue
        out.append(row)

    # Prefer hits that include the typed house number in the primary line
    if typed_house:
        out.sort(
            key=lambda r: (
                0 if (r.get("house_number") == typed_house or typed_house in (r.get("label") or "")) else 1,
                r.get("label") or "",
            )
        )
    return out


def reverse_geocode(lat: float, lng: float) -> dict[str, Any] | None:
    params = urllib.parse.urlencode(
        {
            "lat": lat,
            "lon": lng,
            "format": "json",
            "addressdetails": 1,
        }
    )
    try:
        item = _fetch(f"{_NOMINATIM}/reverse?{params}")
    except Exception as exc:
        logger.warning("Nominatim reverse failed: %s", exc)
        return None
    if not item or item.get("error"):
        return None
    return _to_result(item) or {
        "label": item.get("display_name") or f"{lat:.5f}, {lng:.5f}",
        "lat": float(item.get("lat", lat)),
        "lng": float(item.get("lon", lng)),
    }


def resolve_address(query: str) -> dict[str, Any] | None:
    """Best single match for a free-typed address (keeps house number in label)."""
    results = search_places(query, limit=5)
    if not results:
        return None
    typed_house = _house_from_query(query)
    if typed_house:
        for r in results:
            if r.get("house_number") == typed_house or typed_house in (r.get("label") or ""):
                # Keep the user's exact typed string as the primary label when richer
                if query.strip() and len(query.strip()) > len(r["label"]) * 0.5:
                    r = {**r, "label": query.strip(), "resolved_from": r["label"]}
                return r
    best = results[0]
    # Always prefer the rider's typed string so street number is never lost
    if query.strip():
        return {**best, "label": query.strip(), "resolved_from": best.get("label")}
    return best
