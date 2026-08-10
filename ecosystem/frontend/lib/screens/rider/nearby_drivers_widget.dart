import 'package:flutter/material.dart';
import 'package:my_ride/models/ride/nearby_driver.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';

class NearbyDriversWidget extends StatelessWidget {
  const NearbyDriversWidget({
    super.key,
    required this.drivers,
    this.isLoading = false,
    this.error,
    this.onRefresh,
  });

  final List<NearbyDriver> drivers;
  final bool isLoading;
  final String? error;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (error != null) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text(error!, style: MrText.sans(size: 13, color: MrColors.accent)),
            if (onRefresh != null)
              TextButton(onPressed: onRefresh, child: const Text('Retry')),
          ],
        ),
      );
    }

    if (drivers.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'No drivers nearby right now',
          style: MrText.sans(size: 14, color: MrColors.neutral900.withValues(alpha: 0.6)),
        ),
      );
    }

    return Material(
      elevation: 6,
      borderRadius: BorderRadius.circular(16),
      color: Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Text('${drivers.length} drivers nearby', style: MrText.sans(size: 14, weight: FontWeight.w700)),
                const Spacer(),
                if (onRefresh != null)
                  IconButton(
                    icon: const Icon(Icons.refresh, size: 20),
                    onPressed: onRefresh,
                    tooltip: 'Refresh',
                  ),
              ],
            ),
            const SizedBox(height: 8),
            ...drivers.take(3).map(
                  (d) => ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                      backgroundColor: MrColors.secondary.withValues(alpha: 0.2),
                      child: const Icon(Icons.local_taxi, color: MrColors.primary, size: 18),
                    ),
                    title: Text(d.name, style: MrText.sans(size: 13, weight: FontWeight.w600)),
                    subtitle: Text(
                      '${d.vehicle.vehicleType} · ${d.vehicle.plateNumber}',
                      style: MrText.sans(size: 12),
                    ),
                    trailing: Text(
                      '${d.etaMinutes} min',
                      style: MrText.sans(size: 12, weight: FontWeight.w700, color: MrColors.secondary),
                    ),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}
