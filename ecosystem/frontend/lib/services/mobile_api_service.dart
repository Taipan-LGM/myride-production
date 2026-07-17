import 'package:my_ride/core/api/api_client.dart';
import 'package:my_ride/models/api_models.dart';

/// Mobile app API — compatibility endpoints for production Flutter flows.
class MobileApiService {
  MobileApiService({ApiClient? client}) : _client = client ?? ApiClient();
  final ApiClient _client;

  Future<Map<String, dynamic>> createPaymentIntent({
    required int amountCents,
    required String riderId,
    String? tripId,
    String currency = 'zar',
  }) =>
      _client.postJson('/create-payment-intent', {
        'amount_cents': amountCents,
        'rider_id': riderId,
        if (tripId != null) 'trip_id': tripId,
        'currency': currency,
      });

  Future<Map<String, dynamic>> fareEstimate({
    required GeoPoint pickup,
    required GeoPoint dropoff,
    double surgeMultiplier = 1.0,
  }) =>
      _client.postJson('/fare-estimate', {
        'pickup': pickup.toJson(),
        'dropoff': dropoff.toJson(),
        'surge_multiplier': surgeMultiplier,
      });

  Future<Trip> requestRide({
    required String riderId,
    required GeoPoint pickup,
    required GeoPoint dropoff,
    String? pickupAddress,
    String? dropoffAddress,
    String? paymentIntentId,
    int? fareEstimateCents,
    double? distanceKm,
    int? durationMinutes,
    double surgeMultiplier = 1.0,
  }) async {
    final json = await _client.postJson('/request-ride', {
      'rider_id': riderId,
      'pickup': pickup.toJson(),
      'dropoff': dropoff.toJson(),
      if (pickupAddress != null) 'pickup_address': pickupAddress,
      if (dropoffAddress != null) 'dropoff_address': dropoffAddress,
      if (paymentIntentId != null) 'payment_intent_id': paymentIntentId,
      if (fareEstimateCents != null) 'fare_estimate_cents': fareEstimateCents,
      if (distanceKm != null) 'distance_km': distanceKm,
      if (durationMinutes != null) 'duration_minutes': durationMinutes,
      'surge_multiplier': surgeMultiplier,
    });
    return Trip.fromJson(json);
  }

  Future<Trip> cancelRide(String tripId) async {
    final json = await _client.postJson('/cancel-ride/$tripId');
    return Trip.fromJson(json);
  }

  Future<DriverProfile> updateAvailability({
    required String driverId,
    required bool isOnline,
    GeoPoint? location,
  }) async {
    final json = await _client.postJson('/driver/update-availability', {
      'driver_id': driverId,
      'is_online': isOnline,
      if (location != null) 'location': location.toJson(),
    });
    return DriverProfile.fromJson(json);
  }

  Future<Trip> acceptRide(String tripId, String driverId) async {
    final json = await _client.postJson('/accept-ride/$tripId', {'driver_id': driverId});
    return Trip.fromJson(json);
  }

  Future<void> rejectRide(String tripId, String driverId) =>
      _client.postJson('/reject-ride/$tripId', {'driver_id': driverId});

  Future<Trip> driverArrived(String tripId) async {
    final json = await _client.postJson('/driver-arrived/$tripId');
    return Trip.fromJson(json);
  }

  Future<Trip> startRide(String tripId) async {
    final json = await _client.postJson('/start-ride/$tripId');
    return Trip.fromJson(json);
  }

  Future<Trip> completeRide(String tripId) async {
    final json = await _client.postJson('/complete-ride/$tripId');
    return Trip.fromJson(json);
  }

  Future<Map<String, dynamic>> sendChatMessage({required String tripId, required String message}) =>
      _client.postJson('/chat-message', {'trip_id': tripId, 'message': message, 'sender': 'rider'});

  Future<Map<String, dynamic>> voiceWelcome() => _client.getJson('/voice/welcome');

  Future<Map<String, dynamic>> sendVoiceMessage({
    required String text,
    String? tripId,
    String? callId,
  }) =>
      _client.postJson('/voice/message', {
        'text': text,
        if (tripId != null) 'trip_id': tripId,
        if (callId != null) 'call_id': callId,
      });

  Future<Map<String, dynamic>> rateDriver({
    required String tripId,
    required String driverId,
    required int rating,
    String? comment,
  }) =>
      _client.postJson('/rate-driver', {
        'trip_id': tripId,
        'driver_id': driverId,
        'rating': rating,
        if (comment != null) 'comment': comment,
      });

  Future<List<Trip>> listTrips({String? riderId, String? driverId}) async {
    final query = <String, String>{};
    if (riderId != null) query['rider_id'] = riderId;
    if (driverId != null) query['driver_id'] = driverId;
    final path = query.isEmpty ? '/trips' : '/trips?${query.entries.map((e) => '${e.key}=${e.value}').join('&')}';
    final list = await _client.getJsonList(path);
    return list.map((e) => Trip.fromJson(e as Map<String, dynamic>)).toList();
  }
}
