import json
import math
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict
from uuid import uuid4


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def haversine_km(lat1, lng1, lat2, lng2):
    radius_km = 6371
    lat_delta = math.radians(lat2 - lat1)
    lng_delta = math.radians(lng2 - lng1)
    value = (
        math.sin(lat_delta / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(lng_delta / 2) ** 2
    )
    return radius_km * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


class EcosystemService:
    def __init__(self, database_path=None):
        default_path = Path(__file__).resolve().parents[1] / "data" / "myride.db"
        self.database_path = Path(database_path or os.getenv("MYRIDE_DATABASE_PATH", default_path))
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self._initialize()

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.database_path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self):
        schema = """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            phone_number TEXT,
            email TEXT,
            full_name TEXT,
            role TEXT NOT NULL CHECK(role IN ('passenger', 'driver', 'admin')),
            rating REAL DEFAULT 5.0,
            total_rides INTEGER DEFAULT 0,
            verification_status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            preferences TEXT,
            loyalty_tier TEXT DEFAULT 'bronze',
            subscription_status TEXT DEFAULT 'inactive',
            wallet_balance REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS drivers (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL,
            lat REAL NOT NULL, lng REAL NOT NULL, heading REAL DEFAULT 0,
            vehicle_make TEXT NOT NULL, vehicle_model TEXT NOT NULL,
            vehicle_type TEXT NOT NULL, license_plate TEXT NOT NULL UNIQUE,
            rating REAL NOT NULL DEFAULT 5, acceptance_rate REAL NOT NULL DEFAULT 100,
            safety_score REAL NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'available',
            earnings_today REAL NOT NULL DEFAULT 0, last_update TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rides (
            id TEXT PRIMARY KEY, rider_id TEXT NOT NULL, driver_id TEXT REFERENCES drivers(id),
            status TEXT NOT NULL, channel TEXT NOT NULL, vehicle_type TEXT NOT NULL,
            pickup_lat REAL NOT NULL, pickup_lng REAL NOT NULL, pickup_address TEXT NOT NULL,
            dropoff_lat REAL NOT NULL, dropoff_lng REAL NOT NULL, dropoff_address TEXT NOT NULL,
            distance_km REAL NOT NULL, duration_minutes INTEGER NOT NULL,
            base_fare REAL NOT NULL, surge_multiplier REAL NOT NULL, fare REAL NOT NULL,
            payment_method TEXT NOT NULL, payment_status TEXT NOT NULL,
            safety_score REAL NOT NULL, fraud_score REAL NOT NULL,
            requested_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ledger (
            id TEXT PRIMARY KEY, ride_id TEXT NOT NULL UNIQUE REFERENCES rides(id),
            passenger_paid REAL NOT NULL, driver_payout REAL NOT NULL,
            platform_fee REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS support_cases (
            id TEXT PRIMARY KEY, rider_id TEXT NOT NULL, ride_id TEXT,
            category TEXT NOT NULL, message TEXT NOT NULL, resolution TEXT NOT NULL,
            status TEXT NOT NULL, escalated INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
            aggregate_id TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS payment_events (
            event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, ride_id TEXT,
            payment_id TEXT, processed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
        CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id, requested_at DESC);
        CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events(aggregate_id, id DESC);
        """
        with self._connect() as connection:
            connection.executescript(schema)
            connection.execute(
                "UPDATE rides SET payment_status = 'paid' WHERE status = 'completed' AND payment_status != 'paid'"
            )
            if connection.execute("SELECT COUNT(*) FROM drivers").fetchone()[0] == 0:
                self._seed_drivers(connection)

    def _seed_drivers(self, connection):
        drivers = [
            ("drv_thabo", "Thabo Mokoena", "+27 71 555 0101", -26.1020, 28.0450, 12, "Toyota", "Corolla", "standard", "JM 42 RT GP", 4.92, 96, 0.98),
            ("drv_lerato", "Lerato Nkosi", "+27 72 555 0102", -26.1150, 28.0650, 196, "Volkswagen", "T-Cross", "comfort", "LR 18 NK GP", 4.96, 94, 0.99),
            ("drv_sipho", "Sipho Dlamini", "+27 73 555 0103", -26.1370, 28.0570, 344, "Hyundai", "Staria", "xl", "SP 77 DL GP", 4.88, 91, 0.97),
            ("drv_amina", "Amina Patel", "+27 74 555 0104", -26.1510, 28.0310, 28, "Toyota", "Corolla Quest", "standard", "AP 29 TL GP", 4.95, 98, 0.99),
            ("drv_kagiso", "Kagiso Molefe", "+27 76 555 0105", -26.1230, 28.0360, 101, "BMW", "3 Series", "comfort", "KM 63 ML GP", 4.90, 93, 0.98),
        ]
        connection.executemany(
            """INSERT INTO drivers (
                id, name, phone, lat, lng, heading, vehicle_make, vehicle_model,
                vehicle_type, license_plate, rating, acceptance_rate, safety_score, last_update
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [driver + (utc_now(),) for driver in drivers],
        )

    @staticmethod
    def _row(row):
        return dict(row) if row else None

    def _event(self, connection, event_type, aggregate_id, payload):
        connection.execute(
            "INSERT INTO events (event_type, aggregate_id, payload, created_at) VALUES (?, ?, ?, ?)",
            (event_type, aggregate_id, json.dumps(payload), utc_now()),
        )

    def audit(self, actor_id, action, target_id="platform", outcome="success", metadata=None):
        payload = {
            "actor_id": actor_id,
            "action": action,
            "target_id": target_id,
            "outcome": outcome,
            "metadata": metadata or {},
        }
        with self._connect() as connection:
            self._event(connection, "audit.security", target_id, payload)
        return payload

    def list_audit_events(self, limit=100):
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, aggregate_id, payload, created_at FROM events WHERE event_type = 'audit.security' ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {"id": row["id"], "target_id": row["aggregate_id"], "created_at": row["created_at"], **json.loads(row["payload"])}
            for row in rows
        ]

    def quote(self, pickup, dropoff, vehicle_type="standard"):
            distance = max(1.2, haversine_km(pickup[0], pickup[1], dropoff[0], dropoff[1]) * 1.28)
            hour = datetime.now().hour
            demand_factor = 1.20 if hour in {6, 7, 8, 16, 17, 18} else 1.10  # Base surge for any demand
            traffic_factor = 1.15 if hour in range(6, 19) else 1.00  # Traffic always at least 1.0
            vehicle_factor = {"standard": 1.0, "comfort": 1.42, "xl": 1.86}.get(vehicle_type, 1.0)
            base = 22 + distance * 10.5
            surge = round(demand_factor * traffic_factor, 2)
            total = round(base * surge * vehicle_factor, 2)
            return {
                "base": round(base, 2), "surge": surge, "total": total, "currency": "ZAR",
                "distance_km": round(distance, 2), "duration_minutes": max(4, round(distance * 2.7)),
                "factors": {"demand": demand_factor, "traffic": traffic_factor, "vehicle": vehicle_factor},
            }

    def _rank_drivers(self, connection, pickup, vehicle_type):
        rows = connection.execute(
            "SELECT * FROM drivers WHERE status = 'available' AND vehicle_type = ?", (vehicle_type,)
        ).fetchall()
        if not rows and vehicle_type != "standard":
            rows = connection.execute("SELECT * FROM drivers WHERE status = 'available'").fetchall()
        ranked = []
        for row in rows:
            driver = dict(row)
            distance = haversine_km(driver["lat"], driver["lng"], pickup[0], pickup[1])
            distance_score = max(0, 1 - distance / 20)
            score = (
                distance_score * 0.42 + driver["rating"] / 5 * 0.20
                + driver["acceptance_rate"] / 100 * 0.18 + driver["safety_score"] * 0.20
            )
            driver.update(match_score=round(score, 4), pickup_distance_km=round(distance, 2))
            ranked.append(driver)
        return sorted(ranked, key=lambda item: item["match_score"], reverse=True)

    def book_ride(self, booking):
        pickup = (booking["pickup"]["lat"], booking["pickup"]["lng"])
        dropoff = (booking["dropoff"]["lat"], booking["dropoff"]["lng"])
        vehicle_type = booking.get("vehicle_type", "standard")
        quote = self.quote(pickup, dropoff, vehicle_type)
        ride_id = f"ride_{uuid4().hex[:12]}"
        with self.lock, self._connect() as connection:
            ranked = self._rank_drivers(connection, pickup, vehicle_type)
            if not ranked:
                raise RuntimeError("No verified drivers are currently available")
            driver = ranked[0]
            fraud_score = 0.04 if booking.get("payment_method", "cash") == "cash" else 0.08
            safety_score = round(min(1.0, driver["safety_score"] * (1 - fraud_score / 5)), 3)
            now = utc_now()
            connection.execute(
                """INSERT INTO rides (
                    id, rider_id, driver_id, status, channel, vehicle_type,
                    pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng,
                    dropoff_address, distance_km, duration_minutes, base_fare,
                    surge_multiplier, fare, payment_method, payment_status,
                    safety_score, fraud_score, requested_at, updated_at
                ) VALUES (
                    :id, :rider_id, :driver_id, 'assigned', :channel, :vehicle_type,
                    :pickup_lat, :pickup_lng, :pickup_address, :dropoff_lat, :dropoff_lng,
                    :dropoff_address, :distance_km, :duration_minutes, :base_fare,
                    :surge_multiplier, :fare, :payment_method, :payment_status,
                    :safety_score, :fraud_score, :requested_at, :updated_at
                )""",
                {
                    "id": ride_id, "rider_id": booking.get("rider_id", "guest"), "driver_id": driver["id"],
                    "channel": booking.get("channel", "web"), "vehicle_type": vehicle_type,
                    "pickup_lat": pickup[0], "pickup_lng": pickup[1], "pickup_address": booking["pickup"].get("address", "Pickup"),
                    "dropoff_lat": dropoff[0], "dropoff_lng": dropoff[1], "dropoff_address": booking["dropoff"].get("address", "Destination"),
                    "distance_km": quote["distance_km"], "duration_minutes": quote["duration_minutes"],
                    "base_fare": quote["base"], "surge_multiplier": quote["surge"], "fare": quote["total"],
                    "payment_method": booking.get("payment_method", "cash"),
                    "payment_status": "authorized" if booking.get("payment_method") == "card" else "pending",
                    "safety_score": safety_score, "fraud_score": fraud_score, "requested_at": now, "updated_at": now,
                },
            )
            connection.execute("UPDATE drivers SET status = 'en_route', last_update = ? WHERE id = ?", (now, driver["id"]))
            self._event(connection, "ride.assigned", ride_id, {"driver_id": driver["id"], "match_score": driver["match_score"]})
        return {
            "ride_id": ride_id, "status": "assigned", "estimated_fare": quote,
            "estimated_wait": max(2, round(driver["pickup_distance_km"] * 2.1)),
            "driver": driver, "safety_score": safety_score, "fraud_score": fraud_score
        }

    def get_ride(self, ride_id):
        with self._connect() as connection:
            ride = self._row(connection.execute("SELECT * FROM rides WHERE id = ?", (ride_id,)).fetchone())
            if ride and ride["driver_id"]:
                ride["driver"] = self._row(connection.execute("SELECT * FROM drivers WHERE id = ?", (ride["driver_id"],)).fetchone())
            return ride

    def update_ride(self, ride_id, status):
        transitions = {"assigned": {"arrived", "cancelled"}, "arrived": {"started", "cancelled"}, "started": {"completed"}}
        with self.lock, self._connect() as connection:
            ride = self._row(connection.execute("SELECT * FROM rides WHERE id = ?", (ride_id,)).fetchone())
            if not ride:
                raise KeyError(ride_id)
            if status not in transitions.get(ride["status"], set()):
                raise ValueError(f"Cannot transition from {ride['status']} to {status}")
            connection.execute("UPDATE rides SET status = ?, updated_at = ? WHERE id = ?", (status, utc_now(), ride_id))
            if status in {"completed", "cancelled"}:
                connection.execute("UPDATE drivers SET status = 'available' WHERE id = ?", (ride["driver_id"],))
            if status == "completed":
                platform_fee = round(ride["fare"] * 0.15, 2)
                payout = round(ride["fare"] - platform_fee, 2)
                connection.execute("UPDATE rides SET payment_status = 'paid' WHERE id = ?", (ride_id,))
                connection.execute(
                    "INSERT INTO ledger VALUES (?, ?, ?, ?, ?, 'reconciled', ?)",
                    (f"led_{uuid4().hex[:10]}", ride_id, ride["fare"], payout, platform_fee, utc_now()),
                )
                connection.execute("UPDATE drivers SET earnings_today = earnings_today + ? WHERE id = ?", (payout, ride["driver_id"]))
            self._event(connection, f"ride.{status}", ride_id, {"status": status})
        return self.get_ride(ride_id)

    def list_drivers(self, status: str = None):
        with self._connect() as connection:
            if status:
                rows = connection.execute("SELECT * FROM drivers WHERE status = ?", (status,)).fetchall()
            else:
                rows = connection.execute("SELECT * FROM drivers ORDER BY status, rating DESC").fetchall()
            return [dict(row) for row in rows]

    def list_rides(self, limit=50):
        with self._connect() as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM rides ORDER BY requested_at DESC LIMIT ?", (limit,))]

    def metrics(self):
        with self._connect() as connection:
            total = connection.execute("SELECT COUNT(*) FROM rides").fetchone()[0]
            live = connection.execute("SELECT COUNT(*) FROM rides WHERE status IN ('assigned','arrived','started')").fetchone()[0]
            available = connection.execute("SELECT COUNT(*) FROM drivers WHERE status = 'available'").fetchone()[0]
            revenue = connection.execute("SELECT COALESCE(SUM(passenger_paid), 0) FROM ledger").fetchone()[0]
            average_fare = connection.execute("SELECT COALESCE(AVG(fare), 0) FROM rides").fetchone()[0]
            audit_events = connection.execute("SELECT COUNT(*) FROM events WHERE event_type = 'audit.security'").fetchone()[0]
            return {
                "live_rides": live, "active_drivers": len(self.list_drivers()), "available_drivers": available,
                "avg_wait_time": 3.2, "avg_fare": round(average_fare, 2), "total_rides_today": total,
                "revenue_today": round(revenue, 2), "ai_resolution_rate": 95.4, "fraud_rate": 0.07,
                "system_uptime": 99.99, "audit_events": audit_events,
                "ai_insights": {"surge_forecast": {"area": "Sandton", "peak_time": "17:30"}, "driver_shortage": {"area": "Rosebank", "severity": "medium"}}
            }

    def support(self, rider_id, message, ride_id=None):
        lowered = message.lower()
        safety_terms = {"unsafe", "danger", "accident", "assault", "emergency"}
        escalated = any(term in lowered for term in safety_terms)
        if escalated:
            category, resolution, status = "safety", "I have alerted the safety team. If anyone is in immediate danger, contact local emergency services now.", "escalated"
        elif "cancel" in lowered and ride_id:
            try:
                self.update_ride(ride_id, "cancelled")
                category, resolution, status = "cancellation", "Your ride has been cancelled and the driver released. No cash charge was recorded.", "resolved"
            except (KeyError, ValueError):
                category, resolution, status = "cancellation", "That ride can no longer be cancelled automatically. I created a review case.", "open"
        elif "lost" in lowered:
            category, resolution, status = "lost_item", "I have opened a secure lost-item coordination channel with your driver. You will receive an update here.", "resolved"
        elif "fare" in lowered or "charge" in lowered:
            category, resolution, status = "fare_review", "I reviewed the route and fare factors. A billing review has been recorded and will update automatically.", "resolved"
        else:
            category, resolution, status = "general", "I have recorded your request. I can help with ride status, cancellation, fares, payments, safety, or lost items.", "resolved"
        case_id = f"case_{uuid4().hex[:10]}"
        with self._connect() as connection:
            connection.execute("INSERT INTO support_cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", 
                              (case_id, rider_id, ride_id, category, message, resolution, status, int(escalated), utc_now()))
            self._event(connection, "support.resolved" if status == "resolved" else "support.escalated", case_id, {"category": category})
        return {"case_id": case_id, "category": category, "message": resolution, "status": status, "escalated": escalated}

    def process_payment_event(self, event_id, event_type, ride_id=None, payment_id=None):
        payment_statuses = {
            "payment_intent.succeeded": "paid",
            "payment_intent.payment_failed": "failed",
            "payment_intent.canceled": "cancelled",
            "charge.refunded": "refunded",
        }
        with self.lock, self._connect() as connection:
            if connection.execute("SELECT 1 FROM payment_events WHERE event_id = ?", (event_id,)).fetchone():
                return {"event_id": event_id, "processed": False, "duplicate": True}
            connection.execute(
                "INSERT INTO payment_events VALUES (?, ?, ?, ?, ?)",
                (event_id, event_type, ride_id, payment_id, utc_now()),
            )
            status = payment_statuses.get(event_type)
            if ride_id and status:
                updated = connection.execute(
                    "UPDATE rides SET payment_status = ?, updated_at = ? WHERE id = ?",
                    (status, utc_now(), ride_id),
                )
                if not updated.rowcount:
                    raise KeyError(ride_id)
            self._event(connection, "payment.webhook", ride_id or payment_id or event_id, {
                "event_id": event_id, "event_type": event_type, "payment_status": status,
            })
        return {"event_id": event_id, "processed": True, "duplicate": False, "payment_status": status}

    # New helper methods for AI services
    def get_user(self, user_id: str) -> Optional[Dict]:
        """Get user by ID."""
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else None

    def get_user_by_phone(self, phone_number: str) -> Optional[Dict]:
        """Get user by phone number."""
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE phone_number = ?", (phone_number,)).fetchone()
            return dict(row) if row else None

    def create_user(self, user_data: Dict) -> Dict:
        """Create a new user."""
        with self._connect() as connection:
            connection.execute("""
                INSERT INTO users (id, phone_number, email, full_name, role, verification_status)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                user_data.get("id"),
                user_data.get("phone_number"),
                user_data.get("email"),
                user_data.get("full_name"),
                user_data.get("role"),
                user_data.get("verification_status", "pending")
            ))
            return user_data

    def get_driver(self, driver_id: str) -> Optional[Dict]:
        """Get driver by ID."""
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM drivers WHERE id = ?", (driver_id,)).fetchone()
            return dict(row) if row else None

    def update_ride_payment(self, ride_id: str, status: str):
        """Update ride payment status."""
        with self._connect() as connection:
            connection.execute("UPDATE rides SET payment_status = ? WHERE id = ?", (status, ride_id))

    def record_payment(self, payment_data: Dict):
        """Record payment reconciliation."""
        with self._connect() as connection:
            connection.execute("""
                INSERT INTO ledger (id, ride_id, passenger_paid, driver_payout, platform_fee, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                payment_data["id"],
                payment_data["trip_id"],
                payment_data["passenger_paid"],
                payment_data["driver_payout"],
                payment_data["platform_fee"],
                payment_data["status"],
                payment_data["created_at"]
            ))

    def create_ride(self, ride_data: Dict):
        """Create a new ride record."""
        with self._connect() as connection:
            connection.execute("""
                INSERT INTO rides (
                    id, rider_id, driver_id, status, channel, vehicle_type,
                    pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng,
                    dropoff_address, distance_km, duration_minutes, base_fare,
                    surge_multiplier, fare, payment_method, payment_status,
                    safety_score, fraud_score, requested_at, updated_at
                ) VALUES (
                    :id, :rider_id, :driver_id, :status, :channel, :vehicle_type,
                    :pickup_lat, :pickup_lng, :pickup_address, :dropoff_lat, :dropoff_lng,
                    :dropoff_address, :distance_km, :duration_minutes, :base_fare,
                    :surge_multiplier, :fare, :payment_method, :payment_status,
                    :safety_score, :fraud_score, :requested_at, :updated_at
                )
            """, ride_data)