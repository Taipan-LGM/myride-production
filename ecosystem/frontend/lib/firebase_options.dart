// Values injected via frontend/.env → run_rider.sh / run_driver.sh (--dart-define)
// Or run: flutterfire configure

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;
import 'package:my_ride/config/app_config.dart';

class DefaultFirebaseOptions {
  static bool get isConfigured => AppConfig.firebaseConfigured;

  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    return switch (defaultTargetPlatform) {
      TargetPlatform.android => android,
      TargetPlatform.iOS => ios,
      _ => throw UnsupportedError('Unsupported platform'),
    };
  }

  static FirebaseOptions get android => FirebaseOptions(
        apiKey: _or(AppConfig.firebaseAndroidApiKey, AppConfig.firebaseWebApiKey, 'REPLACE_ME'),
        appId: _or(AppConfig.firebaseAppId, '', 'REPLACE_ME'),
        messagingSenderId: _or(AppConfig.firebaseMessagingSenderId, '', 'REPLACE_ME'),
        projectId: _or(AppConfig.firebaseProjectId, '', 'REPLACE_ME'),
        storageBucket: _or(AppConfig.firebaseStorageBucket, '', 'REPLACE_ME'),
      );

  static FirebaseOptions get ios => FirebaseOptions(
        apiKey: _or(AppConfig.firebaseIosApiKey, AppConfig.firebaseWebApiKey, 'REPLACE_ME'),
        appId: _or(AppConfig.firebaseAppId, '', 'REPLACE_ME'),
        messagingSenderId: _or(AppConfig.firebaseMessagingSenderId, '', 'REPLACE_ME'),
        projectId: _or(AppConfig.firebaseProjectId, '', 'REPLACE_ME'),
        storageBucket: _or(AppConfig.firebaseStorageBucket, '', 'REPLACE_ME'),
        iosBundleId: 'com.myride.rider',
      );

  static FirebaseOptions get web => FirebaseOptions(
        apiKey: _or(AppConfig.firebaseWebApiKey, '', 'REPLACE_ME'),
        appId: _or(AppConfig.firebaseAppId, '', 'REPLACE_ME'),
        messagingSenderId: _or(AppConfig.firebaseMessagingSenderId, '', 'REPLACE_ME'),
        projectId: _or(AppConfig.firebaseProjectId, '', 'REPLACE_ME'),
        storageBucket: _or(AppConfig.firebaseStorageBucket, '', 'REPLACE_ME'),
        authDomain: _or(AppConfig.firebaseAuthDomain, '', 'REPLACE_ME.firebaseapp.com'),
      );

  static String _or(String primary, String fallback, String defaultValue) {
    if (primary.isNotEmpty && primary != '...') return primary;
    if (fallback.isNotEmpty && fallback != '...') return fallback;
    return defaultValue;
  }
}
