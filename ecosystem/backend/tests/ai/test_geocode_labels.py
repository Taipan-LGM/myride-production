from __future__ import annotations

from app.geocode_osm import _format_label, _house_from_query, resolve_address


def test_house_number_extracted_from_query():
    assert _house_from_query("12 Long Street, Cape Town") == "12"
    assert _house_from_query("12B Loop Street") == "12B"
    assert _house_from_query("Long Street") is None


def test_format_label_keeps_typed_house_number():
    item = {
        "display_name": "Long Street, Cape Town, Western Cape, South Africa",
        "address": {"road": "Long Street", "city": "Cape Town", "state": "Western Cape"},
        "lat": "-33.92",
        "lon": "18.42",
    }
    label = _format_label(item, "12 Long Street Cape Town")
    assert label.startswith("12 Long Street")
    assert "Cape Town" in label


def test_format_label_uses_nominatim_house_number():
    item = {
        "display_name": "Something else",
        "address": {
            "house_number": "45",
            "road": "Main Road",
            "suburb": "Sea Point",
            "city": "Cape Town",
        },
        "lat": "-33.91",
        "lon": "18.38",
    }
    label = _format_label(item, "45 Main Road")
    assert label.startswith("45 Main Road")
    assert "Sea Point" in label


def test_resolve_preserves_typed_query_as_label(monkeypatch):
    monkeypatch.setattr(
        "app.geocode_osm.search_places",
        lambda query, limit=5, country_codes="za": [
            {
                "label": "Long Street, Cape Town",
                "lat": -33.92,
                "lng": 18.42,
                "house_number": None,
            }
        ],
    )
    place = resolve_address("12 Long Street, Cape Town")
    assert place is not None
    assert place["label"] == "12 Long Street, Cape Town"
    assert place["lat"] == -33.92
