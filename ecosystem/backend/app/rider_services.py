"""Rider wallet, loyalty, saved places, and carbon estimates (SA launch)."""

from __future__ import annotations

import time
from typing import Any

# In-memory stores (mirrored by Postgres dual-write later)
_wallets: dict[str, dict[str, Any]] = {}
_places: dict[str, list[dict[str, Any]]] = {}
_loyalty_store: dict[str, dict[str, Any]] = {}
_earnings: dict[str, list[dict[str, Any]]] = {}

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
    w = dict(_wallet(user_id))
    w["balance_zar"] = round(w["balance_cents"] / 100, 2)
    return w


def top_up_wallet(user_id: str, amount_cents: int) -> dict[str, Any]:
    w = _wallet(user_id)
    w["balance_cents"] = int(w["balance_cents"]) + max(0, int(amount_cents))
    w["updated_at"] = time.time()
    return get_wallet(user_id)


def charge_wallet(user_id: str, amount_cents: int) -> dict[str, Any]:
    w = _wallet(user_id)
    amt = max(0, int(amount_cents))
    if w["balance_cents"] < amt:
        raise ValueError("Insufficient wallet balance")
    w["balance_cents"] = int(w["balance_cents"]) - amt
    w["updated_at"] = time.time()
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
    pts = int(row["points"])
    if pts >= 1000:
        row["tier"] = "platinum"
    elif pts >= 500:
        row["tier"] = "gold"
    elif pts >= 200:
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
    out = get_loyalty(user_id)
    out["earned_this_trip"] = earned
    return out


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
    # Replace existing home/work
    if kind in ("home", "work"):
        bucket = [p for p in bucket if p.get("kind") != kind]
    bucket = [entry, *bucket][:12]
    _places[user_id] = bucket
    return entry


def carbon_for_distance_km(distance_km: float) -> dict[str, Any]:
    km = max(0.0, float(distance_km))
    kg = round(km * CO2_KG_PER_KM, 3)
    trees = round(kg / 21.0, 3)  # rough annual tree sequestration heuristic
    return {
        "distance_km": round(km, 2),
        "co2_kg": kg,
        "co2_g": int(round(kg * 1000)),
        "equivalent_trees_year_fraction": trees,
        "note": "Estimate for awareness — ICE baseline ~0.18 kg CO₂e/km (SA).",
    }


def record_driver_earning(driver_id: str, *, trip_id: str, amount_cents: int, fare_cents: int) -> dict[str, Any]:
    entry = {
        "trip_id": trip_id,
        "amount_cents": int(amount_cents),
        "fare_cents": int(fare_cents),
        "currency": "zar",
        "created_at": time.time(),
    }
    _earnings.setdefault(driver_id, []).append(entry)
    return entry


def driver_earnings_summary(driver_id: str) -> dict[str, Any]:
    rows = _earnings.get(driver_id) or []
    total = sum(int(r["amount_cents"]) for r in rows)
    today_start = time.time() - 86400
    today = sum(int(r["amount_cents"]) for r in rows if float(r["created_at"]) >= today_start)
    return {
        "driver_id": driver_id,
        "currency": "zar",
        "trips": len(rows),
        "total_cents": total,
        "total_zar": round(total / 100, 2),
        "today_cents": today,
        "today_zar": round(today / 100, 2),
        "platform_fee_rate": 0.20,
        "recent": list(reversed(rows[-10:])),
    }
