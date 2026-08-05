import unittest
from unittest.mock import patch

from services.auth_service import AuthenticationError, AuthService


class AuthServiceTests(unittest.TestCase):
    def setUp(self):
        self.auth = AuthService(secret="test-secret", token_ttl_seconds=60)

    def test_signed_token_round_trip(self):
        token = self.auth.issue_token("admin-1", "admin", now=100)
        claims = self.auth.verify_token(token, {"admin"}, now=120)
        self.assertEqual(claims["sub"], "admin-1")
        self.assertEqual(claims["role"], "admin")

    def test_tampered_token_is_rejected(self):
        token = self.auth.issue_token("driver-1", "driver", now=100)
        with self.assertRaises(AuthenticationError):
            self.auth.verify_token(token[:-1] + "x", now=120)

    def test_expired_token_is_rejected(self):
        token = self.auth.issue_token("rider-1", "passenger", now=100)
        with self.assertRaises(AuthenticationError):
            self.auth.verify_token(token, now=160)

    def test_wrong_role_is_rejected(self):
        token = self.auth.issue_token("rider-1", "passenger", now=100)
        with self.assertRaises(AuthenticationError):
            self.auth.verify_token(token, {"admin"}, now=120)

    def test_production_requires_explicit_secret(self):
        with patch.dict("os.environ", {"ENVIRONMENT": "production"}, clear=True):
            with self.assertRaises(RuntimeError):
                AuthService()


if __name__ == "__main__":
    unittest.main()