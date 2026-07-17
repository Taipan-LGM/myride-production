import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/core/platform/background_location_permission.dart';
import 'package:my_ride/providers/driver_provider.dart';
import 'package:my_ride/services/location/location_permission_storage.dart';
import 'package:permission_handler/permission_handler.dart';

/// Thrown when driver background ("Allow all the time") location is denied.
class LocationBackgroundDeniedException implements Exception {
  const LocationBackgroundDeniedException([
    this.message = 'Background location permission denied. Enable "Allow all the time" in Settings.',
  ]);

  final String message;

  @override
  String toString() => 'LocationBackgroundDeniedException: $message';
}

/// Device location with foreground/background permission handling and geocoding.
class LocationService {
  LocationService._();
  static final LocationService instance = LocationService._();

  /// Foreground location (while-in-use). Required before background on Android 10+.
  Future<LocationPermission> requestPermission() async {
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    return perm;
  }

  /// Returns whether "Allow all the time" / background location is granted.
  Future<bool> checkBackgroundPermission() async {
    return BackgroundLocationPermission.isGranted();
  }

  /// Requests background location for drivers. Throws [LocationBackgroundDeniedException] if denied.
  Future<bool> requestBackgroundPermission() async {
    if (!BackgroundLocationPermission.isSupported) {
      await LocationPermissionStorage.saveState(BackgroundPermissionState.granted);
      return true;
    }

    await LocationPermissionStorage.saveState(BackgroundPermissionState.pending);

    if (!await Permission.location.isGranted) {
      final foreground = await requestForegroundLocationPermission();
      if (!foreground.isGranted) {
        await LocationPermissionStorage.saveState(BackgroundPermissionState.denied);
        throw const LocationBackgroundDeniedException(
          'Foreground location is required before background access.',
        );
      }
    }

    final current = await BackgroundLocationPermission.status();
    if (current.isGranted) {
      await LocationPermissionStorage.saveState(BackgroundPermissionState.granted);
      return true;
    }

    final result = await BackgroundLocationPermission.request();
    if (result.isGranted) {
      await LocationPermissionStorage.saveState(BackgroundPermissionState.granted);
      return true;
    }

    await LocationPermissionStorage.saveState(BackgroundPermissionState.denied);
    throw const LocationBackgroundDeniedException();
  }

  Future<GeoPoint?> getCurrentPosition({bool requireBackground = false}) async {
    try {
      if (requireBackground && !await checkBackgroundPermission()) {
        throw const LocationBackgroundDeniedException();
      }

      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) return null;

      try {
        final pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 8),
          ),
        );
        return GeoPoint(lat: pos.latitude, lng: pos.longitude);
      } catch (_) {
        // Retry with lower accuracy before giving up (fixes sticky "network location" failures)
        final pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.medium,
            timeLimit: Duration(seconds: 12),
          ),
        );
        return GeoPoint(lat: pos.latitude, lng: pos.longitude);
      }
    } on LocationBackgroundDeniedException {
      rethrow;
    } catch (_) {
      return null;
    }
  }

  Future<String?> reverseGeocode(GeoPoint point) async {
    try {
      final places = await placemarkFromCoordinates(point.lat, point.lng);
      if (places.isEmpty) return null;
      final p = places.first;
      return [p.street, p.locality, p.country].whereType<String>().where((s) => s.isNotEmpty).join(', ');
    } catch (_) {
      return 'Current location';
    }
  }

  GeoPoint _defaultPoint() => GeoPoint(lat: ApiConfig.defaultLat, lng: ApiConfig.defaultLng);

  /// Live position stream — drivers should have background permission when app is minimized.
  Stream<GeoPoint> watchPosition({
    Duration interval = const Duration(seconds: 2),
    bool requireBackground = false,
  }) async* {
    if (requireBackground && !await checkBackgroundPermission()) {
      throw const LocationBackgroundDeniedException();
    }

    await for (final pos in Geolocator.getPositionStream(
      locationSettings: LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
        timeLimit: interval,
      ),
    )) {
      yield GeoPoint(lat: pos.latitude, lng: pos.longitude);
    }
  }
}
