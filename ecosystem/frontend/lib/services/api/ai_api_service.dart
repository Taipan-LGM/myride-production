import 'package:my_ride/core/api/api_client.dart';
import 'package:my_ride/models/api_models.dart';

class AiApiService {
  AiApiService({ApiClient? client}) : _client = client ?? ApiClient();
  final ApiClient _client;

  Future<AiParseResponse> parse({
    required String text,
    String? userId,
    String channel = 'text',
  }) async {
    final json = await _client.postJson('/ai/parse', {
      'text': text,
      'user_id': userId,
      'channel': channel,
    });
    return AiParseResponse.fromJson(json);
  }
}
