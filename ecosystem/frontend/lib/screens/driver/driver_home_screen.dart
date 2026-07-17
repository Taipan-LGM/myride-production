import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:my_ride/bootstrap.dart' as app_bootstrap;
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/core/platform/background_location_permission.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/providers/driver_provider.dart';
import 'package:my_ride/providers/location_provider.dart';
import 'package:my_ride/providers/permission_provider.dart';
import 'package:my_ride/providers/socket_provider.dart';
import 'package:my_ride/providers/trip_provider.dart';
import 'package:my_ride/services/api/rides_api.dart';
import 'package:my_ride/services/api/wallet_api_service.dart';
import 'package:my_ride/services/driver_background_service.dart';
import 'package:my_ride/services/location/location_service.dart';
import 'package:my_ride/services/mobile_api_service.dart';
import 'package:my_ride/services/websocket_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/map/ride_map_widget.dart';
import 'package:permission_handler/permission_handler.dart';

/// Driver home — permissions are handled by [DriverPermissionSetupScreen] on first launch.
class DriverHomeScreen extends ConsumerWidget {
  const DriverHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return const _DriverHomeBody();
  }
}

class _DriverHomeBody extends ConsumerStatefulWidget {
  const _DriverHomeBody();

  @override
  ConsumerState<_DriverHomeBody> createState() => _DriverHomeBodyState();
}

class _DriverHomeBodyState extends ConsumerState<_DriverHomeBody> {
  WebSocketService? _requestWs;
  StreamSubscription<Map<String, dynamic>>? _legacyRideSub;
  StreamSubscription<GeoPoint>? _locSub;
  LatLng _pos = const LatLng(-33.9249, 18.4241);
  int _tab = 0;
  Timer? _countdown;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await app_bootstrap.syncDriverBackgroundPermissionToProvider(ref);
      if (!mounted) return;

      _logDriverDebugState();

      ref.read(locationProvider.notifier).init();
      try {
        _locSub = LocationService.instance.watchPosition().listen((p) {
          if (mounted) setState(() => _pos = LatLng(p.lat, p.lng));
          if (AppConfig.legacyBackend && ref.read(driverProvider).isOnline) {
            ref.read(socketIoServiceProvider).emitDriverLocation(lat: p.lat, lng: p.lng);
          }
        });
      } on LocationBackgroundDeniedException {
        ref.read(driverProvider.notifier).setBackgroundPermission(BackgroundPermissionState.denied);
      }
      _connectRequests();
    });
  }

  void _logDriverDebugState() {
    if (!kDebugMode) return;
    final user = ref.read(authProvider).user;
    debugPrint('🟢 User role: ${user?.role}');
    debugPrint('🟢 Driver id: ${user?.id ?? ApiConfig.defaultDriverId}');
    final perm = ref.read(driverPermissionProvider);
    debugPrint('🟢 Background permission granted: ${perm.valueOrNull}');
  }

  void _connectRequests() {
    if (AppConfig.legacyBackend) {
      ref.watch(socketConnectionProvider);
      final socket = ref.read(socketIoServiceProvider);
      _legacyRideSub?.cancel();
      _legacyRideSub = socket.rideIncoming.listen((data) {
        if (!mounted) return;
        final pickup = data['pickup'] as Map<String, dynamic>?;
        final dropoff = data['dropoff'] as Map<String, dynamic>?;
        ref.read(driverProvider.notifier).setIncoming(IncomingRideRequest(
              tripId: data['ride_id']?.toString() ?? '',
              riderName: (data['rider_info'] as Map?)?['name'] as String? ?? 'Rider',
              pickup: pickup?['address'] as String? ?? '',
              dropoff: dropoff?['address'] as String? ?? '',
              fareCents: data['estimated_fare'] as int?,
              distanceKm: ((data['distance'] as num?) ?? 0) / 1000,
            ));
        _startCountdown();
      });
      return;
    }

    final driverId = ref.read(authProvider).user?.id ?? ApiConfig.defaultDriverId;
    if (kDebugMode) debugPrint('🔌 Driver WebSocket for driver_id=$driverId');

    _requestWs?.dispose();
    _requestWs = WebSocketService(
      path: '/ws/driver-requests/$driverId',
      onEvent: (event, data) {
        if (kDebugMode) debugPrint('📩 Driver WS event: $event data=$data');
        if (event == 'connected') return;
        if (event == 'driver_request' && mounted) {
          ref.read(driverProvider.notifier).setIncoming(IncomingRideRequest(
                tripId: data['trip_id'] as String,
                riderName: data['rider_name'] as String? ?? 'Rider',
                pickup: data['pickup'] as String? ?? '',
                dropoff: data['dropoff'] as String? ?? '',
                fareCents: data['fare_cents'] as int?,
                distanceKm: (data['distance_km'] as num?)?.toDouble(),
              ));
          _startCountdown();
        }
      },
    )..connect();
  }

  void _startCountdown() {
    _countdown?.cancel();
    var secs = 15;
    _countdown = Timer.periodic(const Duration(seconds: 1), (t) {
      secs--;
      if (secs <= 0) {
        ref.read(driverProvider.notifier).clearRequest();
        t.cancel();
      }
    });
  }

  Future<void> _toggleOnline(bool value) async {
    if (kDebugMode) {
      final user = ref.read(authProvider).user;
      debugPrint('🟢 User role: ${user?.role}');
      final hasBgPerm = ref.read(driverPermissionProvider);
      debugPrint('🟢 Background permission granted: ${hasBgPerm.valueOrNull}');
    }

    if (value) {
      if (!AppConfig.emulatorDev) {
        final hasBackgroundPermission = ref.read(driverProvider).hasBackgroundPermission ||
            await BackgroundLocationPermission.isGranted();

        if (!hasBackgroundPermission) {
          final result = await Permission.locationAlways.request();
          if (!result.isGranted) {
            if (mounted) await _showPermissionDeniedDialog(context);
            return;
          }
          ref.read(driverProvider.notifier).setBackgroundPermission(BackgroundPermissionState.granted);
        }

        if (BackgroundLocationPermission.isSupported) {
          final started = await DriverBackgroundService.startOnlineTracking();
          if (!started && mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'Could not start foreground service. Grant "Allow all the time" location and notifications.',
                ),
              ),
            );
            return;
          }
        }
      } else if (kDebugMode) {
        debugPrint('🟡 EMULATOR_DEV: skipping FGS and permission prompts');
        ref.read(driverProvider.notifier).setBackgroundPermission(BackgroundPermissionState.granted);
      }
    } else if (!AppConfig.emulatorDev) {
      await DriverBackgroundService.stopOnlineTracking();
    }

    ref.read(driverProvider.notifier).toggleOnline(value);

    final driverId = ref.read(authProvider).user?.id ?? ApiConfig.defaultDriverId;
    try {
      if (AppConfig.legacyBackend) {
        ref.watch(socketConnectionProvider);
        final socket = ref.read(socketIoServiceProvider);
        if (value) {
          await socket.connect();
          socket.emitDriverOnline(true);
          socket.emitDriverLocation(lat: _pos.latitude, lng: _pos.longitude);
          _connectRequests();
        } else {
          socket.emitDriverOnline(false);
        }
        if (kDebugMode) debugPrint('✅ Driver $driverId legacy online=$value');
        return;
      }

      await MobileApiService().updateAvailability(
        driverId: driverId,
        isOnline: value,
        location: GeoPoint(lat: _pos.latitude, lng: _pos.longitude),
      );
      if (value) _connectRequests();
      if (kDebugMode) debugPrint('✅ Driver $driverId isOnline=$value');
    } catch (e) {
      if (kDebugMode) debugPrint('❌ updateAvailability failed: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not go online: $e')));
      }
      ref.read(driverProvider.notifier).toggleOnline(false);
    }
  }

  Future<void> _showPermissionDeniedDialog(BuildContext context) async {
    if (!context.mounted) return;

    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Background location required'),
        content: const Text(
          'To go online, enable "Allow all the time" location access so you can '
          'receive ride requests when the app is in the background.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton.icon(
            onPressed: () async {
              Navigator.pop(ctx);
              await openAppSettings();
              ref.invalidate(driverPermissionProvider);
            },
            icon: const Icon(Icons.settings),
            label: const Text('Open Settings'),
          ),
        ],
      ),
    );
  }

  Future<void> _accept(IncomingRideRequest req) async {
    ref.read(driverProvider.notifier).setLoading(true);
    final driverId = ref.read(authProvider).user?.id ?? ApiConfig.defaultDriverId;
    try {
      if (AppConfig.legacyBackend) {
        final ride = await RidesApi().acceptRide(req.tripId);
        ref.read(driverProvider.notifier).clearRequest();
        if (mounted) context.go('/driver/active/${ride.rideId}');
        return;
      }
      final trip = await MobileApiService().acceptRide(req.tripId, driverId);
      ref.read(tripProvider.notifier).setCurrent(trip);
      ref.read(driverProvider.notifier).clearRequest();
      if (mounted) context.go('/driver/active/${trip.id}');
    } finally {
      ref.read(driverProvider.notifier).setLoading(false);
    }
  }

  @override
  void dispose() {
    DriverBackgroundService.stopOnlineTracking();
    _requestWs?.dispose();
    _legacyRideSub?.cancel();
    _locSub?.cancel();
    _countdown?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final driver = ref.watch(driverProvider);
    final user = ref.watch(authProvider).user;
    final req = driver.incomingRequest;

    if (kDebugMode) {
      ref.listen(driverPermissionProvider, (prev, next) {
        debugPrint('🟢 Background permission granted: ${next.valueOrNull}');
      });
      ref.watch(driverPermissionProvider);
    }

    return Scaffold(
      body: IndexedStack(
        index: _tab,
        children: [
          Stack(
            children: [
              RideMapWidget(center: _pos, showUserDot: true),
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
                        child: Row(
                          children: [
                            Text(
                              driver.isOnline ? 'Online' : 'Offline',
                              style: MrText.sans(weight: FontWeight.w600),
                            ),
                            if (kDebugMode && user != null)
                              Padding(
                                padding: const EdgeInsets.only(left: 8),
                                child: Text(
                                  user.role.name,
                                  style: MrText.sans(size: 10, color: MrColors.textSecondary),
                                ),
                              ),
                            const SizedBox(width: 8),
                            Switch(
                              value: driver.isOnline,
                              onChanged: _toggleOnline,
                              activeThumbColor: MrColors.secondary,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (req != null && driver.isOnline)
                _IncomingRequestModal(
                  request: req,
                  onAccept: () => _accept(req),
                  onReject: () async {
                    final driverId = ref.read(authProvider).user?.id ?? ApiConfig.defaultDriverId;
                    if (AppConfig.legacyBackend) {
                      await RidesApi().rejectRide(req.tripId);
                    } else {
                      await MobileApiService().rejectRide(req.tripId, driverId);
                    }
                    ref.read(driverProvider.notifier).clearRequest();
                  },
                ),
            ],
          ),
          _EarningsTab(earnings: driver.earningsToday),
          const _ProfileTab(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.attach_money), label: 'Earnings'),
          NavigationDestination(icon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}

class _IncomingRequestModal extends StatefulWidget {
  const _IncomingRequestModal({required this.request, required this.onAccept, required this.onReject});
  final IncomingRideRequest request;
  final VoidCallback onAccept;
  final VoidCallback onReject;

  @override
  State<_IncomingRequestModal> createState() => _IncomingRequestModalState();
}

class _IncomingRequestModalState extends State<_IncomingRequestModal> {
  int _secs = 15;
  late final Timer _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_secs <= 0) {
        widget.onReject();
        t.cancel();
        return;
      }
      setState(() => _secs--);
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black54,
      child: Center(
        child: Container(
          margin: const EdgeInsets.all(24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('New ride request', style: MrText.sans(size: 18, weight: FontWeight.w700)),
              Text('$_secs s', style: MrText.mono(size: 24, color: MrColors.accent)),
              const SizedBox(height: 16),
              Text(widget.request.riderName, style: MrText.sans(weight: FontWeight.w600)),
              Text('${widget.request.pickup} → ${widget.request.dropoff}'),
              if (widget.request.fareCents != null) Text('R${(widget.request.fareCents! / 100).toStringAsFixed(2)}'),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(child: OutlinedButton(onPressed: widget.onReject, child: const Text('Reject'))),
                  const SizedBox(width: 12),
                  Expanded(child: ElevatedButton(onPressed: widget.onAccept, child: const Text('Accept'))),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EarningsTab extends StatefulWidget {
  const _EarningsTab({required this.earnings});
  final double earnings;

  @override
  State<_EarningsTab> createState() => _EarningsTabState();
}

class _EarningsTabState extends State<_EarningsTab> {
  final _api = DriverEarningsApiService();
  double? _todayZar;
  double? _totalZar;
  int _trips = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await _api.summary();
      if (!mounted) return;
      setState(() {
        _todayZar = (data['today_zar'] as num?)?.toDouble();
        _totalZar = (data['total_zar'] as num?)?.toDouble();
        _trips = (data['trips'] as num?)?.toInt() ?? 0;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final today = _todayZar ?? widget.earnings;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text('Today', style: MrText.sans(size: 14, color: MrColors.textSecondary)),
          Text('R${today.toStringAsFixed(2)}', style: MrText.mono(size: 36, weight: FontWeight.w800)),
          const SizedBox(height: 16),
          if (_totalZar != null)
            Text('All time R${_totalZar!.toStringAsFixed(2)} · $_trips trips', style: MrText.sans(size: 14)),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: MrText.sans(size: 12, color: MrColors.error)),
          ],
          const SizedBox(height: 8),
          Text('Pull to refresh · 80% driver share', style: MrText.sans(size: 12, color: MrColors.textTertiary)),
        ],
      ),
    );
  }
}

class _ProfileTab extends StatelessWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context) => const Center(child: Text('Driver profile'));
}
