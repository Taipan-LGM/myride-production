import 'package:my_ride/config/app_config.dart';

/// FastAPI backend configuration.
abstract final class ApiConfig {
  static String get baseUrl => AppConfig.apiBaseUrl;

  static Uri uri(String path, [Map<String, String>? query]) {
    final normalized = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$baseUrl$normalized').replace(queryParameters: query);
  }

  static Uri wsUri(String path) {
    final wsBase = AppConfig.websocketBaseUrl;
    final http = wsBase.isNotEmpty
        ? wsBase
        : baseUrl.replaceFirst('https://', 'wss://').replaceFirst('http://', 'ws://');
    final normalized = path.startsWith('/') ? path : '/$path';
    return Uri.parse('$http$normalized');
  }

  static const defaultRiderId = 'rider-demo-001';
  static const defaultDriverId = 'driver-demo-001';

  /// Map default — NMB when legacy, Cape Town for FastAPI demo seed.
  static double get defaultLat =>
      AppConfig.legacyBackend ? AppConfig.defaultLat : -33.9249;

  static double get defaultLng =>
      AppConfig.legacyBackend ? AppConfig.defaultLng : 18.4241;
}
