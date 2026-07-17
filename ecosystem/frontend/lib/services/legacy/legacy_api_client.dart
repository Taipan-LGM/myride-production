import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/core/api/api_exception.dart';
import 'package:my_ride/services/legacy/legacy_auth_service.dart';

/// Authenticated HTTP client for legacy Node `/api/*` routes.
class LegacyApiClient {
  LegacyApiClient({http.Client? client, LegacyAuthService? auth})
      : _client = client ?? http.Client(),
        _auth = auth ?? LegacyAuthService.instance;

  final http.Client _client;
  final LegacyAuthService _auth;

  static Uri uri(String path, [Map<String, String>? query]) {
    final normalized = path.startsWith('/api') ? path : '/api$path';
    return Uri.parse('${AppConfig.apiBaseUrl}$normalized')
        .replace(queryParameters: query);
  }

  Future<Map<String, dynamic>> getJson(String path, {Map<String, String>? query}) async {
    final res = await _send(() => _client.get(uri(path, query), headers: _headers()));
    return _asMap(res);
  }

  Future<Map<String, dynamic>> postJson(String path, [Map<String, dynamic>? body]) async {
    final res = await _send(
      () => _client.post(
        uri(path),
        headers: _headers(),
        body: body == null ? null : jsonEncode(body),
      ),
    );
    return _asMap(res);
  }

  Map<String, String> _headers() {
    final h = <String, String>{'Content-Type': 'application/json'};
    final t = _auth.token;
    if (t != null && t.isNotEmpty) h['Authorization'] = 'Bearer $t';
    return h;
  }

  Future<http.Response> _send(Future<http.Response> Function() fn) async {
    final res = await fn().timeout(const Duration(seconds: 30));
    if (res.statusCode >= 200 && res.statusCode < 300) return res;
    throw ApiException.fromResponse(res.statusCode, res.body);
  }

  Map<String, dynamic> _asMap(http.Response res) {
    if (res.body.isEmpty) return {};
    final decoded = jsonDecode(res.body);
    if (decoded is Map<String, dynamic>) return decoded;
    throw ApiException('Expected JSON object', body: res.body);
  }

  void close() => _client.close();
}
