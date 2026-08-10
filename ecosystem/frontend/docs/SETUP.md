# Android product flavors (after `flutter create .`)

Add to `android/app/build.gradle` inside `android { defaultConfig { ... } }`:

```gradle
flavorDimensions "app"
productFlavors {
    rider {
        dimension "app"
        applicationId "com.myride.rider"
        resValue "string", "app_name", "My Ride"
    }
    driver {
        dimension "app"
        applicationId "com.myride.driver"
        resValue "string", "app_name", "My Ride Driver"
    }
}
```

Run:

```bash
flutter run --flavor rider -t lib/main_rider.dart
flutter run --flavor driver -t lib/main_driver.dart
```

## iOS

Duplicate schemes `Runner-Rider` / `Runner-Driver` with bundle IDs:

- `com.myride.rider`
- `com.myride.driver`

Set `CFBundleDisplayName` to **My Ride** / **My Ride Driver**.

## Google Maps API key

**Android** — `android/app/src/main/AndroidManifest.xml`:

```xml
<meta-data android:name="com.google.android.geo.API_KEY"
           android:value="${GOOGLE_MAPS_API_KEY}"/>
```

**iOS** — `ios/Runner/AppDelegate.swift`:

```swift
GMSServices.provideAPIKey(ProcessInfo.processInfo.environment["GOOGLE_MAPS_API_KEY"] ?? "")
```

Pass at run time:

```bash
export GOOGLE_MAPS_API_KEY=your_key
./scripts/run_with_maps.sh
```

## Firebase

```bash
dart pub global activate flutterfire_cli
flutterfire configure
```

Run with:

```bash
flutter run -t lib/main_rider.dart --dart-define=FIREBASE_ENABLED=true
```

Replace placeholders in `lib/firebase_options.dart` (or use generated file from flutterfire).

## Payments

| Provider | dart-define | Backend |
|----------|-------------|---------|
| Stripe | `STRIPE_PUBLISHABLE_KEY`, `STRIPE_BACKEND_URL` | POST `/stripe/payment-intent` → `{ client_secret }` |
| Paystack | `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_BACKEND_URL` | POST `/paystack/initialize` → `{ authorization_url, reference }` |

Without keys, wallet uses **mock top-up** (dev friendly).

## FCM trip events

Server payload `data.type`:

- `trip_assigned`
- `driver_arriving`
- `trip_complete`
- `new_ride_request` (driver)

Clients subscribe to topics `riders` / `drivers` after permissions.
