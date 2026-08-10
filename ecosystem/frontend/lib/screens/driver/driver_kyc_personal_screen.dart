import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_theme.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';
import 'package:my_ride/widgets/mr_input.dart';
import 'package:my_ride/widgets/mr_layout.dart';

class DriverKycPersonalScreen extends StatelessWidget {
  const DriverKycPersonalScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: myRideDriverTheme(),
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(MrSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const MrBrandHeader(subtitle: 'KYC · Step 1/4', onDark: true, driverMode: true),
                const SizedBox(height: MrSpacing.lg),
                const Text('Personal information', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: MrColors.textInverse)),
                const SizedBox(height: MrSpacing.lg),
                const MrInput(label: 'Full legal name'),
                const SizedBox(height: MrSpacing.md),
                const MrInput(label: 'Date of birth'),
                const SizedBox(height: MrSpacing.md),
                const MrInput(label: 'Email address'),
                const Spacer(),
                MrButton(label: 'Continue', variant: MrButtonVariant.driverAccept, fullWidth: true, onPressed: () => context.go('/driver/kyc/documents')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
