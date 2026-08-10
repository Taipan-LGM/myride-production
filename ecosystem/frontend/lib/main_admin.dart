import 'package:flutter/material.dart';
import 'package:my_ride/app.dart';
import 'package:my_ride/config/app_flavor.dart';
import 'package:my_ride/services/app_settings_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppSettingsService.instance.init();
  runApp(const MyRideApp(flavor: AppFlavor.admin));
}
