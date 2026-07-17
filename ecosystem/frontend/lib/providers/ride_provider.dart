import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/models/ride/nearby_driver.dart';
import 'package:my_ride/models/ride/ride_request.dart';
import 'package:my_ride/models/ride/ride_status.dart';
import 'package:my_ride/providers/socket_provider.dart';
import 'package:my_ride/services/api/rides_api.dart';
import 'package:my_ride/services/socket/socket_service.dart';

final ridesApiProvider = Provider<RidesApi>((ref) => RidesApi());

class RideState {
  const RideState({
    this.nearbyDrivers = const [],
    this.currentRide,
    this.isLoading = false,
    this.error,
    this.etaToPickup,
    this.etaToDropoff,
  });

  final List<NearbyDriver> nearbyDrivers;
  final RideStatusUpdate? currentRide;
  final bool isLoading;
  final String? error;
  final int? etaToPickup;
  final int? etaToDropoff;

  bool get hasActiveRide => currentRide?.rideStatus.isActive ?? false;

  RideState copyWith({
    List<NearbyDriver>? nearbyDrivers,
    RideStatusUpdate? currentRide,
    bool? isLoading,
    String? error,
    int? etaToPickup,
    int? etaToDropoff,
    bool clearRide = false,
  }) =>
      RideState(
        nearbyDrivers: nearbyDrivers ?? this.nearbyDrivers,
        currentRide: clearRide ? null : (currentRide ?? this.currentRide),
        isLoading: isLoading ?? this.isLoading,
        error: error,
        etaToPickup: etaToPickup ?? this.etaToPickup,
        etaToDropoff: etaToDropoff ?? this.etaToDropoff,
      );
}

class RideNotifier extends StateNotifier<RideState> {
  RideNotifier(this._ref) : super(const RideState()) {
    _listenSocket();
  }

  final Ref _ref;
  final List<StreamSubscription<dynamic>> _subs = [];

  RidesApi get _api => _ref.read(ridesApiProvider);
  SocketIoService get _socket => _ref.read(socketIoServiceProvider);

  void _listenSocket() {
    if (!AppConfig.legacyBackend) return;

    _subs.add(_socket.rideStatus.listen(_onStatus));
    _subs.add(_socket.rideMatched.listen(_onMatched));
    _subs.add(_socket.rideEta.listen(_onEta));
  }

  void _onStatus(RideStatusUpdate status) {
    state = state.copyWith(currentRide: status);
    if (status.rideStatus.isTerminal) {
      Future.delayed(const Duration(seconds: 5), () {
        if (state.currentRide?.rideId == status.rideId) {
          state = state.copyWith(clearRide: true);
        }
      });
    }
  }

  void _onMatched(Map<String, dynamic> data) {
    final rideId = data['ride_id']?.toString();
    final driver = data['driver'];
    if (rideId == null) return;

    state = state.copyWith(
      currentRide: RideStatusUpdate(
        rideId: rideId,
        status: 'matched',
        updatedAt: DateTime.now(),
        driver: driver is Map<String, dynamic> ? MatchedDriver.fromJson(driver) : null,
      ),
    );
    _socket.joinRide(rideId);
  }

  void _onEta(Map<String, dynamic> data) {
    state = state.copyWith(
      etaToPickup: (data['eta_to_pickup'] as num?)?.round(),
      etaToDropoff: (data['eta_to_dropoff'] as num?)?.round(),
    );
  }

  Future<void> fetchNearbyDrivers({
    required double lat,
    required double lng,
    int radius = 5000,
    int limit = 20,
    String? vehicleType,
  }) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final drivers = await _api.getNearbyDrivers(
        lat: lat,
        lng: lng,
        radius: radius,
        limit: limit,
        vehicleType: vehicleType,
      );
      state = state.copyWith(nearbyDrivers: drivers, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    }
  }

  Future<RideResponse> requestRide(RideRequest request) async {
    state = state.copyWith(isLoading: true, error: null);
    try {
      final response = await _api.requestRide(request);
      state = state.copyWith(
        isLoading: false,
        currentRide: RideStatusUpdate(
          rideId: response.rideId,
          status: response.status,
          updatedAt: response.createdAt,
          rawRide: response.rawRide,
        ),
      );
      _socket.joinRide(response.rideId);
      return response;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      rethrow;
    }
  }

  Future<void> cancelRide({String? reason}) async {
    final ride = state.currentRide;
    if (ride == null) return;

    state = state.copyWith(isLoading: true);
    try {
      await _api.cancelRide(ride.rideId, reason: reason);
      state = state.copyWith(isLoading: false, clearRide: true);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
      rethrow;
    }
  }

  void clearState() {
    state = const RideState();
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }
}

final rideProvider = StateNotifierProvider<RideNotifier, RideState>((ref) => RideNotifier(ref));
