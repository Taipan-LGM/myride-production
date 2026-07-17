import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/core/platform/background_location_permission.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/providers/driver_provider.dart';
import 'package:my_ride/services/location/location_permission_storage.dart';
import 'package:my_ride/services/location/location_service.dart';
import 'package:my_ride/services/permission_service.dart';
import 'package:permission_handler/permission_handler.dart';

bool _authIsDriver(AuthState auth) {
  final role = auth.user?.role ?? auth.pendingRole;
  return PermissionService.isDriver(role: role, flavor: AppConfig.flavor);
}

Future<void> _syncDriverPermissionState(Ref ref, BackgroundPermissionState state) async {
  await LocationPermissionStorage.saveState(state);
  ref.read(driverProvider.notifier).setBackgroundPermission(state);
}

/// Requests foreground location; drivers also get background location prompt (native only).
final permissionProvider = FutureProvider<bool>((ref) async {
  ref.watch(authProvider);

  final locationStatus = await requestForegroundLocationPermission();
  if (!locationStatus.isGranted && !kIsWeb) {
    await _syncDriverPermissionState(ref, BackgroundPermissionState.denied);
    return false;
  }

  final authState = ref.read(authProvider);
  if (_authIsDriver(authState)) {
    if (!BackgroundLocationPermission.isSupported) {
      await _syncDriverPermissionState(ref, BackgroundPermissionState.granted);
    } else {
      final backgroundStatus = await BackgroundLocationPermission.request();
      if (!backgroundStatus.isGranted) {
        PermissionService.backgroundLocationDenied = true;
        PermissionService.markPendingBackgroundSnackbar();
        await _syncDriverPermissionState(ref, BackgroundPermissionState.denied);
        return false;
      }
      PermissionService.backgroundLocationDenied = false;
      await _syncDriverPermissionState(ref, BackgroundPermissionState.granted);
    }
  }

  await requestNotificationPermission();
  return true;
});

/// Driver-only background location check (status + optional re-request).
final driverPermissionProvider = FutureProvider<bool>((ref) async {
  ref.watch(authProvider);

  final authState = ref.read(authProvider);
  if (!_authIsDriver(authState)) {
    await _syncDriverPermissionState(ref, BackgroundPermissionState.granted);
    return true;
  }

  if (!BackgroundLocationPermission.isSupported) {
    await _syncDriverPermissionState(ref, BackgroundPermissionState.granted);
    return true;
  }

  if (await LocationService.instance.checkBackgroundPermission()) {
    PermissionService.backgroundLocationDenied = false;
    await _syncDriverPermissionState(ref, BackgroundPermissionState.granted);
    return true;
  }

  try {
    final granted = await LocationService.instance.requestBackgroundPermission();
    await _syncDriverPermissionState(
      ref,
      granted ? BackgroundPermissionState.granted : BackgroundPermissionState.denied,
    );
    PermissionService.backgroundLocationDenied = !granted;
    return granted;
  } on LocationBackgroundDeniedException {
    PermissionService.backgroundLocationDenied = true;
    await _syncDriverPermissionState(ref, BackgroundPermissionState.denied);
    return false;
  }
});

/// Invalidate and re-run the full permission flow.
void refreshPermissions(WidgetRef ref) {
  ref.invalidate(permissionProvider);
  ref.invalidate(driverPermissionProvider);
}
