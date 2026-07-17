import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:my_ride/config/app_config.dart';

/// FCM for trip events: driver assigned, arriving, receipt, driver requests.
class PushService {
  PushService._();
  static final PushService instance = PushService._();

  String? _token;
  String? get token => _token;

  final ValueNotifier<String?> lastMessage = ValueNotifier<String?>(null);

  Future<void> init() async {
    if (!AppConfig.firebaseEnabled) return;

    final messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);
    if (kDebugMode) debugPrint('[My Ride] FCM permission: ${settings.authorizationStatus}');

    _token = await messaging.getToken();
    if (kDebugMode) debugPrint('[My Ride] FCM token: $_token');

    FirebaseMessaging.onMessage.listen((message) {
      final body = message.notification?.body ?? message.data['body']?.toString();
      lastMessage.value = body;
      if (kDebugMode) debugPrint('[My Ride] FCM foreground: $body');
    });

    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      final type = message.data['type'];
      if (kDebugMode) debugPrint('[My Ride] FCM opened: type=$type');
    });
  }

  /// Subscribe to rider or driver topics after login.
  Future<void> subscribeForFlavor() async {
    if (!AppConfig.firebaseEnabled) return;
    final topic = switch (AppConfig.flavor.name) {
      'driver' => 'drivers',
      'rider' => 'riders',
      _ => 'dev',
    };
    await FirebaseMessaging.instance.subscribeToTopic(topic);
  }

  /// Trip lifecycle helpers (server should send matching data payloads).
  static const tripAssigned = 'trip_assigned';
  static const driverArriving = 'driver_arriving';
  static const tripComplete = 'trip_complete';
  static const newRideRequest = 'new_ride_request';
}
