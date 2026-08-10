import 'package:flutter/material.dart';
import 'package:my_ride/models/ride/ride_status.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';

class RideStatusIndicator extends StatelessWidget {
  const RideStatusIndicator({
    super.key,
    required this.status,
    this.etaMinutes,
    this.compact = false,
  });

  final RideStatus status;
  final int? etaMinutes;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final (label, color, icon) = _style(status);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 14, vertical: compact ? 6 : 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(compact ? 8 : 12),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: compact ? 16 : 20, color: color),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, style: MrText.sans(size: compact ? 12 : 14, weight: FontWeight.w700, color: color)),
              if (etaMinutes != null && status.isActive)
                Text(
                  'ETA $etaMinutes min',
                  style: MrText.sans(size: 11, color: MrColors.neutral900.withValues(alpha: 0.6)),
                ),
            ],
          ),
        ],
      ),
    );
  }

  (String, Color, IconData) _style(RideStatus status) => switch (status) {
        RideStatus.requested || RideStatus.searching => ('Finding driver', MrColors.secondary, Icons.search),
        RideStatus.matched => ('Driver matched', MrColors.secondary, Icons.check_circle_outline),
        RideStatus.accepted || RideStatus.arriving => ('Driver arriving', Colors.blue, Icons.directions_car),
        RideStatus.inProgress => ('On trip', MrColors.primary, Icons.navigation),
        RideStatus.completed => ('Completed', Colors.green, Icons.flag),
        RideStatus.cancelled => ('Cancelled', MrColors.accent, Icons.cancel_outlined),
        RideStatus.declined => ('Declined', MrColors.accent, Icons.block),
      };
}
