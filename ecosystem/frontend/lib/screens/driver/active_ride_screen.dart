import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/providers/driver_provider.dart';
import 'package:my_ride/providers/trip_provider.dart';
import 'package:my_ride/services/mobile_api_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/map/ride_map_widget.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';

enum _RidePhase { toPickup, atPickup, inProgress, toDropoff }

class ActiveRideScreen extends ConsumerStatefulWidget {
  const ActiveRideScreen({super.key, required this.tripId});
  final String tripId;

  @override
  ConsumerState<ActiveRideScreen> createState() => _ActiveRideScreenState();
}

class _ActiveRideScreenState extends ConsumerState<ActiveRideScreen> {
  _RidePhase _phase = _RidePhase.toPickup;
  Trip? _trip;
  LatLng _driver = const LatLng(-33.9249, 18.4241);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _trip = ref.read(tripProvider).currentTrip;
    });
  }

  Future<void> _arrived() async {
    final trip = await MobileApiService().driverArrived(widget.tripId);
    setState(() { _trip = trip; _phase = _RidePhase.atPickup; });
  }

  Future<void> _start() async {
    final trip = await MobileApiService().startRide(widget.tripId);
    setState(() { _trip = trip; _phase = _RidePhase.inProgress; });
  }

  Future<void> _complete() async {
    final trip = await MobileApiService().completeRide(widget.tripId);
    ref.read(driverProvider.notifier).addEarnings((trip.fareEstimate ?? 24.5));
    if (mounted) context.go('/driver/home');
  }

  @override
  Widget build(BuildContext context) {
    final trip = _trip;
    final pickup = trip != null ? LatLng(trip.pickup.lat, trip.pickup.lng) : null;
    final dropoff = trip != null ? LatLng(trip.dropoff.lat, trip.dropoff.lng) : null;
    final dest = _phase == _RidePhase.inProgress || _phase == _RidePhase.toDropoff ? dropoff : pickup;

    return Scaffold(
      appBar: AppBar(title: Text(trip?.pickupAddress ?? 'Active ride')),
      body: Stack(
        children: [
          RideMapWidget(
            center: _driver,
            pickup: pickup,
            dropoff: dropoff,
            routePoints: dest != null ? [_driver, dest] : [],
          ),
          Positioned(
            left: 0, right: 0, bottom: 0,
            child: Container(
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(color: Colors.white, borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
              child: SafeArea(
                top: false,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('Turn-by-turn', style: MrText.sans(weight: FontWeight.w700)),
                    Text('Head north on ${trip?.pickupAddress ?? 'Main St'}', style: MrText.sans(size: 13, color: MrColors.textSecondary)),
                    const SizedBox(height: 16),
                    if (_phase == _RidePhase.toPickup)
                      MrGlowButton(label: 'Arrived at Pickup', fullWidth: true, onPressed: _arrived)
                    else if (_phase == _RidePhase.atPickup)
                      MrGlowButton(label: 'Start Ride', fullWidth: true, onPressed: _start)
                    else
                      MrGlowButton(label: 'Complete Ride', fullWidth: true, onPressed: _complete),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
