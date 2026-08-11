import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/bootstrap.dart';
import 'package:my_ride/config/app_flavor.dart';
import 'package:my_ride/core/error/global_error_handler.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/services/auth_session_service.dart';
import 'package:my_ride/widgets/driver/driver_root_app.dart';

final _navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  GlobalErrorHandler.runGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();
    await GlobalErrorHandler.install(key: _navigatorKey);
    await AppSettingsService.instance.init();
    await initializeAppServices(AppFlavor.driver);

    final container = ProviderContainer();
    try {
      final user = await AuthSessionService.restore();
      if (user != null && user.profileComplete) {
        container.read(authProvider.notifier).setUser(user);
      }
    } catch (_) {
      // Secure storage may be unavailable on some web targets — continue unauthenticated.
    }

    runApp(
      UncontrolledProviderScope(
        container: container,
        child: DriverRootApp(navigatorKey: _navigatorKey),
      ),
    );
  });
}
