import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/providers/ride_history_provider.dart';
import 'package:my_ride/services/mobile_api_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/common/mr_empty_state.dart';
import 'package:my_ride/widgets/common/mr_error_snackbar.dart';
import 'package:my_ride/widgets/common/mr_shimmer_list.dart';

class RideHistoryScreen extends ConsumerStatefulWidget {
  const RideHistoryScreen({super.key});

  @override
  ConsumerState<RideHistoryScreen> createState() => _RideHistoryScreenState();
}

class _RideHistoryScreenState extends ConsumerState<RideHistoryScreen> {
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(rideHistoryProvider.notifier).loadInitial());
    _scroll.addListener(_onScroll);
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 200) {
      ref.read(rideHistoryProvider.notifier).loadMore();
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(rideHistoryProvider);

    ref.listen(rideHistoryProvider, (prev, next) {
      if (next.error != null && !next.useOfflineSample && context.mounted) {
        MrErrorSnackbar.show(
          context,
          next.error!,
          onRetry: () => ref.read(rideHistoryProvider.notifier).loadInitial(forceRefresh: true),
        );
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('Ride History'),
        actions: [
          PopupMenuButton<String>(
            initialValue: state.filter,
            onSelected: ref.read(rideHistoryProvider.notifier).setFilter,
            itemBuilder: (_) => ['Today', 'This Week', 'This Month']
                .map((f) => PopupMenuItem(value: f, child: Text(f)))
                .toList(),
          ),
        ],
      ),
      body: _buildBody(state),
    );
  }

  Widget _buildBody(RideHistoryState state) {
    if (state.isLoading && state.trips.isEmpty) {
      return const MrShimmerList();
    }
    if (state.trips.isEmpty) {
      return MrEmptyState(
        title: 'No rides yet',
        subtitle: 'Your completed trips will appear here',
        icon: Icons.history,
        actionLabel: 'Book a ride',
        onAction: () => context.push('/rider/request'),
      );
    }
    return RefreshIndicator(
      onRefresh: () => ref.read(rideHistoryProvider.notifier).loadInitial(forceRefresh: true),
      child: ListView.separated(
        controller: _scroll,
        padding: const EdgeInsets.all(16),
        itemCount: state.trips.length + (state.isLoadingMore ? 1 : 0),
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (_, i) {
          if (i >= state.trips.length) {
            return const Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator(color: MrColors.secondary)),
            );
          }
          final t = state.trips[i];
          return Semantics(
            button: true,
            label: 'Ride from ${t.pickupAddress} to ${t.dropoffAddress}',
            child: ListTile(
              tileColor: Theme.of(context).cardColor,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              leading: const Icon(Icons.local_taxi, color: MrColors.secondary),
              title: Text('${t.pickupAddress ?? 'Pickup'} → ${t.dropoffAddress ?? 'Dropoff'}'),
              subtitle: Text(t.status.label),
              trailing: Text(
                t.fareEstimate != null ? 'R${t.fareEstimate!.toStringAsFixed(2)}' : '—',
                style: MrText.mono(weight: FontWeight.w700),
              ),
              onTap: () => _showDetail(t),
            ),
          );
        },
      ),
    );
  }

  void _showDetail(Trip trip) {
    showModalBottomSheet(
      context: context,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Receipt', style: MrText.sans(size: 20, weight: FontWeight.w700)),
            const SizedBox(height: 12),
            Text('${trip.pickupAddress} → ${trip.dropoffAddress}'),
            Text('Status: ${trip.status.label}'),
            const SizedBox(height: 16),
            Text('Rate your driver', style: MrText.sans(weight: FontWeight.w600)),
            Row(
              children: List.generate(5, (i) => IconButton(
                icon: Icon(Icons.star, color: i < 4 ? Colors.amber : Colors.grey),
                onPressed: () async {
                  try {
                    await MobileApiService().rateDriver(
                      tripId: trip.id,
                      driverId: trip.driverId ?? 'driver-demo-001',
                      rating: i + 1,
                    );
                    if (ctx.mounted) Navigator.pop(ctx);
                  } catch (e) {
                    if (ctx.mounted) MrErrorSnackbar.showException(ctx, e);
                  }
                },
              )),
            ),
          ],
        ),
      ),
    );
  }
}
