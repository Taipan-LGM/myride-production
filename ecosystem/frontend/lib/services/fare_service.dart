import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:my_ride/models/ride_models.dart';
import 'package:my_ride/services/app_settings_service.dart';

/// Predictive fare lock — My Ride differentiator vs surge opacity (5 min lock).
class FareService extends ChangeNotifier {
  FareService._() {
    AppSettingsService.instance.addListener(notifyListeners);
  }
  static final FareService instance = FareService._();

  RideTier _tier = RideTier.comfort;
  DateTime? _lockedUntil;
  Timer? _lockTimer;

  RideTier get tier => _tier;
  bool get isLocked => _lockedUntil != null && DateTime.now().isBefore(_lockedUntil!);

  String get lockedFare => _tier.fareFormatted;

  int get lockSecondsRemaining {
    if (!isLocked || _lockedUntil == null) return 0;
    return _lockedUntil!.difference(DateTime.now()).inSeconds.clamp(0, 300);
  }

  String get lockCountdown {
    final s = lockSecondsRemaining;
    return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
  }

  void selectTier(RideTier tier) {
    _tier = tier;
    notifyListeners();
  }

  void lockFare() {
    _lockedUntil = DateTime.now().add(const Duration(minutes: 5));
    _lockTimer?.cancel();
    _lockTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!isLocked) {
        _lockTimer?.cancel();
      }
      notifyListeners();
    });
    notifyListeners();
  }

  double estimateFor(RideTier tier, {double distanceMi = 6.2}) {
    return tier.baseFare + (distanceMi - 5).clamp(0, 20) * 0.85;
  }
}
