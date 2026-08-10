import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';
import 'package:my_ride/widgets/mr_vehicle_option.dart';

class RiderScheduleRideScreen extends StatefulWidget {
  const RiderScheduleRideScreen({super.key});

  @override
  State<RiderScheduleRideScreen> createState() => _RiderScheduleRideScreenState();
}

class _RiderScheduleRideScreenState extends State<RiderScheduleRideScreen> {
  int _vehicle = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Schedule a ride'), leading: BackButton(onPressed: () => context.go('/rider/home'))),
      body: Padding(
        padding: const EdgeInsets.all(MrSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Book up to 7 days ahead with My Ride.', style: TextStyle(color: MrColors.textSecondary)),
            const SizedBox(height: MrSpacing.lg),
            const Text('Pickup', style: TextStyle(fontSize: 12, color: MrColors.textSecondary)),
            _field('42 Market Street'),
            const SizedBox(height: MrSpacing.md),
            const Text('Destination', style: TextStyle(fontSize: 12, color: MrColors.textSecondary)),
            _field('Where to?', muted: true),
            const SizedBox(height: MrSpacing.md),
            Row(
              children: [
                Expanded(child: _field('Sat, 12 Jul', selected: true)),
                const SizedBox(width: 12),
                Expanded(child: _field('08:30 AM', selected: true)),
              ],
            ),
            const SizedBox(height: MrSpacing.md),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                MrVehicleOption(name: 'Standard', fareRange: '\$14–18', icon: Icons.directions_car, selected: _vehicle == 0, onTap: () => setState(() => _vehicle = 0)),
                MrVehicleOption(name: 'Comfort', fareRange: '\$18–24', icon: Icons.airport_shuttle, selected: _vehicle == 1, onTap: () => setState(() => _vehicle = 1)),
              ],
            ),
            const Spacer(),
            MrButton(label: 'Schedule My Ride', fullWidth: true, onPressed: () => context.go('/rider/scheduled')),
          ],
        ),
      ),
    );
  }

  Widget _field(String text, {bool muted = false, bool selected = false}) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(MrSpacing.md),
      decoration: BoxDecoration(
        color: MrColors.surfaceCard,
        borderRadius: BorderRadius.circular(MrRadius.md),
        border: Border.all(color: selected ? MrColors.brandPrimary : MrColors.borderDefault, width: selected ? 2 : 1),
      ),
      child: Text(text, style: TextStyle(color: muted ? MrColors.textTertiary : MrColors.textPrimary)),
    );
  }
}
