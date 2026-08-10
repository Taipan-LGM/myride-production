import 'package:my_ride/services/app_settings_service.dart';

enum RideTier { economy, comfort, premium }

extension RideTierX on RideTier {
  String labelFor(String languageCode) => switch (this) {
        RideTier.economy => languageCode == 'af' ? 'Ekonomie' : 'Economy',
        RideTier.comfort => languageCode == 'af' ? 'Gemak' : 'Comfort',
        RideTier.premium => 'Premium',
      };

  String get label => labelFor('en');

  String get eta => switch (this) {
        RideTier.economy => '3 min',
        RideTier.comfort => '5 min',
        RideTier.premium => '8 min',
      };

  double get baseFare => switch (this) {
        RideTier.economy => 12.50,
        RideTier.comfort => 18.00,
        RideTier.premium => 28.50,
      };

  String get fareFormatted => AppSettingsService.instance.formatFromUsd(baseFare);
}

class ScheduledRide {
  const ScheduledRide({required this.when, required this.route, required this.tier});
  final String when;
  final String route;
  final RideTier tier;
}

class EarningsZone {
  const EarningsZone({required this.name, required this.multiplier, required this.color});
  final String name;
  final String multiplier;
  final int color;
}

class DriverDocument {
  const DriverDocument({required this.name, required this.status, required this.uploaded});
  final String name;
  final String status;
  final bool uploaded;
}

class AdminUser {
  const AdminUser({required this.name, required this.role, required this.status, required this.trips});
  final String name;
  final String role;
  final String status;
  final int trips;
}

class DisputeCase {
  const DisputeCase({required this.id, required this.summary, required this.priority});
  final String id;
  final String summary;
  final String priority;
}

class PromoCode {
  const PromoCode({required this.code, required this.discount, required this.uses, required this.active});
  final String code;
  final String discount;
  final int uses;
  final bool active;
}

class OnboardingDriver {
  const OnboardingDriver({required this.name, required this.stage, required this.progress});
  final String name;
  final String stage;
  final double progress;
}
