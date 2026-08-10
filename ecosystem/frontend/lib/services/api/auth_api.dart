import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/models/app_user.dart';
import 'package:my_ride/services/api/ecosystem_auth_api.dart';
import 'package:my_ride/services/legacy/legacy_api_client.dart';
import 'package:my_ride/services/legacy/legacy_auth_service.dart';
import 'package:my_ride/services/secure_storage_service.dart';

class AuthApi {
  AuthApi({
    LegacyApiClient? client,
    LegacyAuthService? auth,
    EcosystemAuthApi? ecosystemAuth,
  })  : _client = client ?? LegacyApiClient(),
        _auth = auth ?? LegacyAuthService.instance,
        _ecosystem = ecosystemAuth ?? EcosystemAuthApi();

  final LegacyApiClient _client;
  final LegacyAuthService _auth;
  final EcosystemAuthApi _ecosystem;

  Future<AppUser> login({
    required String email,
    required String password,
    String role = 'rider',
  }) async {
    if (!AppConfig.legacyBackend) {
      return _ecosystem.login(email: email, password: password, role: role);
    }
    final data = await _client.postJson('/users/login', {
      'email': email.trim().toLowerCase(),
      'password': password,
    });
    return _persistSession(data);
  }

  /// Register a customer (rider) against legacy `POST /api/users/register`.
  Future<AppUser> register({
    required String name,
    required String email,
    required String password,
  }) async {
    if (!AppConfig.legacyBackend) {
      // Ecosystem demo: map register → rider login with known demo account hint
      throw Exception(
        'Use demo login rider@myride.co.za / ride123 on the FastAPI ecosystem backend.',
      );
    }
    final data = await _client.postJson('/users/register', {
      'role': 'customer',
      'name': name.trim(),
      'email': email.trim().toLowerCase(),
      'password': password,
    });
    return _persistSession(data);
  }

  Future<AppUser> _persistSession(Map<String, dynamic> data) async {
    final token = data['token'] as String?;
    if (token == null || token.isEmpty) {
      throw Exception(data['error']?.toString() ?? 'login_failed');
    }

    final userJson = data['user'] as Map<String, dynamic>? ?? {};
    final legacyRole = userJson['role'] as String? ?? 'customer';
    final role = legacyRole == 'driver' ? UserRole.driver : UserRole.rider;

    final user = AppUser(
      id: userJson['id']?.toString() ?? '',
      role: role,
      name: userJson['name'] as String? ?? '',
      email: userJson['email'] as String?,
      profileComplete: true,
    );

    await _auth.setSession(token: token, role: legacyRole);
    await SecureStorageService.instance.saveUser(user);
    return user;
  }

  Future<AppUser?> me() async {
    if (!AppConfig.legacyBackend) {
      return await _ecosystem.me() ?? await SecureStorageService.instance.loadUser();
    }
    final data = await _client.getJson('/users/me');
    final userJson = data['user'] as Map<String, dynamic>? ?? data;
    if (userJson['id'] == null) return null;

    final legacyRole = userJson['role'] as String? ?? 'customer';
    return AppUser(
      id: userJson['id']?.toString() ?? '',
      role: legacyRole == 'driver' ? UserRole.driver : UserRole.rider,
      name: userJson['name'] as String? ?? '',
      email: userJson['email'] as String?,
      profileComplete: true,
    );
  }
}
