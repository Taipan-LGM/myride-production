import 'package:my_ride/config/app_flavor.dart';

/// Runtime config from `--dart-define` or frontend/.env via run scripts.
abstract final class AppConfig {
  static AppFlavor flavor = AppFlavor.dev;

  /// FastAPI backend — `cd backend && ./start_api.sh` (default :8000).
  /// Legacy Node — `npm run dev` in repo root (default :3000) with [legacyBackend].
  static String get apiBaseUrl => const String.fromEnvironment(
        'API_BASE_URL',
        defaultValue: 'http://127.0.0.1:8000',
      );

  /// When true, use legacy Node.js Express + Socket.io (`/api/*` paths).
  static bool get legacyBackend =>
      const bool.fromEnvironment('LEGACY_BACKEND', defaultValue: false) ||
      apiBaseUrl.contains(':3000');

  /// Socket.io connects to the same host as [apiBaseUrl] (HTTP URL, not ws://).
  static String get socketBaseUrl => const String.fromEnvironment(
        'SOCKET_BASE_URL',
        defaultValue: '',
      ).isNotEmpty
      ? const String.fromEnvironment('SOCKET_BASE_URL', defaultValue: '')
      : apiBaseUrl;

  /// Nelson Mandela Bay default map center (legacy production region).
  static const defaultLat = -33.9249;
  static const defaultLng = 25.5701;

  static bool get apiEnabled => apiBaseUrl.isNotEmpty;

  /// Lighter driver flows on Android emulator (skip FGS + permission dialogs).
  static bool get emulatorDev =>
      const bool.fromEnvironment('EMULATOR_DEV', defaultValue: false);

  /// Optional explicit WebSocket base (e.g. ws://localhost:8000). Falls back to API URL scheme swap.
  static String get websocketBaseUrl => const String.fromEnvironment(
        'WEBSOCKET_BASE_URL',
        defaultValue: '',
      );

  static String get googleMapsApiKeyAndroid => const String.fromEnvironment('GOOGLE_MAPS_API_KEY', defaultValue: '');

  static String get googleMapsApiKeyIos => const String.fromEnvironment('GOOGLE_MAPS_API_KEY_IOS', defaultValue: '');

  static String get googleMapsApiKeyWeb => const String.fromEnvironment('GOOGLE_MAPS_API_KEY_WEB', defaultValue: '');

  /// Active maps key: set per-platform by run script, or use generic GOOGLE_MAPS_API_KEY.
  static String get googleMapsApiKey {
    final generic = googleMapsApiKeyAndroid;
    if (generic.isNotEmpty && generic != 'YOUR_ANDROID_KEY') return generic;
    if (googleMapsApiKeyWeb.isNotEmpty && googleMapsApiKeyWeb != 'YOUR_WEB_KEY') return googleMapsApiKeyWeb;
    if (googleMapsApiKeyIos.isNotEmpty && googleMapsApiKeyIos != 'YOUR_IOS_KEY') return googleMapsApiKeyIos;
    return '';
  }

  static bool get mapsEnabled => googleMapsApiKey.isNotEmpty;

  static String get stripePublishableKey => const String.fromEnvironment('STRIPE_PUBLISHABLE_KEY', defaultValue: '');

  static bool get stripeEnabled =>
      stripePublishableKey.isNotEmpty && stripePublishableKey != 'pk_test_...';

  static String get paystackPublicKey => const String.fromEnvironment('PAYSTACK_PUBLIC_KEY', defaultValue: '');

  static String get paystackBackendUrl => const String.fromEnvironment('PAYSTACK_BACKEND_URL', defaultValue: '');

  static String get stripeBackendUrl => const String.fromEnvironment('STRIPE_BACKEND_URL', defaultValue: '');

  static bool get paystackEnabled => paystackPublicKey.isNotEmpty && paystackBackendUrl.isNotEmpty;

  static bool get useMockPayments => !stripeEnabled && !paystackEnabled;

  static bool get firebaseConfigured {
    const projectId = String.fromEnvironment('FIREBASE_PROJECT_ID', defaultValue: '');
    return projectId.isNotEmpty && projectId != 'REPLACE_ME' && projectId != '...';
  }

  static bool get firebaseEnabled =>
      const bool.fromEnvironment('FIREBASE_ENABLED', defaultValue: false) || firebaseConfigured;

  static bool get useMockAuth => !firebaseEnabled;

  static String get firebaseWebApiKey => const String.fromEnvironment('FIREBASE_WEB_API_KEY', defaultValue: '');

  static String get firebaseAuthDomain => const String.fromEnvironment('FIREBASE_AUTH_DOMAIN', defaultValue: '');

  static String get firebaseProjectId => const String.fromEnvironment('FIREBASE_PROJECT_ID', defaultValue: '');

  static String get firebaseStorageBucket => const String.fromEnvironment('FIREBASE_STORAGE_BUCKET', defaultValue: '');

  static String get firebaseMessagingSenderId =>
      const String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID', defaultValue: '');

  static String get firebaseAppId => const String.fromEnvironment('FIREBASE_APP_ID', defaultValue: '');

  static String get firebaseAndroidApiKey =>
      const String.fromEnvironment('FIREBASE_ANDROID_API_KEY', defaultValue: '');

  static String get firebaseIosApiKey => const String.fromEnvironment('FIREBASE_IOS_API_KEY', defaultValue: '');

  static String get paypalClientId => const String.fromEnvironment('PAYPAL_CLIENT_ID', defaultValue: '');

  static String get flutterwavePublicKey => const String.fromEnvironment('FLUTTERWAVE_PUBLIC_KEY', defaultValue: '');

  static String get mpesaShortcode => const String.fromEnvironment('MPESA_SHORTCODE', defaultValue: '');

  static String get twilioSmsEnabled => const String.fromEnvironment('TWILIO_SMS_ENABLED', defaultValue: 'false');

  static bool get paypalEnabled => paypalClientId.isNotEmpty;

  static bool get flutterwaveEnabled => flutterwavePublicKey.isNotEmpty;

  static bool get mpesaEnabled => mpesaShortcode.isNotEmpty;

  static bool get notificationsSmsFallback => twilioSmsEnabled == 'true';

  static bool get googleMapsDirections => mapsEnabled;

  /// Local OTP mailer — `python3 backend/admin_otp_server.py` (default port 8788).
  static String get adminOtpApiUrl => const String.fromEnvironment(
        'ADMIN_OTP_API_URL',
        defaultValue: 'http://127.0.0.1:8788',
      );
}
