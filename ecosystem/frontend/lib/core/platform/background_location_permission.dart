import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

/// Web-safe wrapper for driver background ("Allow all the time") location.
///
/// `permission_handler` throws on web for [Permission.locationAlways] — Chrome
/// driver builds must skip it and treat background as granted for local dev.
abstract final class BackgroundLocationPermission {
  BackgroundLocationPermission._();

  /// Background location APIs exist only on Android/iOS native targets.
  static bool get isSupported => !kIsWeb;

  static Future<bool> isGranted() async {
    if (!isSupported) return true;
    try {
      return await Permission.locationAlways.isGranted;
    } catch (e) {
      if (kDebugMode) debugPrint('[My Ride] background location check: $e');
      return false;
    }
  }

  static Future<PermissionStatus> status() async {
    if (!isSupported) return PermissionStatus.granted;
    try {
      return await Permission.locationAlways.status;
    } catch (e) {
      if (kDebugMode) debugPrint('[My Ride] background location status: $e');
      return PermissionStatus.denied;
    }
  }

  static Future<PermissionStatus> request() async {
    if (!isSupported) {
      if (kDebugMode) {
        debugPrint('[My Ride] Web dev: skipping locationAlways (not supported on web)');
      }
      return PermissionStatus.granted;
    }
    try {
      return await Permission.locationAlways.request();
    } catch (e) {
      if (kDebugMode) debugPrint('[My Ride] background location request: $e');
      return PermissionStatus.denied;
    }
  }
}

/// Safe foreground location request (web may deny or throw).
Future<PermissionStatus> requestForegroundLocationPermission() async {
  try {
    return await Permission.location.request();
  } catch (e) {
    if (kDebugMode) debugPrint('[My Ride] foreground location request: $e');
    return kIsWeb ? PermissionStatus.granted : PermissionStatus.denied;
  }
}

/// Safe notification permission request.
Future<PermissionStatus> requestNotificationPermission() async {
  try {
    return await Permission.notification.request();
  } catch (e) {
    if (kDebugMode) debugPrint('[My Ride] notification request: $e');
    return kIsWeb ? PermissionStatus.granted : PermissionStatus.denied;
  }
}
