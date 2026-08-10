import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/config/app_flavor.dart';
import 'package:my_ride/l10n/app_localizations.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/router/app_router.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/services/legacy/legacy_auth_service.dart';
import 'package:my_ride/services/secure_storage_service.dart';
import 'package:my_ride/theme/mr_theme.dart';

final _routerProvider = Provider<GoRouter>((ref) {
  final router = createAppRouter(AppConfigHolder.flavor, ref);
  ref.listen(authProvider, (_, __) => router.refresh());
  return router;
});

/// Holds flavor for router provider (set before runApp).
class AppConfigHolder {
  static AppFlavor flavor = AppFlavor.rider;
}

class MyRideApp extends ConsumerWidget {
  const MyRideApp({super.key, this.flavor = AppFlavor.rider, this.navigatorKey});

  final AppFlavor flavor;
  final GlobalKey<NavigatorState>? navigatorKey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    AppConfigHolder.flavor = flavor;
    final router = ref.watch(_routerProvider);
    final settings = AppSettingsService.instance;

    return AnimatedBuilder(
      animation: settings,
      builder: (context, _) {
        return ScreenUtilInit(
          designSize: const Size(375, 812),
          minTextAdapt: true,
          builder: (_, __) => MaterialApp.router(
            key: ValueKey('${settings.themeMode.name}_${settings.locale.languageCode}'),
            title: 'My Ride',
            debugShowCheckedModeBanner: false,
            theme: myRideTheme(),
            darkTheme: myRideDarkTheme(),
            themeMode: settings.themeMode,
            locale: settings.locale,
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            routerConfig: router,
          ),
        );
      },
    );
  }
}

/// Restore session from secure storage on cold start.
Future<void> restoreAuthSession(WidgetRef ref) async {
  await LegacyAuthService.instance.init();
  final user = await SecureStorageService.instance.loadUser();
  if (user == null || !user.profileComplete) return;
  if (AppConfig.legacyBackend && !LegacyAuthService.instance.isAuthenticated) {
    await LegacyAuthService.instance.clear();
    return;
  }
  ref.read(authProvider.notifier).setUser(user);
}
