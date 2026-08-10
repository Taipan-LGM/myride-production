import 'dart:async';

import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:my_ride/config/app_config.dart';

/// Wraps Firebase Crashlytics — no-ops on web or when Firebase is disabled.
class CrashlyticsService {
  CrashlyticsService._();
  static final CrashlyticsService instance = CrashlyticsService._();

  bool get _enabled => AppConfig.firebaseEnabled && !kIsWeb;

  Future<void> init() async {
    if (!_enabled) return;
    await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(true);
  }

  Future<void> recordError(Object error, StackTrace stack, {bool fatal = false}) async {
    if (kDebugMode) debugPrint('[Crashlytics] $error\n$stack');
    if (!_enabled) return;
    await FirebaseCrashlytics.instance.recordError(error, stack, fatal: fatal);
  }

  Future<void> log(String message) async {
    if (!_enabled) return;
    await FirebaseCrashlytics.instance.log(message);
  }

  void setUserId(String id) {
    if (!_enabled) return;
    FirebaseCrashlytics.instance.setUserIdentifier(id);
  }
}
