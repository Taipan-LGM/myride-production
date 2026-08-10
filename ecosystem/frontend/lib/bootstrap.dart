import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/config/app_flavor.dart';
import 'package:my_ride/firebase_options.dart';
import 'package:my_ride/providers/driver_provider.dart';
import 'package:my_ride/services/auth_service.dart';
import 'package:my_ride/services/chat_service.dart';
import 'package:my_ride/services/crashlytics_service.dart';
import 'package:my_ride/services/location/location_permission_storage.dart';
import 'package:my_ride/services/legacy/legacy_auth_service.dart';
import 'package:my_ride/services/location/location_service.dart';
import 'package:my_ride/services/payment_service.dart';
import 'package:my_ride/services/permission_service.dart';
import 'package:my_ride/services/driver_notification_service.dart';
import 'package:my_ride/services/push_service.dart';
import 'package:my_ride/services/trip_session_service.dart';
import 'package:my_ride/utils/mr_logger.dart';

Future<void> initializeAppServices(AppFlavor flavor) async {
  AppConfig.flavor = flavor;

  if (AppConfig.firebaseEnabled && DefaultFirebaseOptions.isConfigured) {
    try {
      await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    } catch (e) {
      if (kDebugMode) debugPrint('[My Ride] Firebase init skipped: $e');
    }
  }

  if (AppConfig.stripeEnabled) {
    try {
      Stripe.publishableKey = AppConfig.stripePublishableKey;
      await Stripe.instance.applySettings();
    } catch (e) {
      if (kDebugMode) debugPrint('[My Ride] Stripe init skipped: $e');
    }
  }

  await CrashlyticsService.instance.init();
  await AuthService.instance.init();
  await LegacyAuthService.instance.init();
  await PaymentService.instance.init();
  await PushService.instance.init();

  if (flavor == AppFlavor.driver) {
    await DriverNotificationService.init();
  }

  if (AppConfig.apiEnabled) {
    await TripSessionService.instance.bootstrap();
    ChatService.instance.seedWelcome();
  }

  // Permissions are requested from UI after runApp (see DriverPermissionSetupScreen).

  if (kDebugMode) MrLogger.hubLoaded();
}

/// Show deferred snackbar on first driver screen frame.
void showPendingBackgroundPermissionSnackbar(BuildContext context) {
  if (!PermissionService.pendingBackgroundSnackbar) return;
  PermissionService.consumePendingBackgroundSnackbar();

  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      const SnackBar(
        content: Text(PermissionService.backgroundDeniedSnackbarMessage),
        duration: Duration(seconds: 5),
        behavior: SnackBarBehavior.floating,
      ),
    );
}

/// Sync stored permission into Riverpod [driverProvider] on driver home mount.
Future<void> syncDriverBackgroundPermissionToProvider(WidgetRef ref) async {
  final stored = await LocationPermissionStorage.loadState();
  var state = stored;

  if (stored == BackgroundPermissionState.pending) {
    final granted = await LocationService.instance.checkBackgroundPermission();
    state = granted ? BackgroundPermissionState.granted : BackgroundPermissionState.denied;
    await LocationPermissionStorage.saveState(state);
  }

  ref.read(driverProvider.notifier).setBackgroundPermission(state);
}
