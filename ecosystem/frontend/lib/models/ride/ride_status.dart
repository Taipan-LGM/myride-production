enum RideStatus {
  requested,
  searching,
  matched,
  accepted,
  arriving,
  inProgress,
  completed,
  cancelled,
  declined,
}

extension RideStatusExtension on RideStatus {
  String get value => switch (this) {
        RideStatus.requested => 'requested',
        RideStatus.searching => 'searching',
        RideStatus.matched => 'matched',
        RideStatus.accepted => 'accepted',
        RideStatus.arriving => 'arriving',
        RideStatus.inProgress => 'in_progress',
        RideStatus.completed => 'completed',
        RideStatus.cancelled => 'cancelled',
        RideStatus.declined => 'declined',
      };

  static RideStatus fromString(String value) => switch (value) {
        'requested' => RideStatus.requested,
        'searching' => RideStatus.searching,
        'matched' => RideStatus.matched,
        'accepted' => RideStatus.accepted,
        'arriving' => RideStatus.arriving,
        'in_progress' => RideStatus.inProgress,
        'completed' => RideStatus.completed,
        'cancelled' => RideStatus.cancelled,
        'declined' => RideStatus.declined,
        _ => RideStatus.searching,
      };

  bool get isActive =>
      this == RideStatus.matched ||
      this == RideStatus.accepted ||
      this == RideStatus.arriving ||
      this == RideStatus.inProgress;

  bool get isTerminal =>
      this == RideStatus.completed ||
      this == RideStatus.cancelled ||
      this == RideStatus.declined;
}

class MatchedDriver {
  const MatchedDriver({
    required this.id,
    required this.name,
    this.phone,
    required this.rating,
    required this.vehicle,
    required this.location,
    this.etaToPickup,
  });

  final String id;
  final String name;
  final String? phone;
  final double rating;
  final Map<String, dynamic> vehicle;
  final Map<String, dynamic> location;
  final int? etaToPickup;

  factory MatchedDriver.fromJson(Map<String, dynamic> json) => MatchedDriver(
        id: json['id']?.toString() ?? '',
        name: json['name'] as String? ?? 'Driver',
        phone: json['phone'] as String?,
        rating: (json['rating'] as num?)?.toDouble() ?? 0,
        vehicle: (json['vehicle'] as Map<String, dynamic>?) ?? const {},
        location: (json['location'] as Map<String, dynamic>?) ?? const {},
        etaToPickup: (json['eta_to_pickup'] as num?)?.round(),
      );
}

class RideStatusUpdate {
  const RideStatusUpdate({
    required this.rideId,
    required this.status,
    required this.updatedAt,
    this.driver,
    this.reason,
    this.rawRide,
  });

  final String rideId;
  final String status;
  final DateTime updatedAt;
  final MatchedDriver? driver;
  final String? reason;
  final Map<String, dynamic>? rawRide;

  RideStatus get rideStatus => RideStatusExtension.fromString(status);

  factory RideStatusUpdate.fromJson(Map<String, dynamic> json) {
    final ride = json['ride'] as Map<String, dynamic>?;
    final status = json['status'] as String? ?? ride?['status'] as String? ?? 'requested';
    final rideId = json['ride_id']?.toString() ?? ride?['id']?.toString() ?? '';

    MatchedDriver? driver;
    if (json['driver'] is Map<String, dynamic>) {
      driver = MatchedDriver.fromJson(json['driver'] as Map<String, dynamic>);
    } else if (json['matched'] is Map<String, dynamic>) {
      final m = json['matched'] as Map<String, dynamic>;
      if (m['driver'] is Map<String, dynamic>) {
        driver = MatchedDriver.fromJson(m['driver'] as Map<String, dynamic>);
      }
    }

    return RideStatusUpdate(
      rideId: rideId,
      status: status,
      updatedAt: DateTime.tryParse(
            json['updated_at'] as String? ?? ride?['updated_at'] as String? ?? '',
          ) ??
          DateTime.now(),
      driver: driver,
      reason: json['reason'] as String?,
      rawRide: ride,
    );
  }

  factory RideStatusUpdate.fromLegacyRide(Map<String, dynamic> ride) => RideStatusUpdate(
        rideId: ride['id']?.toString() ?? '',
        status: ride['status'] as String? ?? 'requested',
        updatedAt: DateTime.tryParse(ride['updated_at'] as String? ?? '') ?? DateTime.now(),
        rawRide: ride,
      );
}
