# Frontend — Flutter

Rider, Driver, and Admin mobile/web clients.

## Location

All Flutter code lives in `frontend/` (formerly `flutter/`).

## Run

```bash
cd frontend
flutter pub get

# Rider
./scripts/run_rider.sh
# or: flutter run --flavor rider -t lib/main_rider.dart

# Driver
./scripts/run_driver.sh

# Admin (web)
flutter run -d chrome -t lib/main_admin.dart --web-port=8766
```

## Entry points

| File | App |
|------|-----|
| `lib/main_rider.dart` | Rider |
| `lib/main_driver.dart` | Driver |
| `lib/main_admin.dart` | Admin console |
| `lib/main.dart` | Hub / showcase router |

## Configuration

Full setup (flavors, Google Maps, Firebase, Stripe/Paystack, FCM) is documented in the project copy at:

`frontend/docs/SETUP.md`

## Backend URLs

| Service | Default | Notes |
|---------|---------|-------|
| FastAPI | `http://127.0.0.1:8000` | Trips, payments, AI |
| Admin OTP | `http://127.0.0.1:8788` | MFA email codes |

Wire these via `--dart-define` or env in your run scripts when integrating live APIs.
