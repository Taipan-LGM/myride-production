import 'package:flutter/foundation.dart';
import 'package:location/location.dart';
import 'package:my_ride/services/driver_notification_service.dart';

/// Android foreground service notification while driver is online in background.
///
/// Notification: "My Ride Driver — You are online and receiving ride requests"
abstract final class DriverBackgroundService {
  DriverBackgroundService._();

  static final Location _location = Location();
  static bool _running = false;

  static bool get isRunning => _running;

  static Future<bool> startOnlineTracking() async {
    if (kIsWeb) return false;

    try {
      // Channel must exist before location plugin starts foreground service (Android 8+).
      await DriverNotificationService.init();

      final serviceEnabled = await _location.serviceEnabled();
      if (!serviceEnabled) {
        final requested = await _location.requestService();
        if (!requested) return false;
      }

      await _location.changeNotificationOptions(
        channelName: DriverNotificationService.channelId,
        title: 'My Ride Driver',
        subtitle: 'You are online and receiving ride requests',
        description: 'My Ride driver foreground location service',
        onTapBringToFront: true,
      );

      final enabled = await _location.enableBackgroundMode(enable: true);
      _running = enabled;
      if (kDebugMode) {
        debugPrint('[DriverBackgroundService] foreground service started: $enabled');
      }
      return enabled;
    } catch (e, st) {
      if (kDebugMode) {
        debugPrint('[DriverBackgroundService] start failed: $e');
        debugPrint('$st');
      }
      _running = false;
      return false;
    }
  }

  static Future<void> stopOnlineTracking() async {
    if (kIsWeb) return;

    try {
      await _location.enableBackgroundMode(enable: false);
    } catch (e) {
      if (kDebugMode) debugPrint('[DriverBackgroundService] stop failed: $e');
    }
    _running = false;
  }
}
