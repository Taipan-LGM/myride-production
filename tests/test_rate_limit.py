import unittest

from services.rate_limit_service import RateLimiter


class RateLimiterTests(unittest.TestCase):
    def test_limit_is_isolated_by_key(self):
        now = [100.0]
        limiter = RateLimiter(limit=2, window_seconds=10, clock=lambda: now[0])
        self.assertTrue(limiter.check("user-a")["allowed"])
        self.assertTrue(limiter.check("user-a")["allowed"])
        self.assertFalse(limiter.check("user-a")["allowed"])
        self.assertTrue(limiter.check("user-b")["allowed"])

    def test_window_reopens_after_expiry(self):
        now = [100.0]
        limiter = RateLimiter(limit=1, window_seconds=10, clock=lambda: now[0])
        limiter.check("user-a")
        blocked = limiter.check("user-a")
        self.assertEqual(blocked["retry_after"], 10)
        now[0] = 110.0
        self.assertTrue(limiter.check("user-a")["allowed"])


if __name__ == "__main__":
    unittest.main()