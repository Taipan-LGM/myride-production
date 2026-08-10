import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_theme.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_badge.dart';
import 'package:my_ride/widgets/mr_button.dart';

class DriverKycDocumentsScreen extends StatelessWidget {
  const DriverKycDocumentsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: myRideDriverTheme(),
      child: Scaffold(
        appBar: AppBar(title: const Text('Upload documents'), backgroundColor: MrColors.surfaceDriverDark),
        body: Padding(
          padding: const EdgeInsets.all(MrSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(MrSpacing.md),
                decoration: BoxDecoration(
                  color: MrColors.surfaceDriverPanel,
                  borderRadius: BorderRadius.circular(MrRadius.lg),
                  border: Border.all(color: MrColors.success, width: 2),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Driver\'s license', style: TextStyle(color: MrColors.success, fontWeight: FontWeight.w600)),
                    SizedBox(height: 8),
                    MrBadge(label: 'Verified', variant: MrBadgeVariant.success),
                  ],
                ),
              ),
              const SizedBox(height: MrSpacing.md),
              Container(
                width: double.infinity,
                height: 100,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: MrColors.surfaceDriverPanel,
                  borderRadius: BorderRadius.circular(MrRadius.lg),
                  border: Border.all(color: MrColors.borderDefault),
                ),
                child: const Text('Tap to upload National ID', style: TextStyle(color: MrColors.textTertiary)),
              ),
              const Spacer(),
              MrButton(label: 'Continue', variant: MrButtonVariant.driverAccept, fullWidth: true, onPressed: () => context.go('/driver/kyc/vehicle')),
            ],
          ),
        ),
      ),
    );
  }
}
