import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';

class RiderOnboardingPaymentScreen extends StatelessWidget {
  const RiderOnboardingPaymentScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(MrSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Add payment method', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
              const SizedBox(height: MrSpacing.sm),
              const Text('Pay seamlessly after every My Ride trip.', style: TextStyle(fontSize: 15, color: MrColors.textSecondary)),
              const SizedBox(height: MrSpacing.lg),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(MrSpacing.md),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(MrRadius.lg),
                  gradient: const LinearGradient(colors: [MrColors.brandPrimaryDark, MrColors.brandPrimary]),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('MY RIDE WALLET', style: TextStyle(fontSize: 13, color: MrColors.brandPrimaryMuted)),
                    SizedBox(height: 8),
                    Text('•••• •••• •••• 4242', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Colors.white)),
                    Text('Visa · Exp 12/28', style: TextStyle(fontSize: 12, color: MrColors.brandPrimaryMuted)),
                  ],
                ),
              ),
              const SizedBox(height: MrSpacing.md),
              _PaymentOption(label: 'Add credit or debit card', icon: Icons.credit_card),
              _PaymentOption(label: 'Apple Pay / Google Pay', icon: Icons.phone_iphone),
              _PaymentOption(label: 'Cash (pay driver directly)', icon: Icons.payments_outlined),
              const Spacer(),
              MrButton(label: 'Start riding with My Ride', fullWidth: true, onPressed: () => context.go('/rider/home')),
              const SizedBox(height: MrSpacing.sm),
              Center(child: TextButton(onPressed: () => context.go('/rider/home'), child: const Text('Skip — add payment later'))),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaymentOption extends StatelessWidget {
  const _PaymentOption({required this.label, required this.icon});

  final String label;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: MrSpacing.sm),
      padding: const EdgeInsets.symmetric(horizontal: MrSpacing.md, vertical: MrSpacing.md),
      decoration: BoxDecoration(
        color: MrColors.surfaceCard,
        borderRadius: BorderRadius.circular(MrRadius.md),
        border: Border.all(color: MrColors.borderDefault),
      ),
      child: Row(children: [Icon(icon, color: MrColors.textPrimary), const SizedBox(width: 12), Text(label)]),
    );
  }
}
