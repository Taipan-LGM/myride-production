import 'package:flutter/material.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';

class IncomingRideWidget extends StatelessWidget {
  const IncomingRideWidget({
    super.key,
    required this.rideId,
    required this.pickup,
    required this.dropoff,
    this.fareCents,
    this.distanceMeters,
    this.onAccept,
    this.onDecline,
    this.secondsRemaining = 30,
  });

  final String rideId;
  final String pickup;
  final String dropoff;
  final int? fareCents;
  final int? distanceMeters;
  final VoidCallback? onAccept;
  final VoidCallback? onDecline;
  final int secondsRemaining;

  String get _fareLabel {
    if (fareCents == null) return '—';
    return 'R ${(fareCents! / 100).toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 12,
      borderRadius: BorderRadius.circular(20),
      color: Colors.white,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Text('New ride request', style: MrText.sans(size: 18, weight: FontWeight.w700)),
                const Spacer(),
                Chip(
                  label: Text('${secondsRemaining}s'),
                  backgroundColor: MrColors.secondary.withValues(alpha: 0.2),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text('Pickup', style: MrText.sans(size: 12, color: MrColors.neutral900.withValues(alpha: 0.5))),
            Text(pickup, style: MrText.sans(size: 14, weight: FontWeight.w600)),
            const SizedBox(height: 8),
            Text('Dropoff', style: MrText.sans(size: 12, color: MrColors.neutral900.withValues(alpha: 0.5))),
            Text(dropoff, style: MrText.sans(size: 14, weight: FontWeight.w600)),
            const SizedBox(height: 12),
            Text('Fare $_fareLabel', style: MrText.sans(size: 16, weight: FontWeight.w700, color: MrColors.secondary)),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onDecline,
                    child: const Text('Decline'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: MrColors.secondary, foregroundColor: MrColors.primary),
                    onPressed: onAccept,
                    child: const Text('Accept'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
