import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/core/api/api_exception.dart';
import 'package:my_ride/core/utils/retry_helper.dart';
import 'package:my_ride/services/connectivity_service.dart';
import 'package:my_ride/services/secure_storage_service.dart';

/// HTTP client: 30s timeout, connectivity check, 3× retry with exponential backoff.
class ApiClient {
  ApiClient({
    http.Client? client,
    Duration? timeout,
    ConnectivityService? connectivity,
  })  : _client = client ?? http.Client(),
        _timeout = timeout ?? const Duration(seconds: 30),
        _connectivity = connectivity ?? ConnectivityService();

  final http.Client _client;
  final Duration _timeout;
  final ConnectivityService _connectivity;

  Future<Map<String, String>> _headers({bool jsonBody = false}) async {
    final headers = <String, String>{};
    if (jsonBody) headers['Content-Type'] = 'application/json';
    final token = await SecureStorageService.instance.loadJwtToken();
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  Future<Map<String, dynamic>> getJson(String path) async =>
      _decodeMap(await _request(() async => _client.get(
            ApiConfig.uri(path),
            headers: await _headers(),
          )));

  Future<List<dynamic>> getJsonList(String path) async {
    final decoded = await _request(() async => _client.get(
          ApiConfig.uri(path),
          headers: await _headers(),
        ));
    if (decoded is List) return decoded;
    throw ApiException('Expected JSON list', body: decoded?.toString());
  }

  Future<Map<String, dynamic>> postJson(String path, [Map<String, dynamic>? body]) async {
    final decoded = await _request(
      () async => _client.post(
        ApiConfig.uri(path),
        headers: await _headers(jsonBody: true),
        body: body == null ? null : jsonEncode(body),
      ),
    );
    if (decoded is Map<String, dynamic>) return decoded;
    throw ApiException('Expected JSON object', body: decoded?.toString());
  }

  Future<List<dynamic>> postJsonList(String path, Map<String, dynamic> body) async {
    final decoded = await _request(
      () async => _client.post(
        ApiConfig.uri(path),
        headers: await _headers(jsonBody: true),
        body: jsonEncode(body),
      ),
    );
    if (decoded is List) return decoded;
    throw ApiException('Expected JSON list', body: decoded?.toString());
  }

  Future<Map<String, dynamic>> patchJson(String path, Map<String, dynamic> body) async =>
      _decodeMap(
        await _request(
          () async => _client.patch(
            ApiConfig.uri(path),
            headers: await _headers(jsonBody: true),
            body: jsonEncode(body),
          ),
        ),
      );

  Future<Map<String, dynamic>> health() => getJson('/health');

  /// Core request pipeline: connectivity → retry → timeout → decode errors.
  Future<dynamic> _request(Future<http.Response> Function() send) async {
    return retryWithBackoff(() async {
      if (!kIsWeb && !await _connectivity.hasConnection()) {
        throw const NetworkException();
      }
      final res = await send().timeout(_timeout);
      return _decode(res);
    });
  }

  dynamic _decode(http.Response res) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      if (res.body.isEmpty) return <String, dynamic>{};
      return jsonDecode(res.body);
    }
    throw ApiException.fromResponse(res.statusCode, res.body);
  }

  Map<String, dynamic> _decodeMap(dynamic decoded) {
    if (decoded is Map<String, dynamic>) return decoded;
    throw ApiException('Expected JSON object', body: decoded?.toString());
  }

  void close() => _client.close();
}
