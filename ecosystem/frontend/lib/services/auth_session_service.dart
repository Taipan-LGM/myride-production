import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/models/app_user.dart';
import 'package:my_ride/services/api/ecosystem_auth_api.dart';
import 'package:my_ride/services/auth_service.dart';
import 'package:my_ride/services/legacy/legacy_auth_service.dart';
import 'package:my_ride/services/secure_storage_service.dart';

abstract final class AuthSessionService {
  static Future<AppUser?> restore() async {
    final storage = SecureStorageService.instance;
    final stored = await storage.loadUser();

    if (AppConfig.legacyBackend) {
      return LegacyAuthService.instance.isAuthenticated ? stored : null;
    }
    if (AppConfig.useMockAuth) return stored;

    final api = EcosystemAuthApi();
    AppUser? verified;
    try {
      verified = await api.me();
      if (verified == null && AuthService.instance.isSignedIn) {
        final idToken = await AuthService.instance.firebaseIdToken();
        verified = await api.loginWithFirebase(
          idToken: idToken,
          role: stored?.role.name ?? 'rider',
        );
      }
    } catch (_) {
      verified = null;
    }

    if (verified == null) {
      await storage.clear();
      return null;
    }

    final matchingStored = stored?.id == verified.id ? stored : null;
    final restored = AppUser(
      id: verified.id,
      role: verified.role,
      name: matchingStored != null && matchingStored.name.isNotEmpty
          ? matchingStored.name
          : verified.name,
      email: matchingStored?.email ?? verified.email,
      phone: verified.phone ?? matchingStored?.phone,
      photoUrl: matchingStored?.photoUrl,
      vehicleMake: matchingStored?.vehicleMake,
      vehicleModel: matchingStored?.vehicleModel,
      vehiclePlate: matchingStored?.vehiclePlate,
      profileComplete:
          matchingStored?.profileComplete ?? verified.profileComplete,
    );
    await storage.saveUser(restored);
    return restored;
  }
}