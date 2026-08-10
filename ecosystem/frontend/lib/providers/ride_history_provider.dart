import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/data/sample_data.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/services/mobile_api_service.dart';

const _pageSize = 20;

class RideHistoryState {
  const RideHistoryState({
    this.trips = const [],
    this.isLoading = false,
    this.isLoadingMore = false,
    this.hasMore = true,
    this.error,
    this.filter = 'This Month',
    this.useOfflineSample = false,
  });

  final List<Trip> trips;
  final bool isLoading;
  final bool isLoadingMore;
  final bool hasMore;
  final String? error;
  final String filter;
  final bool useOfflineSample;

  RideHistoryState copyWith({
    List<Trip>? trips,
    bool? isLoading,
    bool? isLoadingMore,
    bool? hasMore,
    String? error,
    String? filter,
    bool? useOfflineSample,
  }) =>
      RideHistoryState(
        trips: trips ?? this.trips,
        isLoading: isLoading ?? this.isLoading,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        hasMore: hasMore ?? this.hasMore,
        error: error,
        filter: filter ?? this.filter,
        useOfflineSample: useOfflineSample ?? this.useOfflineSample,
      );
}

final rideHistoryProvider = StateNotifierProvider<RideHistoryNotifier, RideHistoryState>((ref) {
  return RideHistoryNotifier(ref);
});

class RideHistoryNotifier extends StateNotifier<RideHistoryState> {
  RideHistoryNotifier(this._ref) : super(const RideHistoryState());

  final Ref _ref;

  Future<void> loadInitial({bool forceRefresh = false}) async {
    if (state.isLoading && !forceRefresh) return;
    state = state.copyWith(isLoading: true, error: null, trips: forceRefresh ? [] : state.trips);
    await _fetchPage(offset: 0, append: false);
  }

  Future<void> loadMore() async {
    if (state.isLoadingMore || !state.hasMore || state.useOfflineSample) return;
    state = state.copyWith(isLoadingMore: true);
    await _fetchPage(offset: state.trips.length, append: true);
  }

  void setFilter(String filter) {
    state = state.copyWith(filter: filter);
    loadInitial(forceRefresh: true);
  }

  Future<void> _fetchPage({required int offset, required bool append}) async {
    final riderId = _ref.read(authProvider).user?.id ?? ApiConfig.defaultRiderId;
    try {
      final all = await MobileApiService().listTrips(riderId: riderId);
      final filtered = _applyFilter(all, state.filter);
      final page = filtered.skip(offset).take(_pageSize).toList();
      final merged = append ? [...state.trips, ...page] : page;
      state = state.copyWith(
        trips: merged,
        isLoading: false,
        isLoadingMore: false,
        hasMore: offset + page.length < filtered.length,
        useOfflineSample: false,
      );
    } catch (e) {
      if (!append && state.trips.isEmpty) {
        state = state.copyWith(
          trips: SampleData.sampleTrips,
          isLoading: false,
          isLoadingMore: false,
          hasMore: false,
          useOfflineSample: true,
          error: e.toString(),
        );
      } else {
        state = state.copyWith(isLoading: false, isLoadingMore: false, error: e.toString());
      }
    }
  }

  List<Trip> _applyFilter(List<Trip> trips, String filter) {
    return trips.where((t) => switch (filter) {
          'Today' => true,
          'This Week' => true,
          _ => true,
        }).toList()
      ..sort((a, b) => b.id.compareTo(a.id));
  }
}
