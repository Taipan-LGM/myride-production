"""Rider wallet, loyalty, saved places, and carbon estimates (SA launch)."""

from __future__ import annotations

import time
from typing import Any

# In-memory stores (mirrored by Postgres dual-write later)
_wallets: dict[str, dict[str, Any]] = {}
_places: dict[str, list[dict[str, Any]]] = {}
_loyalty_store: dict[str, dict[str, Any]] = {}

# SA average ICE car ~0.18 kg CO2e / km (heuristic for rider awareness)
CO2_KG_PER_KM = 0.18


def _wallet(user_id: str) -> dict[str, Any]:
    if user_id not in _wallets:
        _wallets[user_id] = {
            "user_id": user_id,
            "balance_cents": 25_000,  # R250 demo credit
            "currency": "zar",
            "updated_at": time.time(),
        }
    return _wallets[user_id]


def get_wallet(user_id: str) -> dict[str, Any]:
    wallet = dict(_wallet(user_id))
    wallet["balance_zar"] = round(wallet["balance_cents"] / 100, 2)
    return wallet


def top_up_wallet(user_id: str, amount_cents: int) -> dict[str, Any]:
    wallet = _wallet(user_id)
    wallet["balance_cents"] = int(wallet["balance_cents"]) + max(0, int(amount_cents))
    wallet["updated_at"] = time.time()
    return get_wallet(user_id)


def charge_wallet(user_id: str, amount_cents: int) -> dict[str, Any]:
    wallet = _wallet(user_id)
    amount = max(0, int(amount_cents))
    if wallet["balance_cents"] < amount:
        raise ValueError("Insufficient wallet balance")
    wallet["balance_cents"] = int(wallet["balance_cents"]) - amount
    wallet["updated_at"] = time.time()
    return get_wallet(user_id)


def _loyalty_row(user_id: str) -> dict[str, Any]:
    if user_id not in _loyalty_store:
        _loyalty_store[user_id] = {
            "user_id": user_id,
            "points": 120,
            "tier": "bronze",
            "trips_completed": 3,
        }
    return _loyalty_store[user_id]


def get_loyalty(user_id: str) -> dict[str, Any]:
    row = dict(_loyalty_row(user_id))
    points = int(row["points"])
    if points >= 1000:
        row["tier"] = "platinum"
    elif points >= 500:
        row["tier"] = "gold"
    elif points >= 200:
        row["tier"] = "silver"
    else:
        row["tier"] = "bronze"
    row["next_tier_points"] = {"bronze": 200, "silver": 500, "gold": 1000, "platinum": None}.get(row["tier"])
    return row


def award_loyalty_for_trip(user_id: str, fare_cents: int) -> dict[str, Any]:
    row = _loyalty_row(user_id)
    earned = max(5, int(fare_cents) // 100)  # 1 point per R1
    row["points"] = int(row["points"]) + earned
    row["trips_completed"] = int(row["trips_completed"]) + 1
    result = get_loyalty(user_id)
    result["earned_this_trip"] = earned
    return result


def list_saved_places(user_id: str) -> list[dict[str, Any]]:
    return list(_places.get(user_id) or [])


def save_place(user_id: str, place: dict[str, Any]) -> dict[str, Any]:
    label = str(place.get("label") or "Saved place")
    kind = str(place.get("kind") or "other")  # home | work | other
    entry = {
        "id": f"plc-{int(time.time() * 1000)}",
        "kind": kind,
        "label": label,
        "lat": float(place["lat"]),
        "lng": float(place["lng"]),
        "house_number": place.get("house_number"),
    }
    bucket = _places.setdefault(user_id, [])
    if kind in ("home", "work"):
        bucket = [saved for saved in bucket if saved.get("kind") != kind]
    bucket = [entry, *bucket][:12]
    _places[user_id] = bucket
    return entry


def carbon_for_distance_km(distance_km: float) -> dict[str, Any]:
    distance = max(0.0, float(distance_km))
    kilograms = round(distance * CO2_KG_PER_KM, 3)
    trees = round(kilograms / 21.0, 3)
    return {
        "distance_km": round(distance, 2),
        "co2_kg": kilograms,
        "co2_g": int(round(kilograms * 1000)),
        "equivalent_trees_year_fraction": trees,
        "note": "Estimate for awareness — ICE baseline ~0.18 kg CO₂e/km (SA).",
    }