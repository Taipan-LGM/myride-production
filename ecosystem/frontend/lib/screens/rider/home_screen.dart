import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/providers/location_provider.dart';
import 'package:my_ride/providers/ride_provider.dart';
import 'package:my_ride/providers/socket_provider.dart';
import 'package:my_ride/screens/rider/nearby_drivers_widget.dart';
import 'package:my_ride/services/websocket_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';
import 'package:my_ride/widgets/map/driver_marker.dart';
import 'package:my_ride/widgets/map/ride_map_widget.dart';
import 'package:my_ride/widgets/safety/sos_actions.dart';
import 'package:my_ride/widgets/mr_badge.dart';

/// Rider home tab — map, nearby drivers (REST or WS), quick ride request.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  WebSocketService? _nearbyWs;
  final _driverMarkers = <Marker>{};

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      await ref.read(locationProvider.notifier).init();
      if (!mounted) return;
      if (AppConfig.legacyBackend) {
        ref.watch(socketConnectionProvider);
        _refreshLegacyNearby();
      } else {
        _connectFastApiNearby();
      }
    });
  }

  void _connectFastApiNearby() {
    _nearbyWs = WebSocketService(
      path: '/ws/nearby-drivers',
      onEvent: (event, data) {
        if (event == 'driver_location' && mounted) {
          setState(() {
            _driverMarkers.add(Marker(
              markerId: MarkerId(data['driver_id'] as String? ?? 'd'),
              position: LatLng((data['lat'] as num).toDouble(), (data['lng'] as num).toDouble()),
              icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
            ));
          });
        }
      },
    )..connect();
    _sendNearbyCenter();
  }

  void _sendNearbyCenter() {
    final pos = ref.read(locationProvider).position;
    _nearbyWs?.send({
      'center': {
        'lat': pos?.lat ?? ApiConfig.defaultLat,
        'lng': pos?.lng ?? ApiConfig.defaultLng,
      },
      'radius_km': 10,
    });
  }

  Future<void> _refreshLegacyNearby() async {
    final loc = ref.read(locationProvider).position;
    if (loc == null) return;
    await ref.read(rideProvider.notifier).fetchNearbyDrivers(
          lat: loc.lat,
          lng: loc.lng,
          radius: 5000,
          limit: 20,
        );
  }

  @override
  void dispose() {
    _nearbyWs?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(socketConnectionProvider);

    final loc = ref.watch(locationProvider);
    ref.listen(locationProvider, (prev, next) {
      if (!AppConfig.legacyBackend &&
          next.position != null &&
          prev?.position?.lat != next.position?.lat) {
        _sendNearbyCenter();
      }
    });
    final center = loc.position != null
        ? LatLng(loc.position!.lat, loc.position!.lng)
        : LatLng(ApiConfig.defaultLat, ApiConfig.defaultLng);

    final rideState = ref.watch(rideProvider);
    if (AppConfig.legacyBackend && rideState.hasActiveRide) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.go('/rider/tracking/${rideState.currentRide!.rideId}');
      });
    }

    final legacyMarkers = AppConfig.legacyBackend
        ? buildNearbyDriverMarkers(rideState.nearbyDrivers)
        : _driverMarkers;

    return Scaffold(
      appBar: AppBar(
        title: const MrLogo.appBar(),
        actions: [
          // Version badge in AppBar
          Padding(
            padding: const EdgeInsets.only(right: 16.0),
            child: VersionBadge(version: '0.3.1'),
          ),
          IconButton(
            tooltip: 'SOS',
            icon: const Icon(Icons.sos, color: MrColors.error),
            onPressed: () {
              final pos = ref.read(locationProvider).position;
              SosActions.trigger(context, lat: pos?.lat, lng: pos?.lng, note: 'Home SOS');
            },
          ),
          IconButton(
            tooltip: 'Current location',
            icon: const Icon(Icons.my_location),
            onPressed: () async {
              await ref.read(locationProvider.notifier).refresh();
              final pos = ref.read(locationProvider).position;
              if (!mounted) return;
              if (pos != null) {
                _sendNearbyCenter();
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Map centered on your current location')),
                  );
                }
              } else {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('GPS unavailable. Type pickup on Request ride (OpenStreetMap).'),
                    ),
                  );
                }
              }
            },
          ),
          IconButton(tooltip: 'AI Chat', icon: const Icon(Icons.chat_bubble_outline), onPressed: () => context.push('/chat')),
          IconButton(tooltip: 'Voice', icon: const Icon(Icons.mic_none), onPressed: () => context.push('/voice')),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'current-location',
        onPressed: () async {
          await ref.read(locationProvider.notifier).refresh();
          if (!mounted) return;
          final addr = ref.read(locationProvider).address ?? 'Current location';
          context.push('/rider/request', extra: addr);
        },
        icon: const Icon(Icons.my_location),
        label: const Text('Current location'),
        backgroundColor: MrColors.primary,
        foregroundColor: Colors.white,
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          RideMapWidget(
            center: center,
            driverMarkers: legacyMarkers,
            showUserDot: true,
          ),
          if (AppConfig.legacyBackend)
            Positioned(
              left: 16,
              right: 16,
              top: 8,
              child: NearbyDriversWidget(
                drivers: rideState.nearbyDrivers,
                isLoading: rideState.isLoading,
                error: rideState.error,
                onRefresh: _refreshLegacyNearby,
              ),
            ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _QuickSuggestions(onTap: (label) => context.push('/rider/request', extra: label)),
                const SizedBox(height: 12),
                Material(
                  elevation: 8,
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    onTap: () => context.push('/rider/request'),
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                      child: Row(
                        children: [
                          const Icon(Icons.search, color: MrColors.secondary),
                          const SizedBox(width: 12),
                          Text('Where to?', style: MrText.sans(size: 16, weight: FontWeight.w500)),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickSuggestions extends StatelessWidget {
  const _QuickSuggestions({required this.onTap});
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: ['Home', 'Work', 'Favorites'].map((label) => Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: ActionChip(
            label: Text(label, style: MrText.sans(size: 12)),
            onPressed: () => onTap(label),
            backgroundColor: Colors.white,
          ),
        ),
      )).toList(),
    );
  }
}