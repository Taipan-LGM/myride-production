import 'package:my_ride/providers/driver_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists background location permission status for offline checks at startup.
abstract final class LocationPermissionStorage {
  LocationPermissionStorage._();

  static const _stateKey = 'background_location_permission_state';
  static const _grantedKey = 'background_location_granted';

  static Future<void> saveState(BackgroundPermissionState state) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_stateKey, state.name);
    await prefs.setBool(_grantedKey, state == BackgroundPermissionState.granted);
  }

  static Future<BackgroundPermissionState> loadState() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_stateKey);
    if (raw == null) return BackgroundPermissionState.pending;
    return BackgroundPermissionState.values.firstWhere(
      (s) => s.name == raw,
      orElse: () => BackgroundPermissionState.pending,
    );
  }

  static Future<bool> loadGranted() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_grantedKey) ?? false;
  }
}
