import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/services/location_service.dart';

final locationProvider = StateNotifierProvider<LocationNotifier, LocationState>((ref) => LocationNotifier());

class LocationState {
  const LocationState({
    this.position,
    this.address,
    this.permission = LocationPermissionStatus.unknown,
    this.isLoading = false,
  });

  final GeoPoint? position;
  final String? address;
  final LocationPermissionStatus permission;
  final bool isLoading;

  LocationState copyWith({
    GeoPoint? position,
    String? address,
    LocationPermissionStatus? permission,
    bool? isLoading,
  }) =>
      LocationState(
        position: position ?? this.position,
        address: address ?? this.address,
        permission: permission ?? this.permission,
        isLoading: isLoading ?? this.isLoading,
      );
}

enum LocationPermissionStatus { unknown, granted, denied, deniedForever }

class LocationNotifier extends StateNotifier<LocationState> {
  LocationNotifier() : super(const LocationState());

  final _service = LocationService.instance;

  Future<void> init() async {
    state = state.copyWith(isLoading: true);
    final status = await _service.requestPermission();
    final perm = switch (status) {
      LocationPermission.always || LocationPermission.whileInUse => LocationPermissionStatus.granted,
      LocationPermission.denied => LocationPermissionStatus.denied,
      LocationPermission.deniedForever => LocationPermissionStatus.deniedForever,
      _ => LocationPermissionStatus.unknown,
    };
    final pos = await _service.getCurrentPosition();
    final addr = pos != null ? await _service.reverseGeocode(pos) : null;
    state = state.copyWith(
      position: pos,
      address: addr,
      permission: perm,
      isLoading: false,
    );
  }

  Future<void> refresh() async {
    final pos = await _service.getCurrentPosition();
    final addr = pos != null ? await _service.reverseGeocode(pos) : null;
    // Replace state fully so a failed GPS fix does not keep a stale position
    state = LocationState(
      position: pos,
      address: addr,
      permission: state.permission,
      isLoading: false,
    );
  }
}
