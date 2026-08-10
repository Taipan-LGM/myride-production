import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:my_ride/services/crashlytics_service.dart';
import 'package:my_ride/widgets/common/mr_error_snackbar.dart';

/// Catches Flutter framework errors, platform dispatcher errors, and zone errors.
class GlobalErrorHandler {
  GlobalErrorHandler._();

  static GlobalKey<NavigatorState>? navigatorKey;

  static Future<void> install({GlobalKey<NavigatorState>? key}) async {
    navigatorKey = key;
    await CrashlyticsService.instance.init();

    FlutterError.onError = (details) {
      FlutterError.presentError(details);
      CrashlyticsService.instance.recordError(details.exception, details.stack ?? StackTrace.current, fatal: true);
    };

    PlatformDispatcher.instance.onError = (error, stack) {
      CrashlyticsService.instance.recordError(error, stack, fatal: true);
      return true;
    };
  }

  /// Wrap `main()` body to catch async errors outside Flutter framework.
  static void runGuarded(Future<void> Function() appMain) {
    runZonedGuarded(
      () async => appMain(),
      (error, stack) {
        CrashlyticsService.instance.recordError(error, stack, fatal: false);
        final ctx = navigatorKey?.currentContext;
        if (ctx != null && ctx.mounted) {
          MrErrorSnackbar.show(ctx, error.toString());
        }
      },
    );
  }
}
