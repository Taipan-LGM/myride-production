#!/usr/bin/env python3
"""My Ride admin OTP mailer — delivers 6-digit codes via SMTP, Resend, or dev console.

Setup:
  cp .env.example .env
  # Edit .env with SMTP_PASSWORD or RESEND_API_KEY
  python3 admin_otp_server.py
"""

from __future__ import annotations

import json
import os
import random
import smtplib
import time
import urllib.error
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Dict, Tuple

_ENV_PATH = Path(__file__).with_name(".env")


def _load_env_file() -> None:
    if not _ENV_PATH.exists():
        return
    for line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_file()

HOST = os.environ.get("OTP_HOST", "127.0.0.1")
PORT = int(os.environ.get("OTP_PORT", "8788"))
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER or "noreply@myride.com")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM = os.environ.get("RESEND_FROM", "My Ride Admin <onboarding@resend.dev>")
DEV_OTP_CONSOLE = os.environ.get("DEV_OTP_CONSOLE", "true").lower() in ("1", "true", "yes")
OTP_TTL_SECONDS = int(os.environ.get("OTP_TTL_SECONDS", "600"))

_otp_store: Dict[str, Tuple[str, float]] = {}


def _generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _email_content(code: str) -> tuple[str, str, str]:
    subject = "My Ride Admin — your sign-in code"
    text = (
        f"Your My Ride admin verification code is: {code}\n\n"
        f"This code expires in {OTP_TTL_SECONDS // 60} minutes.\n"
        "If you did not request this, ignore this email."
    )
    html = f"""
    <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#0A2540">My Ride Admin</h2>
      <p style="color:#1A1A1A">Your verification code:</p>
      <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0A2540">{code}</p>
      <p style="color:#5A6B82;font-size:14px">Expires in {OTP_TTL_SECONDS // 60} minutes.</p>
    </div>
    """
    return subject, text, html


def _send_via_smtp(to_email: str, code: str) -> None:
    if not SMTP_USER or not SMTP_PASSWORD:
        raise RuntimeError("SMTP not configured. Add SMTP_USER and SMTP_PASSWORD to backend/.env")

    subject, text, html = _email_content(code)
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM, [to_email], msg.as_string())


def _send_via_resend(to_email: str, code: str) -> None:
    if not RESEND_API_KEY:
        raise RuntimeError("Resend not configured. Add RESEND_API_KEY to backend/.env")

    subject, text, html = _email_content(code)
    payload = json.dumps({
        "from": RESEND_FROM,
        "to": [to_email],
        "subject": subject,
        "text": text,
        "html": html,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status >= 300:
                raise RuntimeError(f"Resend error: {resp.read().decode()}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        raise RuntimeError(f"Resend failed: {body}") from exc


def _send_email(to_email: str, code: str) -> str:
    """Returns delivery mode: smtp | resend | console."""
    if SMTP_USER and SMTP_PASSWORD:
        try:
            _send_via_smtp(to_email, code)
            return "smtp"
        except (BrokenPipeError, ConnectionResetError, OSError, smtplib.SMTPException) as exc:
            if DEV_OTP_CONSOLE:
                print(
                    f"\n[admin-otp] SMTP failed ({exc}); using dev console OTP instead.\n"
                    f"{'=' * 48}\n  DEV OTP for {to_email}: {code}\n{'=' * 48}\n",
                    flush=True,
                )
                return "console"
            raise RuntimeError(
                f"SMTP delivery failed ({exc}). Check SMTP_PASSWORD in backend/.env "
                "or set DEV_OTP_CONSOLE=true for local testing."
            ) from exc
    if RESEND_API_KEY:
        try:
            _send_via_resend(to_email, code)
            return "resend"
        except (urllib.error.URLError, RuntimeError) as exc:
            if DEV_OTP_CONSOLE:
                print(
                    f"\n[admin-otp] Resend failed ({exc}); using dev console OTP instead.\n"
                    f"{'=' * 48}\n  DEV OTP for {to_email}: {code}\n{'=' * 48}\n",
                    flush=True,
                )
                return "console"
            raise
    if DEV_OTP_CONSOLE:
        print(f"\n{'=' * 48}\n  DEV OTP for {to_email}: {code}\n  (Set SMTP in backend/.env for real email)\n{'=' * 48}\n", flush=True)
        return "console"
    raise RuntimeError(
        "Email not configured. Copy backend/.env.example to backend/.env and set SMTP_PASSWORD or RESEND_API_KEY."
    )


class OtpHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        print(f"[admin-otp] {self.address_string()} {format % args}")

    def _set_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        try:
            self.send_response(status)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # Client closed early (common on Flutter web); OTP was still generated.
            print(f"[admin-otp] client disconnected before response ({status})", flush=True)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        try:
            data = self._read_json()
            email = (data.get("email") or "").strip().lower()
            if not email or "@" not in email:
                self._json(400, {"ok": False, "error": "Valid email is required"})
                return

            if self.path.rstrip("/") == "/send":
                code = _generate_code()
                _otp_store[email] = (code, time.time() + OTP_TTL_SECONDS)
                mode = _send_email(email, code)
                payload = {"ok": True, "message": f"OTP sent to {email}", "mode": mode}
                if mode == "console":
                    payload["message"] = "OTP ready — enter the code shown below"
                    payload["dev_code"] = code
                self._json(200, payload)
                return

            if self.path.rstrip("/") == "/verify":
                code = (data.get("code") or "").strip()
                stored = _otp_store.get(email)
                if not stored:
                    self._json(400, {"ok": False, "error": "No OTP pending for this email"})
                    return
                expected, expires = stored
                if time.time() > expires:
                    _otp_store.pop(email, None)
                    self._json(400, {"ok": False, "error": "OTP expired. Request a new code."})
                    return
                if code != expected:
                    self._json(400, {"ok": False, "error": "Invalid OTP code"})
                    return
                _otp_store.pop(email, None)
                self._json(200, {"ok": True, "message": "Verified"})
                return

            self._json(404, {"ok": False, "error": "Not found"})
        except RuntimeError as exc:
            self._json(500, {"ok": False, "error": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"ok": False, "error": f"Server error: {exc}"})


def main() -> None:
    server = HTTPServer((HOST, PORT), OtpHandler)
    print(f"Admin OTP server on http://{HOST}:{PORT}")
    if _ENV_PATH.exists():
        print(f"Loaded config from {_ENV_PATH}")
    if SMTP_USER and SMTP_PASSWORD:
        print(f"Email via SMTP: {SMTP_USER}")
    elif RESEND_API_KEY:
        print("Email via Resend API")
    elif DEV_OTP_CONSOLE:
        print("DEV mode: OTP codes print in this terminal (set SMTP_PASSWORD in .env for real email)")
    else:
        print("WARNING: No email delivery configured — copy .env.example to .env")
    server.serve_forever()


if __name__ == "__main__":
    main()
