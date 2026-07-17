import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';

class HubScreen extends StatelessWidget {
  const HubScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(MrSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'MY RIDE',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 2,
                  color: MrColors.brandPrimary,
                ),
              ),
              const SizedBox(height: MrSpacing.sm),
              const Text(
                'E-hailing ecosystem',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: MrSpacing.sm),
              const Text(
                'Choose a journey to preview the Flutter implementation.',
                style: TextStyle(fontSize: 15, color: MrColors.textSecondary),
              ),
              const SizedBox(height: MrSpacing.xl),
              _HubCard(
                title: 'Rider app',
                subtitle: 'Onboarding → book → live trip → receipt → wallet',
                icon: Icons.person_pin_circle_outlined,
                onTap: () => context.go('/rider/onboarding/phone'),
              ),
              const SizedBox(height: MrSpacing.md),
              _HubCard(
                title: 'Driver app',
                subtitle: 'KYC → trip request → earnings',
                icon: Icons.local_taxi_outlined,
                onTap: () => context.go('/driver/kyc/personal'),
              ),
              const Spacer(),
              Text(
                'Web prototypes: open ecosystem/prototypes/index.html locally',
                style: TextStyle(fontSize: 12, color: MrColors.textTertiary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HubCard extends StatelessWidget {
  const _HubCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: MrColors.surfaceCard,
      borderRadius: BorderRadius.circular(MrRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(MrRadius.md),
        child: Container(
          padding: const EdgeInsets.all(MrSpacing.md),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(MrRadius.md),
            border: Border.all(color: MrColors.borderDefault),
          ),
          child: Row(
            children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: MrColors.brandPrimaryLight,
                child: Icon(icon, color: MrColors.brandPrimary, size: 28),
              ),
              const SizedBox(width: MrSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(subtitle, style: const TextStyle(fontSize: 13, color: MrColors.textSecondary)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: MrColors.textTertiary),
            ],
          ),
        ),
      ),
    );
  }
}
