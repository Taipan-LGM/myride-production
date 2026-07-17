import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:my_ride/models/app_user.dart';

class SecureStorageService {
  SecureStorageService._();
  static final SecureStorageService instance = SecureStorageService._();

  static const _storage = FlutterSecureStorage();
  static const _userKey = 'app_user';
  static const _refreshTokenKey = 'firebase_refresh_token';
  static const _jwtKey = 'legacy_jwt_token';

  Future<void> saveUser(AppUser user) async {
    await _storage.write(key: _userKey, value: jsonEncode(user.toJson()));
  }

  Future<AppUser?> loadUser() async {
    final raw = await _storage.read(key: _userKey);
    if (raw == null) return null;
    return AppUser.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  Future<void> saveRefreshToken(String token) => _storage.write(key: _refreshTokenKey, value: token);

  Future<String?> loadRefreshToken() => _storage.read(key: _refreshTokenKey);

  Future<void> saveJwtToken(String token) => _storage.write(key: _jwtKey, value: token);

  Future<String?> loadJwtToken() => _storage.read(key: _jwtKey);

  Future<void> clear() async {
    await _storage.delete(key: _userKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _jwtKey);
  }
}
