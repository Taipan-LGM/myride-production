import tempfile
import unittest
from pathlib import Path

from services.ecosystem_service import EcosystemService


class EcosystemServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.service = EcosystemService(Path(self.temporary_directory.name) / "myride.db")
        self.booking = {
            "rider_id": "test-rider",
            "pickup": {"lat": -26.1076, "lng": 28.0567, "address": "Sandton City"},
            "dropoff": {"lat": -26.1458, "lng": 28.0418, "address": "Rosebank Mall"},
            "vehicle_type": "standard",
            "payment_method": "cash",
            "channel": "web",
        }

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_quote_has_transparent_factors(self):
        quote = self.service.quote((-26.1076, 28.0567), (-26.1458, 28.0418), "standard")
        self.assertGreater(quote["total"], quote["base"])
        self.assertEqual(quote["currency"], "ZAR")
        self.assertIn("demand", quote["factors"])

    def test_dispatch_assigns_verified_nearby_driver(self):
        ride = self.service.book_ride(self.booking)
        self.assertEqual(ride["status"], "assigned")
        self.assertEqual(ride["driver"]["id"], "drv_thabo")
        self.assertGreater(ride["driver"]["match_score"], 0.8)
        self.assertLess(ride["fraud_score"], 0.1)

    def test_completion_reconciles_payment_and_payout(self):
        booked = self.service.book_ride(self.booking)
        for status in ("arrived", "started", "completed"):
            ride = self.service.update_ride(booked["ride_id"], status)
        driver = next(item for item in self.service.list_drivers() if item["id"] == ride["driver_id"])
        self.assertEqual(ride["payment_status"], "paid")
        self.assertEqual(driver["status"], "available")
        self.assertAlmostEqual(driver["earnings_today"], ride["fare"] * 0.85, places=2)
        self.assertEqual(self.service.metrics()["revenue_today"], ride["fare"])

    def test_invalid_lifecycle_transition_is_rejected(self):
        booked = self.service.book_ride(self.booking)
        with self.assertRaises(ValueError):
            self.service.update_ride(booked["ride_id"], "completed")

    def test_support_resolves_standard_issue_and_escalates_safety(self):
        lost_item = self.service.support("test-rider", "I lost my phone")
        safety = self.service.support("test-rider", "I feel unsafe and in danger")
        self.assertEqual(lost_item["status"], "resolved")
        self.assertEqual(lost_item["category"], "lost_item")
        self.assertTrue(safety["escalated"])
        self.assertEqual(safety["status"], "escalated")

    def test_payment_webhook_is_idempotent(self):
        booked = self.service.book_ride(self.booking)
        first = self.service.process_payment_event(
            "evt_payment_1", "payment_intent.succeeded", booked["ride_id"], "pi_1"
        )
        duplicate = self.service.process_payment_event(
            "evt_payment_1", "payment_intent.succeeded", booked["ride_id"], "pi_1"
        )
        self.assertTrue(first["processed"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(self.service.get_ride(booked["ride_id"])["payment_status"], "paid")

    def test_audit_events_are_durable_and_newest_first(self):
        self.service.audit("driver-1", "ride.arrived", "ride-1", metadata={"channel": "api"})
        self.service.audit("admin-1", "driver.reviewed", "driver-1")
        events = self.service.list_audit_events()
        self.assertEqual(events[0]["actor_id"], "admin-1")
        self.assertEqual(events[1]["metadata"], {"channel": "api"})
        self.assertEqual(self.service.metrics()["audit_events"], 2)


if __name__ == "__main__":
    unittest.main()