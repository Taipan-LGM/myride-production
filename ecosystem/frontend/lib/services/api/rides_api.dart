import 'package:my_ride/models/ride/nearby_driver.dart';
import 'package:my_ride/models/ride/ride_request.dart';
import 'package:my_ride/models/ride/ride_status.dart';
import 'package:my_ride/services/legacy/legacy_api_client.dart';

/// Legacy Node rides API (`/api/rides/*`).
class RidesApi {
  RidesApi({LegacyApiClient? client}) : _client = client ?? LegacyApiClient();
  final LegacyApiClient _client;

  Future<List<NearbyDriver>> getNearbyDrivers({
    required double lat,
    required double lng,
    int radius = 5000,
    int limit = 20,
    String? vehicleType,
  }) async {
    final query = <String, String>{
      'lat': lat.toString(),
      'lng': lng.toString(),
      'radius': radius.toString(),
      'limit': limit.toString(),
      if (vehicleType != null) 'vehicle_type': vehicleType,
    };

    final data = await _client.getJson('/rides/nearby', query: query);
    if (data['success'] != true) {
      throw Exception(data['error']?.toString() ?? 'nearby_failed');
    }

    final drivers = (data['data']?['drivers'] as List?) ?? const [];
    return drivers
        .map((d) => NearbyDriver.fromJson(d as Map<String, dynamic>))
        .toList();
  }

  Future<RideResponse> requestRide(RideRequest request) async {
    final data = await _client.postJson('/rides/', request.toJson());
    return RideResponse.fromLegacyJson(data);
  }

  Future<void> cancelRide(String rideId, {String? reason}) async {
    await _client.postJson('/rides/$rideId/cancel', {
      if (reason != null) 'reason': reason,
    });
  }

  Future<RideStatusUpdate?> getRide(String rideId) async {
    final data = await _client.getJson('/rides/$rideId');
    final ride = data['ride'] as Map<String, dynamic>?;
    if (ride == null) return null;
    return RideStatusUpdate.fromLegacyRide(ride);
  }

  Future<List<RideStatusUpdate>> getRideHistory({int limit = 20}) async {
    final data = await _client.getJson('/rides/mine');
    final rides = (data['rides'] as List?) ?? const [];
    return rides
        .take(limit)
        .map((r) => RideStatusUpdate.fromLegacyRide(r as Map<String, dynamic>))
        .toList();
  }

  Future<RideStatusUpdate> acceptRide(String rideId) async {
    final data = await _client.postJson('/rides/$rideId/accept');
    return RideStatusUpdate.fromLegacyRide(data['ride'] as Map<String, dynamic>);
  }

  Future<RideStatusUpdate> rejectRide(String rideId) async {
    final data = await _client.postJson('/rides/$rideId/reject');
    return RideStatusUpdate.fromLegacyRide(data['ride'] as Map<String, dynamic>);
  }

  Future<RideStatusUpdate> startRide(String rideId) async {
    final data = await _client.postJson('/rides/$rideId/start');
    return RideStatusUpdate.fromLegacyRide(data['ride'] as Map<String, dynamic>);
  }

  Future<RideStatusUpdate> completeRide(String rideId) async {
    final data = await _client.postJson('/rides/$rideId/complete');
    return RideStatusUpdate.fromLegacyRide(data['ride'] as Map<String, dynamic>);
  }
}
