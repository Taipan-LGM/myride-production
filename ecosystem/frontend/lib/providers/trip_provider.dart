import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/models/api_models.dart';

final tripProvider = StateNotifierProvider<TripNotifier, TripState>((ref) => TripNotifier());

class TripState {
  const TripState({
    this.currentTrip,
    this.history = const [],
    this.isLoading = false,
    this.error,
    this.etaMinutes,
  });

  final Trip? currentTrip;
  final List<Trip> history;
  final bool isLoading;
  final String? error;
  final int? etaMinutes;

  TripState copyWith({
    Trip? currentTrip,
    List<Trip>? history,
    bool? isLoading,
    String? error,
    int? etaMinutes,
    bool clearTrip = false,
  }) =>
      TripState(
        currentTrip: clearTrip ? null : (currentTrip ?? this.currentTrip),
        history: history ?? this.history,
        isLoading: isLoading ?? this.isLoading,
        error: error,
        etaMinutes: etaMinutes ?? this.etaMinutes,
      );
}

class TripNotifier extends StateNotifier<TripState> {
  TripNotifier() : super(const TripState());

  void setCurrent(Trip trip) => state = state.copyWith(currentTrip: trip, isLoading: false);

  void updateTrip(Trip trip) => state = state.copyWith(currentTrip: trip);

  void setHistory(List<Trip> trips) => state = state.copyWith(history: trips);

  void setLoading(bool v) => state = state.copyWith(isLoading: v);

  void setError(String? e) => state = state.copyWith(error: e, isLoading: false);

  void setEta(int minutes) => state = state.copyWith(etaMinutes: minutes);

  void clearCurrent() => state = state.copyWith(clearTrip: true);
}
