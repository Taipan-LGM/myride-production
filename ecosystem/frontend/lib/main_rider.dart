import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/app.dart';
import 'package:my_ride/bootstrap.dart';
import 'package:my_ride/config/app_flavor.dart';
import 'package:my_ride/core/error/global_error_handler.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/services/legacy/legacy_auth_service.dart';
import 'package:my_ride/services/secure_storage_service.dart';

final _navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  GlobalErrorHandler.runGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();
    await GlobalErrorHandler.install(key: _navigatorKey);
    await AppSettingsService.instance.init();
    await initializeAppServices(AppFlavor.rider);

    final container = ProviderContainer();
    final user = await SecureStorageService.instance.loadUser();
    final hasLegacyJwt = LegacyAuthService.instance.isAuthenticated;

    // Legacy Node needs a JWT. Drop mock phone-OTP sessions (no token → 401).
    if (AppConfig.legacyBackend) {
      if (user != null && user.profileComplete && hasLegacyJwt) {
        container.read(authProvider.notifier).setUser(user);
      } else if (user != null && !hasLegacyJwt) {
        await LegacyAuthService.instance.clear();
      }
    } else if (user != null && user.profileComplete) {
      container.read(authProvider.notifier).setUser(user);
      if (kDebugMode) {
        // Crashlytics user id when Firebase enabled
      }
    }

    runApp(
      UncontrolledProviderScope(
        container: container,
        child: MyRideApp(flavor: AppFlavor.rider, navigatorKey: _navigatorKey),
      ),
    );
  });
}
