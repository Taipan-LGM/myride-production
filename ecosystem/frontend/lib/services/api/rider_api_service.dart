import 'package:my_ride/core/api/api_client.dart';
import 'package:my_ride/models/api_models.dart';

class RiderApiService {
  RiderApiService({ApiClient? client}) : _client = client ?? ApiClient();
  final ApiClient _client;

  Future<RiderProfile> createRider(Map<String, dynamic> body) async {
    final json = await _client.postJson('/riders', body);
    return RiderProfile.fromJson(json);
  }
}
