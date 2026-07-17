import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_theme.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';

class DriverKycStatusScreen extends StatelessWidget {
  const DriverKycStatusScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: myRideDriverTheme(),
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(MrSpacing.md),
            child: Column(
              children: [
                const SizedBox(height: 40),
                const CircularProgressIndicator(color: MrColors.warning, strokeWidth: 6),
                const SizedBox(height: MrSpacing.lg),
                const Text('Verification in progress', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: MrColors.textInverse)),
                const Text('Usually completes within 24–48 hours', style: TextStyle(color: MrColors.textTertiary)),
                const SizedBox(height: MrSpacing.xl),
                _statusRow('Personal info', true),
                _statusRow('Documents', true),
                _statusRow('Vehicle registration', true),
                _statusRow('Background check', false, inReview: true),
                const Spacer(),
                MrButton(label: 'Preview approved state', variant: MrButtonVariant.driverAccept, fullWidth: true, onPressed: () => context.go('/driver/trip-request')),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _statusRow(String label, bool done, {bool inReview = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Icon(done && !inReview ? Icons.check_circle : Icons.timelapse, color: done && !inReview ? MrColors.success : MrColors.warning, size: 20),
          const SizedBox(width: 12),
          Expanded(child: Text(label, style: const TextStyle(color: MrColors.textInverse))),
          Text(
            inReview ? 'In review' : (done ? 'Complete' : 'Pending'),
            style: TextStyle(fontSize: 12, color: inReview ? MrColors.warning : (done ? MrColors.success : MrColors.textTertiary)),
          ),
        ],
      ),
    );
  }
}
