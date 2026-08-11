import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/app.dart';
import 'package:my_ride/bootstrap.dart';
import 'package:my_ride/config/app_flavor.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/services/auth_session_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppSettingsService.instance.init();
  await initializeAppServices(AppFlavor.admin);
  final container = ProviderContainer();
  final user = await AuthSessionService.restore();
  if (user != null && user.profileComplete) {
    container.read(authProvider.notifier).setUser(user);
  }
  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const MyRideApp(flavor: AppFlavor.admin),
    ),
  );
}
