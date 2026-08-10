import 'package:flutter/foundation.dart';

/// Structured console output aligned with HTML showcase behavior.
abstract final class MrLogger {
  static void hubLoaded() => _log('Ecosystem hub loaded');
  static void riderTripActive({required String eta}) => _log('Rider live trip · ETA $eta');
  static void riderEtaTick({required String eta}) => _log('Rider ETA update → $eta');
  static void driverOnline() => _log('Driver status · Online');
  static void driverEarningsTick({required int dollars}) => _log('Driver earnings tick → \$$dollars');
  static void driverRequest({required String timer}) => _log('Driver new request · $timer');
  static void adminKpiUpdate({required int rides, required int drivers}) =>
      _log('Admin KPI update · rides=$rides drivers=$drivers');
  static void adminActivity(String event) => _log('Activity: $event');
  static void screenOpen(String name) => _log('Screen open · $name');

  static void _log(String message) {
    if (kDebugMode) {
      // ignore: avoid_print
      print('[My Ride] $message');
    }
  }
}
