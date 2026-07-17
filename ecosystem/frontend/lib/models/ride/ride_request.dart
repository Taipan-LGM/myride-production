/// Legacy ride create payload — maps to `POST /api/rides/`.
class RideRequest {
  const RideRequest({
    required this.pickupAddress,
    required this.pickupLat,
    required this.pickupLng,
    required this.dropoffAddress,
    required this.dropoffLat,
    required this.dropoffLng,
    required this.vehicleType,
    required this.paymentMethod,
    this.estimatedFare,
    this.promoCode,
  });

  final String pickupAddress;
  final double pickupLat;
  final double pickupLng;
  final String dropoffAddress;
  final double dropoffLat;
  final double dropoffLng;

  /// Legacy values: `Car` | `MPV`
  final String vehicleType;
  final String paymentMethod;
  final double? estimatedFare;
  final String? promoCode;

  Map<String, dynamic> toJson() => {
        'pickup_text': pickupAddress,
        'pickup_lat': pickupLat,
        'pickup_lng': pickupLng,
        'dropoff_text': dropoffAddress,
        'dropoff_lat': dropoffLat,
        'dropoff_lng': dropoffLng,
        'vehicle_type': vehicleType,
        'payment_method': paymentMethod,
      };
}

class RideResponse {
  const RideResponse({
    required this.rideId,
    required this.status,
    required this.createdAt,
    this.estimatedFareCents,
    this.rawRide,
  });

  final String rideId;
  final String status;
  final DateTime createdAt;
  final int? estimatedFareCents;
  final Map<String, dynamic>? rawRide;

  factory RideResponse.fromLegacyJson(Map<String, dynamic> json) {
    final ride = json['ride'] as Map<String, dynamic>? ?? json;
    return RideResponse(
      rideId: ride['id']?.toString() ?? '',
      status: ride['status'] as String? ?? 'requested',
      createdAt: DateTime.tryParse(ride['created_at'] as String? ?? '') ?? DateTime.now(),
      estimatedFareCents: (ride['fare_estimate_cents'] as num?)?.round(),
      rawRide: ride,
    );
  }
}
