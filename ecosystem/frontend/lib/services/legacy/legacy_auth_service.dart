import 'package:my_ride/models/app_user.dart';
import 'package:my_ride/services/secure_storage_service.dart';

/// JWT session for legacy Node.js backend (`/api/users/login`).
class LegacyAuthService {
  LegacyAuthService._();
  static final LegacyAuthService instance = LegacyAuthService._();

  String? _token;
  String? _role;

  String? get token => _token;
  String? get role => _role;
  bool get isAuthenticated => _token != null && _token!.isNotEmpty;

  Future<void> init() async {
    _token = await SecureStorageService.instance.loadJwtToken();
    final user = await SecureStorageService.instance.loadUser();
    _role = user?.role == UserRole.driver ? 'driver' : 'customer';
  }

  Future<void> setSession({required String token, required String role}) async {
    _token = token;
    _role = role;
    await SecureStorageService.instance.saveJwtToken(token);
  }

  Future<String?> getToken() async {
    _token ??= await SecureStorageService.instance.loadJwtToken();
    return _token;
  }

  Future<String?> getUserRole() async {
    if (_role != null) return _role;
    final user = await SecureStorageService.instance.loadUser();
    if (user == null) return null;
    return user.role == UserRole.driver ? 'driver' : 'customer';
  }

  Future<void> clear() async {
    _token = null;
    _role = null;
    await SecureStorageService.instance.clear();
  }
}
