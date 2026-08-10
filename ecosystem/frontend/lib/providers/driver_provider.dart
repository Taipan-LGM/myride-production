import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Background location permission state for drivers.
enum BackgroundPermissionState {
  granted,
  denied,
  pending,
}

class IncomingRideRequest {
  const IncomingRideRequest({
    required this.tripId,
    required this.riderName,
    required this.pickup,
    required this.dropoff,
    this.fareCents,
    this.distanceKm,
  });

  final String tripId;
  final String riderName;
  final String pickup;
  final String dropoff;
  final int? fareCents;
  final double? distanceKm;
}

class DriverState {
  const DriverState({
    this.isOnline = false,
    this.earningsToday = 0,
    this.incomingRequest,
    this.isLoading = false,
    this.backgroundPermission = BackgroundPermissionState.pending,
  });

  final bool isOnline;
  final double earningsToday;
  final IncomingRideRequest? incomingRequest;
  final bool isLoading;
  final BackgroundPermissionState backgroundPermission;

  /// True when driver has "Allow all the time" location access.
  bool get hasBackgroundPermission => backgroundPermission == BackgroundPermissionState.granted;

  DriverState copyWith({
    bool? isOnline,
    double? earningsToday,
    IncomingRideRequest? incomingRequest,
    bool? isLoading,
    BackgroundPermissionState? backgroundPermission,
    bool clearRequest = false,
  }) =>
      DriverState(
        isOnline: isOnline ?? this.isOnline,
        earningsToday: earningsToday ?? this.earningsToday,
        incomingRequest: clearRequest ? null : (incomingRequest ?? this.incomingRequest),
        isLoading: isLoading ?? this.isLoading,
        backgroundPermission: backgroundPermission ?? this.backgroundPermission,
      );
}

final driverProvider = StateNotifierProvider<DriverNotifier, DriverState>((ref) => DriverNotifier());

class DriverNotifier extends StateNotifier<DriverState> {
  DriverNotifier() : super(const DriverState(earningsToday: 142.50));

  void setOnline(bool v) => toggleOnline(v);

  /// Toggle online state (permission checks happen in UI before calling).
  void toggleOnline(bool v) {
    state = state.copyWith(isOnline: v);
  }

  void setBackgroundPermission(BackgroundPermissionState permission) =>
      state = state.copyWith(backgroundPermission: permission);

  void setIncoming(IncomingRideRequest? req) => state = state.copyWith(incomingRequest: req);

  void clearRequest() => state = state.copyWith(clearRequest: true);

  void setLoading(bool v) => state = state.copyWith(isLoading: v);

  void addEarnings(double amount) => state = state.copyWith(earningsToday: state.earningsToday + amount);
}
