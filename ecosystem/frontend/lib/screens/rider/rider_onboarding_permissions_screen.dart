import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/services/push_service.dart';
import 'package:my_ride/widgets/mr_button.dart';
import 'package:my_ride/widgets/mr_layout.dart';

class RiderOnboardingPermissionsScreen extends StatelessWidget {
  const RiderOnboardingPermissionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(MrSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Enable permissions', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
              const SizedBox(height: MrSpacing.sm),
              const Text('My Ride needs these to find rides near you.', style: TextStyle(fontSize: 15, color: MrColors.textSecondary)),
              const SizedBox(height: MrSpacing.lg),
              _PermissionTile(icon: Icons.location_on_outlined, title: 'Location', subtitle: 'Pickup, live tracking, ETA', required: true),
              const SizedBox(height: MrSpacing.md),
              _PermissionTile(icon: Icons.notifications_outlined, title: 'Notifications', subtitle: 'Driver assigned, trip updates', required: false),
              const SizedBox(height: MrSpacing.lg),
              MrButton(
                label: 'Allow & continue',
                fullWidth: true,
                onPressed: () async {
                  await PushService.instance.subscribeForFlavor();
                  if (context.mounted) context.go('/rider/onboarding/payment');
                },
              ),
              const SizedBox(height: MrSpacing.md),
              Center(child: TextButton(onPressed: () => context.go('/rider/onboarding/payment'), child: const Text('Skip for now'))),
              const Spacer(),
              const MrOnboardingProgress(step: 3, total: 4),
            ],
          ),
        ),
      ),
    );
  }
}

class _PermissionTile extends StatelessWidget {
  const _PermissionTile({required this.icon, required this.title, required this.subtitle, required this.required});

  final IconData icon;
  final String title;
  final String subtitle;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(MrSpacing.md),
      decoration: BoxDecoration(
        color: MrColors.surfaceCard,
        borderRadius: BorderRadius.circular(MrRadius.lg),
        border: Border.all(color: MrColors.borderDefault),
      ),
      child: Row(
        children: [
          CircleAvatar(backgroundColor: MrColors.brandPrimaryLight, child: Icon(icon, color: MrColors.brandPrimary)),
          const SizedBox(width: MrSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                Text(subtitle, style: const TextStyle(fontSize: 13, color: MrColors.textSecondary)),
                Text(required ? 'Required' : 'Recommended', style: TextStyle(fontSize: 12, color: required ? MrColors.success : MrColors.textSecondary, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          Switch(value: true, onChanged: (_) {}, activeThumbColor: MrColors.brandPrimary),
        ],
      ),
    );
  }
}
