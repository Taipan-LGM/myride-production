import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/models/app_user.dart';
import 'package:my_ride/services/secure_storage_service.dart';

/// FastAPI auth (`POST /auth/login`) for the My Ride SA ecosystem backend.
class EcosystemAuthApi {
  EcosystemAuthApi({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  Uri _uri(String path) => Uri.parse('${AppConfig.apiBaseUrl}$path');

  Future<AppUser> login({
    required String email,
    required String password,
    required String role,
  }) async {
    final res = await _client.post(
      _uri('/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'identifier': email.trim().toLowerCase(),
        'password': password,
        'role': role,
      }),
    );
    return _persistLoginResponse(res, fallbackRole: role);
  }

  Future<AppUser> loginWithFirebase({
    required String idToken,
    required String role,
  }) async {
    final res = await _client.post(
      _uri('/auth/firebase'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'id_token': idToken, 'role': role}),
    );
    return _persistLoginResponse(res, fallbackRole: role);
  }

  Future<AppUser> _persistLoginResponse(
    http.Response res, {
    required String fallbackRole,
  }) async {
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw Exception(data['detail']?.toString() ?? 'login_failed');
    }
    final token = data['access_token'] as String? ?? '';
    final userJson = data['user'] as Map<String, dynamic>? ?? {};
    final roleName = userJson['role'] as String? ?? fallbackRole;
    final userRole = switch (roleName) {
      'driver' => UserRole.driver,
      'admin' => UserRole.admin,
      _ => UserRole.rider,
    };
    final user = AppUser(
      id: userJson['id']?.toString() ?? '',
      role: userRole,
      name: userJson['name'] as String? ?? '',
      email: userJson['email'] as String?,
      phone: userJson['phone'] as String?,
      profileComplete: true,
    );
    await SecureStorageService.instance.saveJwtToken(token);
    await SecureStorageService.instance.saveUser(user);
    return user;
  }

  Future<AppUser?> me() async {
    final token = await SecureStorageService.instance.loadJwtToken();
    if (token == null || token.isEmpty) return null;
    final res = await _client.get(
      _uri('/auth/me'),
      headers: {'Authorization': 'Bearer $token'},
    );
    if (res.statusCode >= 400) return null;
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final roleName = data['role'] as String? ?? 'rider';
    final userRole = switch (roleName) {
      'driver' => UserRole.driver,
      'admin' => UserRole.admin,
      _ => UserRole.rider,
    };
    final user = AppUser(
      id: data['id']?.toString() ?? '',
      role: userRole,
      name: data['name'] as String? ?? '',
      email: data['email'] as String?,
      phone: data['phone'] as String?,
      profileComplete: true,
    );
    await SecureStorageService.instance.saveUser(user);
    return user;
  }
}
