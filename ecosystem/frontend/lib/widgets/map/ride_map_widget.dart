import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/widgets/mr_layout.dart';

/// Production map — updates driver markers only when location shifts > 5 meters.
class RideMapWidget extends StatefulWidget {
  const RideMapWidget({
    super.key,
    required this.center,
    this.driverMarkers = const {},
    this.pickup,
    this.dropoff,
    this.routePoints = const [],
    this.showUserDot = true,
    this.driverHeading,
    this.minMarkerMoveMeters = 5,
  });

  final LatLng center;
  final Set<Marker> driverMarkers;
  final LatLng? pickup;
  final LatLng? dropoff;
  final List<LatLng> routePoints;
  final bool showUserDot;
  final double? driverHeading;
  final double minMarkerMoveMeters;

  @override
  State<RideMapWidget> createState() => _RideMapWidgetState();
}

class _RideMapWidgetState extends State<RideMapWidget> {
  GoogleMapController? _controller;
  LatLng? _lastCenter;
  Set<Marker> _renderedDriverMarkers = {};
  Set<Marker> _staticMarkers = {};

  @override
  void didUpdateWidget(RideMapWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    _maybeUpdateMarkers();
  }

  @override
  void initState() {
    super.initState();
    _maybeUpdateMarkers(force: true);
  }

  void _maybeUpdateMarkers({bool force = false}) {
    final moved = _lastCenter == null || _distanceMeters(_lastCenter!, widget.center) > widget.minMarkerMoveMeters;
    final driversChanged = widget.driverMarkers.length != _renderedDriverMarkers.length;
    if (!force && !moved && !driversChanged) return;

    _lastCenter = widget.center;
    _renderedDriverMarkers = widget.driverMarkers;
    _staticMarkers = {
      ...widget.driverMarkers,
      if (widget.pickup != null)
        Marker(
          markerId: const MarkerId('pickup'),
          position: widget.pickup!,
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
          infoWindow: const InfoWindow(title: 'Pickup'),
        ),
      if (widget.dropoff != null)
        Marker(
          markerId: const MarkerId('dropoff'),
          position: widget.dropoff!,
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
          infoWindow: const InfoWindow(title: 'Dropoff'),
        ),
    };
    if (mounted) setState(() {});
  }

  double _distanceMeters(LatLng a, LatLng b) {
    const r = 6371000.0;
    final dLat = _rad(b.latitude - a.latitude);
    final dLng = _rad(b.longitude - a.longitude);
    final lat1 = _rad(a.latitude);
    final lat2 = _rad(b.latitude);
    final h = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(lat1) * math.cos(lat2) * math.sin(dLng / 2) * math.sin(dLng / 2);
    return 2 * r * math.asin(math.sqrt(h));
  }

  double _rad(double deg) => deg * math.pi / 180;

  @override
  Widget build(BuildContext context) {
    if (!AppConfig.mapsEnabled) {
      return const MrMapPlaceholder();
    }

    final points = widget.routePoints.isNotEmpty
        ? widget.routePoints
        : [if (widget.pickup != null) widget.pickup!, if (widget.dropoff != null) widget.dropoff!];

    final polylines = points.length >= 2
        ? {
            Polyline(
              polylineId: const PolylineId('route'),
              points: points,
              color: const Color(0xFF0D9488),
              width: 5,
            ),
          }
        : <Polyline>{};

    return GoogleMap(
      initialCameraPosition: CameraPosition(target: widget.center, zoom: 14),
      myLocationEnabled: widget.showUserDot,
      myLocationButtonEnabled: false,
      zoomControlsEnabled: false,
      markers: _staticMarkers,
      polylines: polylines,
      onMapCreated: (c) {
        _controller = c;
        if (points.length >= 2) {
          _controller?.animateCamera(CameraUpdate.newLatLngBounds(_boundsFrom(points), 64));
        }
      },
    );
  }

  LatLngBounds _boundsFrom(List<LatLng> points) {
    var minLat = points.first.latitude;
    var maxLat = points.first.latitude;
    var minLng = points.first.longitude;
    var maxLng = points.first.longitude;
    for (final p in points) {
      minLat = math.min(minLat, p.latitude);
      maxLat = math.max(maxLat, p.latitude);
      minLng = math.min(minLng, p.longitude);
      maxLng = math.max(maxLng, p.longitude);
    }
    return LatLngBounds(southwest: LatLng(minLat, minLng), northeast: LatLng(maxLat, maxLng));
  }
}
