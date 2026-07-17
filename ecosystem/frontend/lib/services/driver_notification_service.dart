import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Android notification channel for the driver online foreground service.
abstract final class DriverNotificationService {
  DriverNotificationService._();

  static const channelId = 'my_ride_driver_channel';
  static const channelName = 'My Ride Driver Service';

  static final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  static Future<void> init() async {
    if (kIsWeb || _ready) return;

    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    await _plugin.initialize(const InitializationSettings(android: androidInit));

    await _createNotificationChannel();
    _ready = true;
    if (kDebugMode) debugPrint('[DriverNotificationService] channel "$channelId" ready');
  }

  static Future<void> _createNotificationChannel() async {
    if (kIsWeb) return;

    const channel = AndroidNotificationChannel(
      channelId,
      channelName,
      description: 'Shows when you are online as a My Ride driver',
      importance: Importance.high,
      showBadge: true,
      enableLights: true,
      enableVibration: true,
    );

    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);
  }
}
