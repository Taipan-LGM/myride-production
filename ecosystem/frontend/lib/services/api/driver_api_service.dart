import 'package:my_ride/core/api/api_client.dart';
import 'package:my_ride/models/api_models.dart';

class DriverApiService {
  DriverApiService({ApiClient? client}) : _client = client ?? ApiClient();
  final ApiClient _client;

  Future<DriverProfile> updateLocation({
    required String driverId,
    required GeoPoint location,
    required bool isOnline,
  }) async {
    final json = await _client.patchJson('/drivers/location', {
      'driver_id': driverId,
      'location': location.toJson(),
      'is_online': isOnline,
    });
    return DriverProfile.fromJson(json);
  }

  Future<DriverProfile> createDriver(Map<String, dynamic> body) async {
    final json = await _client.postJson('/drivers', body);
    return DriverProfile.fromJson(json);
  }
}
