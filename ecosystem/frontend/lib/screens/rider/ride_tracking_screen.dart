import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/models/ride/ride_status.dart';
import 'package:my_ride/providers/ride_provider.dart';
import 'package:my_ride/providers/socket_provider.dart';
import 'package:my_ride/providers/trip_provider.dart';
import 'package:my_ride/screens/call/call_screen.dart';
import 'package:my_ride/services/api/rides_api.dart';
import 'package:my_ride/services/mobile_api_service.dart';
import 'package:my_ride/services/websocket_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/common/mr_cached_avatar.dart';
import 'package:my_ride/widgets/common/mr_error_snackbar.dart';
import 'package:my_ride/widgets/map/ride_map_widget.dart';
import 'package:my_ride/widgets/motion/mr_live_badge.dart';
import 'package:my_ride/widgets/ride/ride_status_indicator.dart';
import 'package:my_ride/widgets/safety/sos_actions.dart';

class RideTrackingScreen extends ConsumerStatefulWidget {
  const RideTrackingScreen({super.key, required this.tripId});
  final String tripId;

  @override
  ConsumerState<RideTrackingScreen> createState() => _RideTrackingScreenState();
}

class _RideTrackingScreenState extends ConsumerState<RideTrackingScreen> {
  WebSocketService? _ws;
  StreamSubscription<Map<String, dynamic>>? _legacyLocSub;
  StreamSubscription<RideStatusUpdate>? _legacyStatusSub;
  StreamSubscription<Map<String, dynamic>>? _legacyEtaSub;
  Trip? _trip;
  RideStatusUpdate? _legacyRide;
  LatLng _driverPos = LatLng(ApiConfig.defaultLat + 0.002, ApiConfig.defaultLng + 0.002);
  int _eta = 4;

  bool get _legacy => AppConfig.legacyBackend;

  @override
  void initState() {
    super.initState();
    // Riverpod context is unsafe inside initState — defer to after first frame.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (_legacy) {
        _loadLegacyRide();
        _connectLegacySocket();
      } else {
        _loadTrip();
        _connectWs();
      }
    });
  }

  Future<void> _loadLegacyRide() async {
    try {
      final ride = await RidesApi().getRide(widget.tripId);
      if (!mounted) return;
      setState(() => _legacyRide = ride ?? ref.read(rideProvider).currentRide);
      ref.read(socketIoServiceProvider).joinRide(widget.tripId);
    } catch (e) {
      if (mounted) MrErrorSnackbar.showException(context, e, onRetry: _loadLegacyRide);
    }
  }

  void _connectLegacySocket() {
    ref.read(socketConnectionProvider);
    final socket = ref.read(socketIoServiceProvider);
    socket.joinRide(widget.tripId);
    socket.requestDriverLocation(widget.tripId);

    _legacyLocSub = socket.driverLocation.listen((data) {
      if (!mounted) return;
      final loc = data['location'] as Map<String, dynamic>?;
      if (loc != null) {
        setState(() {
          _driverPos = LatLng((loc['lat'] as num).toDouble(), (loc['lng'] as num).toDouble());
        });
      }
    });

    _legacyStatusSub = socket.rideStatus.listen((status) {
      if (!mounted) return;
      setState(() => _legacyRide = status);
      if (status.rideStatus == RideStatus.completed) {
        context.go('/rider/home');
      }
    });

    _legacyEtaSub = socket.rideEta.listen((data) {
      if (!mounted) return;
      final eta = (data['eta_to_pickup'] as num?)?.round();
      if (eta != null) setState(() => _eta = eta);
    });
  }

  Future<void> _loadTrip() async {
    try {
      final trips = await MobileApiService().listTrips();
      Trip? trip;
      for (final t in trips) {
        if (t.id == widget.tripId) {
          trip = t;
          break;
        }
      }
      trip ??= ref.read(tripProvider).currentTrip;
      if (trip == null || trip.id != widget.tripId) {
        setState(() => _trip = Trip(
          id: widget.tripId,
          riderId: ApiConfig.defaultRiderId,
          status: TripStatus.requested,
          pickup: GeoPoint(lat: ApiConfig.defaultLat, lng: ApiConfig.defaultLng),
          dropoff: const GeoPoint(lat: -33.9180, lng: 18.4232),
        ));
        return;
      }
      setState(() => _trip = trip);
      ref.read(tripProvider.notifier).setCurrent(trip);
    } catch (e) {
      if (mounted) MrErrorSnackbar.showException(context, e, onRetry: _loadTrip);
    }
  }

  void _connectWs() {
    _ws = WebSocketService(
      path: '/ws/trips/${widget.tripId}',
      onEvent: (event, data) {
        if (!mounted) return;
        if (event == 'trip.status' || event == 'trip_update') {
          final status = data['status'] as String?;
          if (status == 'completed' && mounted) {
            context.go('/rider/payment', extra: _trip);
          }
        }
        if (data.containsKey('lat') && data.containsKey('lng')) {
          setState(() => _driverPos = LatLng((data['lat'] as num).toDouble(), (data['lng'] as num).toDouble()));
        }
      },
    )..connect();
  }

  Future<void> _cancelRide() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Cancel ride?'),
        content: const Text('A cancellation fee may apply.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('No')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Yes, cancel')),
        ],
      ),
    );
    if (ok == true) {
      try {
        if (_legacy) {
          await ref.read(rideProvider.notifier).cancelRide();
        } else {
          await MobileApiService().cancelRide(widget.tripId);
        }
        if (mounted) context.go('/rider/home');
      } catch (e) {
        if (mounted) MrErrorSnackbar.showException(context, e, onRetry: _cancelRide);
      }
    }
  }

  @override
  void dispose() {
    _ws?.dispose();
    _legacyLocSub?.cancel();
    _legacyStatusSub?.cancel();
    _legacyEtaSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_legacy) {
      final ride = _legacyRide ?? ref.watch(rideProvider).currentRide;
      final status = ride?.rideStatus ?? RideStatus.searching;
      final driverName = ride?.driver?.name ?? 'Your driver';
      final plate = ride?.driver?.vehicle['plate'] as String? ??
          ride?.driver?.vehicle['plate_number'] as String? ??
          '—';

      return Scaffold(
        body: Stack(
          children: [
            RideMapWidget(
              center: _driverPos,
              driverMarkers: {
                Marker(
                  markerId: const MarkerId('driver'),
                  position: _driverPos,
                  icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
                ),
              },
            ),
            SafeArea(
              child: Column(
                children: [
                  Container(
                    margin: const EdgeInsets.all(16),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: MrElevation.card,
                    ),
                    child: Row(
                      children: [
                        MrCachedAvatar(name: driverName, radius: 26),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Text(driverName, style: MrText.sans(weight: FontWeight.w700)),
                                  const SizedBox(width: 6),
                                  const MrLiveBadge(),
                                ],
                              ),
                              Text(plate, style: MrText.sans(size: 12, color: MrColors.textSecondary)),
                            ],
                          ),
                        ),
                        Text('$_eta min', style: MrText.mono(size: 22, weight: FontWeight.w800, color: MrColors.secondary)),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: RideStatusIndicator(status: status, etaMinutes: _eta),
                  ),
                  const Spacer(),
                  Container(
                    margin: const EdgeInsets.all(16),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _ActionBtn(icon: Icons.phone, label: 'Call', onTap: () {}),
                        _ActionBtn(
                          icon: Icons.sos,
                          label: 'SOS',
                          color: MrColors.error,
                          onTap: () => SosActions.trigger(context, tripId: widget.tripId, note: 'Live trip SOS'),
                        ),
                        _ActionBtn(icon: Icons.cancel, label: 'Cancel', color: MrColors.accent, onTap: _cancelRide),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    final trip = _trip ?? ref.watch(tripProvider).currentTrip;
    final status = trip?.status ?? TripStatus.driverArriving;
    return Scaffold(
      body: Stack(
        children: [
          RideMapWidget(
            center: _driverPos,
            driverMarkers: {
              Marker(markerId: const MarkerId('driver'), position: _driverPos, icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen)),
            },
            pickup: trip != null ? LatLng(trip.pickup.lat, trip.pickup.lng) : null,
            dropoff: trip != null ? LatLng(trip.dropoff.lat, trip.dropoff.lng) : null,
          ),
          SafeArea(
            child: Column(
              children: [
                Container(
                  margin: const EdgeInsets.all(16),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: MrElevation.card),
                  child: Row(
                    children: [
                      const MrCachedAvatar(
                        name: 'James Driver',
                        imageUrl: 'https://i.pravatar.cc/150?u=driver-demo-001',
                        radius: 26,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(children: [Text('James Driver', style: MrText.sans(weight: FontWeight.w700)), const SizedBox(width: 6), const MrLiveBadge()]),
                            Text('Toyota Camry · CA 123-456 · 4.9★', style: MrText.sans(size: 12, color: MrColors.textSecondary)),
                          ],
                        ),
                      ),
                      Text('$_eta min', style: MrText.mono(size: 22, weight: FontWeight.w800, color: MrColors.secondary)),
                    ],
                  ),
                ),
                _StatusTimeline(status: status),
                const Spacer(),
                Container(
                  margin: const EdgeInsets.all(16),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      _ActionBtn(icon: Icons.phone, label: 'Call AI', onTap: () => openCallAiDialog(context, tripId: widget.tripId)),
                      _ActionBtn(icon: Icons.chat, label: 'Message', onTap: () => context.push('/chat/${widget.tripId}')),
                      _ActionBtn(
                        icon: Icons.sos,
                        label: 'SOS',
                        color: MrColors.error,
                        onTap: () => SosActions.trigger(
                          context,
                          tripId: widget.tripId,
                          lat: trip?.pickup.lat,
                          lng: trip?.pickup.lng,
                          note: 'Live trip SOS',
                        ),
                      ),
                      _ActionBtn(icon: Icons.cancel, label: 'Cancel', color: MrColors.accent, onTap: _cancelRide),
                    ],
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

class _StatusTimeline extends StatelessWidget {
  const _StatusTimeline({required this.status});
  final TripStatus status;

  @override
  Widget build(BuildContext context) {
    final steps = ['Driver assigned', 'Driver arrived', 'Ride started', 'Completed'];
    final idx = switch (status) {
      TripStatus.driverAssigned || TripStatus.driverArriving => 0,
      TripStatus.inProgress => 2,
      TripStatus.completed => 3,
      _ => 0,
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: List.generate(steps.length, (i) => Expanded(
          child: Column(
            children: [
              Container(
                width: 10, height: 10,
                decoration: BoxDecoration(shape: BoxShape.circle, color: i <= idx ? MrColors.secondary : MrColors.mapRoadLight),
              ),
              const SizedBox(height: 4),
              Text(steps[i], style: MrText.sans(size: 9), textAlign: TextAlign.center),
            ],
          ),
        )),
      ),
    );
  }
}

class _ActionBtn extends StatelessWidget {
  const _ActionBtn({required this.icon, required this.label, required this.onTap, this.color});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(children: [
          Icon(icon, color: color ?? MrColors.primary),
          Text(label, style: MrText.sans(size: 11)),
        ]),
      ),
    );
  }
}
