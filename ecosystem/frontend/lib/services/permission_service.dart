import 'package:flutter/foundation.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/config/app_flavor.dart';
import 'package:my_ride/core/platform/background_location_permission.dart';
import 'package:my_ride/models/app_user.dart';
import 'package:my_ride/providers/driver_provider.dart';
import 'package:my_ride/services/location/location_permission_storage.dart';
import 'package:my_ride/services/location/location_service.dart';
import 'package:my_ride/services/secure_storage_service.dart';
import 'package:permission_handler/permission_handler.dart';

/// Shared permission requests used at startup and by Riverpod providers.
abstract final class PermissionService {
  PermissionService._();

  static bool backgroundLocationDenied = false;
  static bool pendingBackgroundSnackbar = false;

  static const backgroundDeniedSnackbarMessage =
      'Background location denied. Choose "Allow all the time" to receive rides when the app is in the background.';

  static Future<bool> requestForegroundLocation() async {
    final status = await requestForegroundLocationPermission();
    if (!status.isGranted && kDebugMode) {
      debugPrint('⚠️ Foreground location permission denied');
    }
    return status.isGranted || kIsWeb;
  }

  static Future<bool> requestNotification() async {
    final status = await requestNotificationPermission();
    if (status.isGranted && kDebugMode) {
      debugPrint('✅ Notification permission granted');
    }
    return status.isGranted;
  }

  /// Foreground + driver-only background + notifications.
  static Future<bool> requestAll({UserRole? role, AppFlavor? flavor}) async {
    final foreground = await requestForegroundLocation();
    if (!foreground && !kIsWeb) {
      await LocationPermissionStorage.saveState(BackgroundPermissionState.denied);
      return false;
    }

    final isDriver = _isDriverRole(role, flavor);
    if (!isDriver) {
      await requestNotification();
      return true;
    }

    return requestDriverBackground(storeOnDeny: true);
  }

  /// Driver "Allow all the time" — native only; auto-granted on web for dev.
  static Future<bool> requestDriverBackground({bool storeOnDeny = true}) async {
    if (!BackgroundLocationPermission.isSupported) {
      await LocationPermissionStorage.saveState(BackgroundPermissionState.granted);
      backgroundLocationDenied = false;
      return true;
    }

    try {
      final granted = await LocationService.instance.requestBackgroundPermission();
      backgroundLocationDenied = !granted;
      pendingBackgroundSnackbar = !granted;
      return granted;
    } on LocationBackgroundDeniedException {
      backgroundLocationDenied = true;
      if (storeOnDeny) pendingBackgroundSnackbar = true;
      if (storeOnDeny) {
        await LocationPermissionStorage.saveState(BackgroundPermissionState.denied);
      }
      if (kDebugMode) debugPrint('⚠️ Background location denied - driver features limited');
      return false;
    }
  }

  static Future<UserRole?> resolveRole({AppFlavor? flavor}) async {
    final user = await SecureStorageService.instance.loadUser();
    if (user != null) return user.role;
    return switch (flavor ?? AppConfig.flavor) {
      AppFlavor.driver => UserRole.driver,
      AppFlavor.rider => UserRole.rider,
      _ => null,
    };
  }

  static bool isDriver({UserRole? role, AppFlavor? flavor}) =>
      _isDriverRole(role, flavor ?? AppConfig.flavor);

  static void markPendingBackgroundSnackbar() => pendingBackgroundSnackbar = true;

  static void consumePendingBackgroundSnackbar() => pendingBackgroundSnackbar = false;

  static bool _isDriverRole(UserRole? role, AppFlavor? flavor) {
    if (role == UserRole.driver) return true;
    return flavor == AppFlavor.driver;
  }
}
