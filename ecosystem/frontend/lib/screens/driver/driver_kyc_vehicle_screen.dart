import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_theme.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';
import 'package:my_ride/widgets/mr_input.dart';

class DriverKycVehicleScreen extends StatefulWidget {
  const DriverKycVehicleScreen({super.key});

  @override
  State<DriverKycVehicleScreen> createState() => _DriverKycVehicleScreenState();
}

class _DriverKycVehicleScreenState extends State<DriverKycVehicleScreen> {
  int _class = 0;

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: myRideDriverTheme(),
      child: Scaffold(
        appBar: AppBar(title: const Text('Vehicle registration'), backgroundColor: MrColors.surfaceDriverDark),
        body: Padding(
          padding: const EdgeInsets.all(MrSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _classChip(0, 'Standard', Icons.directions_car),
                  const SizedBox(width: 8),
                  _classChip(1, 'Comfort', Icons.airport_shuttle),
                  const SizedBox(width: 8),
                  _classChip(2, 'XL', Icons.electric_bolt),
                ],
              ),
              const SizedBox(height: MrSpacing.lg),
              const MrInput(label: 'Make & model'),
              const SizedBox(height: MrSpacing.md),
              const MrInput(label: 'License plate'),
              const Spacer(),
              MrButton(label: 'Continue', variant: MrButtonVariant.driverAccept, fullWidth: true, onPressed: () => context.go('/driver/kyc/status')),
            ],
          ),
        ),
      ),
    );
  }

  Widget _classChip(int index, String label, IconData icon) {
    final selected = _class == index;
    return Expanded(
      child: InkWell(
        onTap: () => setState(() => _class = index),
        child: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: MrColors.surfaceDriverPanel,
            borderRadius: BorderRadius.circular(MrRadius.md),
            border: Border.all(color: selected ? MrColors.success : MrColors.borderDefault, width: selected ? 2 : 1),
          ),
          child: Column(children: [Icon(icon), Text(label, style: TextStyle(fontSize: 11, color: selected ? MrColors.success : MrColors.textTertiary))]),
        ),
      ),
    );
  }
}
