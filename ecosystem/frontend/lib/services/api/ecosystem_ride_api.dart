import 'package:my_ride/core/api/api_client.dart';

/// FastAPI ride helpers for the My Ride SA ecosystem backend.
class EcosystemRideApi {
  EcosystemRideApi({ApiClient? client}) : _client = client ?? ApiClient();

  final ApiClient _client;

  Future<Map<String, dynamic>> bookWithAi({
    required String riderId,
    required double pickupLat,
    required double pickupLng,
    required double dropoffLat,
    required double dropoffLng,
    String? pickupAddress,
    String? dropoffAddress,
    String vehicleType = 'standard',
  }) {
    return _client.postJson('/ai/book', {
      'rider_id': riderId,
      'pickup': {'lat': pickupLat, 'lng': pickupLng},
      'dropoff': {'lat': dropoffLat, 'lng': dropoffLng},
      'pickup_address': pickupAddress,
      'dropoff_address': dropoffAddress,
      'vehicle_type': vehicleType,
      'top_n': 3,
    });
  }

  Future<Map<String, dynamic>> history() => _client.getJson('/rides/history');

  Future<Map<String, dynamic>> suggestions() => _client.getJson('/ai/suggestions');

  Future<Map<String, dynamic>> schedule({
    required String riderId,
    required double pickupLat,
    required double pickupLng,
    required double dropoffLat,
    required double dropoffLng,
    required String scheduledForIso,
    String vehicleType = 'standard',
  }) {
    return _client.postJson('/rides/schedule', {
      'rider_id': riderId,
      'pickup': {'lat': pickupLat, 'lng': pickupLng},
      'dropoff': {'lat': dropoffLat, 'lng': dropoffLng},
      'scheduled_for': scheduledForIso,
      'vehicle_type': vehicleType,
    });
  }

  Future<Map<String, dynamic>> rateTrip({
    required String tripId,
    required int rating,
    String? comment,
    String fromRole = 'rider',
  }) {
    return _client.postJson('/rides/rate', {
      'trip_id': tripId,
      'rating': rating,
      'comment': comment,
      'from_role': fromRole,
    });
  }
}
