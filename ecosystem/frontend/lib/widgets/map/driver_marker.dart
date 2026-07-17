import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:my_ride/models/ride/nearby_driver.dart';
import 'package:my_ride/theme/mr_tokens.dart';

Set<Marker> buildNearbyDriverMarkers(List<NearbyDriver> drivers) {
  return drivers.map((d) {
    return Marker(
      markerId: MarkerId('driver_${d.driverId}'),
      position: LatLng(d.location.lat, d.location.lng),
      icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
      infoWindow: InfoWindow(
        title: d.name,
        snippet: '${d.formattedDistance} · ${d.etaMinutes} min',
      ),
    );
  }).toSet();
}

class DriverMapMarker extends StatelessWidget {
  const DriverMapMarker({super.key, required this.driver, this.onTap});

  final NearbyDriver driver;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: MrColors.secondary,
            borderRadius: BorderRadius.circular(12),
            boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4)],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.local_taxi, size: 16, color: MrColors.primary),
              const SizedBox(width: 4),
              Text(
                driver.formattedDistance,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: MrColors.primary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
