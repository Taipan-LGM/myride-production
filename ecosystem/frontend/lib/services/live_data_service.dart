import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/utils/mr_logger.dart';

/// Mirrors HTML showcase live data intervals (rider ETA, driver earnings, admin KPIs).
class LiveDataService extends ChangeNotifier {
  LiveDataService._() {
    AppSettingsService.instance.addListener(_onRegionalSettingsChanged);
  }
  static final LiveDataService instance = LiveDataService._();

  final _rng = Random();
  Timer? _riderTimer;
  Timer? _driverTimer;
  Timer? _adminTimer;

  int etaSeconds = 272; // 4:32
  int driverEarnings = 247;
  int activeRides = 1284;
  int driversOnline = 892;
  final List<String> activityFeed = [];
  int _activityIndex = 0;

  static const _paymentAmountsUsd = [24.50, 18.00, 32.75, 14.20];
  static const _staticActivityEvents = [
    'New ride requested · Downtown',
    'Driver #442 went online',
    null, // payment — formatted at runtime
    'Surge activated · Airport zone',
    'Ride #MR-9279 completed',
  ];

  void _onRegionalSettingsChanged() {
    activityFeed.clear();
    notifyListeners();
  }

  String _nextActivityEvent() {
    final template = _staticActivityEvents[_activityIndex % _staticActivityEvents.length];
    _activityIndex++;
    if (template == null) {
      final usd = _paymentAmountsUsd[_rng.nextInt(_paymentAmountsUsd.length)];
      return 'Payment ${AppSettingsService.instance.formatFromUsd(usd)} captured';
    }
    return template;
  }

  /// Fallback feed when the live timer has not emitted yet.
  List<String> previewActivityFeed() {
    final fmt = AppSettingsService.instance.formatFromUsd;
    return [
      'New ride requested · Downtown',
      'Driver #442 went online',
      'Payment ${fmt(24.50)} captured',
    ];
  }

  String get etaFormatted {
    final m = etaSeconds ~/ 60;
    final s = etaSeconds % 60;
    return '$m:${s.toString().padLeft(2, '0')}';
  }

  void startRiderLive() {
    _riderTimer?.cancel();
    MrLogger.riderTripActive(eta: etaFormatted);
    _riderTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (etaSeconds > 0) etaSeconds--;
      notifyListeners();
      if (etaSeconds % 10 == 0) MrLogger.riderEtaTick(eta: etaFormatted);
    });
  }

  void stopRiderLive() => _riderTimer?.cancel();

  void startDriverLive() {
    _driverTimer?.cancel();
    MrLogger.driverOnline();
    _driverTimer = Timer.periodic(const Duration(milliseconds: 2200), (_) {
      if (_rng.nextDouble() > 0.4) {
        driverEarnings++;
        MrLogger.driverEarningsTick(dollars: driverEarnings);
        notifyListeners();
      }
    });
  }

  void stopDriverLive() => _driverTimer?.cancel();

  void startAdminLive() {
    _adminTimer?.cancel();
    activeRides = 1284;
    driversOnline = 892;
    _adminTimer = Timer.periodic(const Duration(milliseconds: 2500), (_) {
      activeRides = 1284 + _rng.nextInt(20);
      driversOnline = 892 + _rng.nextInt(8);
      final event = _nextActivityEvent();
      activityFeed.insert(0, event);
      if (activityFeed.length > 6) activityFeed.removeLast();
      MrLogger.adminKpiUpdate(rides: activeRides, drivers: driversOnline);
      MrLogger.adminActivity(event);
      notifyListeners();
    });
  }

  void stopAdminLive() => _adminTimer?.cancel();

  @override
  void dispose() {
    AppSettingsService.instance.removeListener(_onRegionalSettingsChanged);
    _riderTimer?.cancel();
    _driverTimer?.cancel();
    _adminTimer?.cancel();
    super.dispose();
  }
}
