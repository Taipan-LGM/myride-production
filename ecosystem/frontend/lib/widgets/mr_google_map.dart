import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/widgets/mr_layout.dart';

/// Google Map when API key is set; design placeholder otherwise.
class MrGoogleMap extends StatefulWidget {
  const MrGoogleMap({
    super.key,
    this.height,
    this.expand = false,
    this.showUserMarker = true,
    this.showRoute = false,
    this.onDark = false,
    this.initialTarget = const LatLng(37.7749, -122.4194),
  });

  final double? height;
  final bool expand;
  final bool showUserMarker;
  final bool showRoute;
  final bool onDark;
  final LatLng initialTarget;

  @override
  State<MrGoogleMap> createState() => _MrGoogleMapState();
}

class _MrGoogleMapState extends State<MrGoogleMap> {
  GoogleMapController? _controller;

  @override
  Widget build(BuildContext context) {
    if (!AppConfig.mapsEnabled) {
      if (widget.expand) {
        return const MrMapPlaceholder();
      }
      return MrMapPlaceholder(height: widget.height ?? 280, onDark: widget.onDark);
    }

    final markers = <Marker>{
      if (widget.showUserMarker)
        Marker(markerId: const MarkerId('user'), position: widget.initialTarget, icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueCyan)),
      if (widget.showRoute)
        Marker(markerId: const MarkerId('destination'), position: const LatLng(37.7849, -122.4094), icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange)),
    };

    final polylines = widget.showRoute
        ? {
            Polyline(
              polylineId: const PolylineId('route'),
              points: [widget.initialTarget, const LatLng(37.7849, -122.4094)],
              color: const Color(0xFF0D9488),
              width: 5,
            ),
          }
        : <Polyline>{};

    final map = GoogleMap(
      initialCameraPosition: CameraPosition(target: widget.initialTarget, zoom: 14),
      myLocationEnabled: true,
      myLocationButtonEnabled: false,
      zoomControlsEnabled: false,
      markers: markers,
      polylines: polylines,
      onMapCreated: (c) => _controller = c,
    );

    if (widget.expand) {
      return map;
    }
    return SizedBox(height: widget.height ?? 280, child: map);
  }
}
