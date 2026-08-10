class GeoPoint {
  const GeoPoint({required this.lat, required this.lng});
  final double lat;
  final double lng;

  Map<String, dynamic> toJson() => {'lat': lat, 'lng': lng};

  factory GeoPoint.fromJson(Map<String, dynamic> json) => GeoPoint(
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
      );
}

enum TripStatus {
  requested,
  driverAssigned,
  driverArriving,
  inProgress,
  completed,
  cancelled;

  static TripStatus fromApi(String value) => switch (value) {
        'requested' => TripStatus.requested,
        'driver_assigned' => TripStatus.driverAssigned,
        'driver_arriving' => TripStatus.driverArriving,
        'in_progress' => TripStatus.inProgress,
        'completed' => TripStatus.completed,
        'cancelled' => TripStatus.cancelled,
        _ => TripStatus.requested,
      };

  String get apiValue => switch (this) {
        TripStatus.requested => 'requested',
        TripStatus.driverAssigned => 'driver_assigned',
        TripStatus.driverArriving => 'driver_arriving',
        TripStatus.inProgress => 'in_progress',
        TripStatus.completed => 'completed',
        TripStatus.cancelled => 'cancelled',
      };

  String get label => switch (this) {
        TripStatus.requested => 'Requested',
        TripStatus.driverAssigned => 'Driver assigned',
        TripStatus.driverArriving => 'Driver arriving',
        TripStatus.inProgress => 'On trip',
        TripStatus.completed => 'Completed',
        TripStatus.cancelled => 'Cancelled',
      };
}

enum PaymentStatus { pending, authorized, captured, refunded, failed }

class RiderProfile {
  const RiderProfile({required this.id, required this.name, this.phone, this.email});
  final String id;
  final String name;
  final String? phone;
  final String? email;

  factory RiderProfile.fromJson(Map<String, dynamic> json) => RiderProfile(
        id: json['id'] as String,
        name: json['name'] as String,
        phone: json['phone'] as String?,
        email: json['email'] as String?,
      );
}

class DriverProfile {
  const DriverProfile({
    required this.id,
    required this.name,
    required this.phone,
    this.vehicleMake,
    this.vehicleModel,
    this.vehiclePlate,
    this.location,
    this.isOnline = false,
    this.rating = 5.0,
  });

  final String id;
  final String name;
  final String phone;
  final String? vehicleMake;
  final String? vehicleModel;
  final String? vehiclePlate;
  final GeoPoint? location;
  final bool isOnline;
  final double rating;

  factory DriverProfile.fromJson(Map<String, dynamic> json) => DriverProfile(
        id: json['id'] as String,
        name: json['name'] as String,
        phone: json['phone'] as String,
        vehicleMake: json['vehicle_make'] as String?,
        vehicleModel: json['vehicle_model'] as String?,
        vehiclePlate: json['vehicle_plate'] as String?,
        location: json['location'] != null ? GeoPoint.fromJson(json['location'] as Map<String, dynamic>) : null,
        isOnline: json['is_online'] as bool? ?? false,
        rating: (json['rating'] as num?)?.toDouble() ?? 5.0,
      );

  String get vehicleLabel {
    final parts = [vehicleMake, vehicleModel].whereType<String>().where((s) => s.isNotEmpty);
    return parts.isEmpty ? 'Vehicle' : parts.join(' ');
  }
}

class Trip {
  const Trip({
    required this.id,
    required this.riderId,
    required this.status,
    required this.pickup,
    required this.dropoff,
    this.driverId,
    this.pickupAddress,
    this.dropoffAddress,
    this.fareEstimateCents,
    this.fareFinalCents,
    this.currency = 'usd',
    this.paymentIntentId,
  });

  final String id;
  final String riderId;
  final String? driverId;
  final TripStatus status;
  final GeoPoint pickup;
  final GeoPoint dropoff;
  final String? pickupAddress;
  final String? dropoffAddress;
  final int? fareEstimateCents;
  final int? fareFinalCents;
  final String currency;
  final String? paymentIntentId;

  factory Trip.fromJson(Map<String, dynamic> json) => Trip(
        id: json['id'] as String,
        riderId: json['rider_id'] as String,
        driverId: json['driver_id'] as String?,
        status: TripStatus.fromApi(json['status'] as String? ?? 'requested'),
        pickup: GeoPoint.fromJson(json['pickup'] as Map<String, dynamic>),
        dropoff: GeoPoint.fromJson(json['dropoff'] as Map<String, dynamic>),
        pickupAddress: json['pickup_address'] as String?,
        dropoffAddress: json['dropoff_address'] as String?,
        fareEstimateCents: (json['fare_estimate_cents'] as num?)?.toInt(),
        fareFinalCents: (json['fare_final_cents'] as num?)?.toInt(),
        currency: json['currency'] as String? ?? 'usd',
        paymentIntentId: json['payment_intent_id'] as String?,
      );

  double? get fareEstimate => fareEstimateCents == null ? null : fareEstimateCents! / 100;
}

class NearbyDriver {
  const NearbyDriver({required this.driver, required this.distanceKm});
  final DriverProfile driver;
  final double distanceKm;

  factory NearbyDriver.fromJson(Map<String, dynamic> json) => NearbyDriver(
        driver: DriverProfile.fromJson(json['driver'] as Map<String, dynamic>),
        distanceKm: (json['distance_km'] as num).toDouble(),
      );
}

class AiParseResponse {
  const AiParseResponse({
    required this.intent,
    required this.confidence,
    this.reply,
    this.entities = const {},
    this.suggestedPickup,
    this.suggestedDropoff,
  });

  final String intent;
  final double confidence;
  final String? reply;
  final Map<String, dynamic> entities;
  final String? suggestedPickup;
  final String? suggestedDropoff;

  factory AiParseResponse.fromJson(Map<String, dynamic> json) {
    final suggested = json['suggested_trip'] as Map<String, dynamic>?;
    return AiParseResponse(
      intent: json['intent'] as String? ?? 'unknown',
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      reply: json['reply'] as String?,
      entities: (json['entities'] as Map<String, dynamic>?) ?? {},
      suggestedPickup: suggested?['pickup_address'] as String?,
      suggestedDropoff: suggested?['dropoff_address'] as String?,
    );
  }
}

class ChatMessage {
  const ChatMessage({
    required this.text,
    required this.isUser,
    required this.timestamp,
    this.intent,
  });

  final String text;
  final bool isUser;
  final DateTime timestamp;
  final String? intent;
}

class TripWsEvent {
  const TripWsEvent({required this.type, this.tripId, this.payload = const {}});
  final String type;
  final String? tripId;
  final Map<String, dynamic> payload;

  factory TripWsEvent.fromJson(Map<String, dynamic> json) => TripWsEvent(
        type: json['type'] as String? ?? 'event',
        tripId: json['trip_id'] as String?,
        payload: (json['payload'] as Map<String, dynamic>?) ?? {},
      );
}
