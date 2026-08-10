import 'package:my_ride/core/api/api_client.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/models/api_models.dart';

class TripApiService {
  TripApiService({ApiClient? client}) : _client = client ?? ApiClient();
  final ApiClient _client;

  Future<Trip> createTrip({
    required String riderId,
    required GeoPoint pickup,
    required GeoPoint dropoff,
    String? pickupAddress,
    String? dropoffAddress,
    int? fareEstimateCents,
    String currency = 'zar',
  }) async {
    final json = await _client.postJson('/trips', {
      'rider_id': riderId,
      'pickup': pickup.toJson(),
      'dropoff': dropoff.toJson(),
      if (pickupAddress != null) 'pickup_address': pickupAddress,
      if (dropoffAddress != null) 'dropoff_address': dropoffAddress,
      if (fareEstimateCents != null) 'fare_estimate_cents': fareEstimateCents,
      'currency': currency,
    });
    return Trip.fromJson(json);
  }

  Future<Trip> getTrip(String tripId) async {
    final json = await _client.getJson('/trips/$tripId');
    return Trip.fromJson(json);
  }

  Future<Trip> assignDriver({required String tripId, required String driverId}) async {
    final json = await _client.postJson('/trips/$tripId/assign', {'driver_id': driverId});
    return Trip.fromJson(json);
  }

  Future<Trip> updateStatus({required String tripId, required TripStatus status}) async {
    final json = await _client.postJson('/trips/$tripId/status/${status.apiValue}');
    return Trip.fromJson(json);
  }

  Future<List<NearbyDriver>> nearbyDrivers({
    GeoPoint? center,
    double radiusKm = 10,
    int limit = 5,
  }) async {
    final c = center ?? GeoPoint(lat: ApiConfig.defaultLat, lng: ApiConfig.defaultLng);
    final list = await _client.postJsonList('/drivers/nearby', {
      'center': c.toJson(),
      'radius_km': radiusKm,
      'limit': limit,
    });
    return list.map((e) => NearbyDriver.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Map<String, dynamic>> checkHealth() => _client.health();

  Future<Map<String, dynamic>> seedDemo() => _client.postJson('/dev/seed');
}
