import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_badge.dart';
import 'package:my_ride/widgets/mr_button.dart';

class RiderScheduledListScreen extends StatelessWidget {
  const RiderScheduledListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scheduled rides')),
      body: ListView(
        padding: const EdgeInsets.all(MrSpacing.md),
        children: [
          _ScheduledCard(
            when: 'Sat 12 Jul · 8:30 AM',
            route: '42 Market St → Airport T2',
            meta: 'Standard · Est. \$32',
            badge: const MrBadge(label: 'Confirmed', variant: MrBadgeVariant.warning),
          ),
          const SizedBox(height: MrSpacing.md),
          _ScheduledCard(
            when: 'Mon 14 Jul · 6:00 PM',
            route: 'Home → Central Station',
            meta: 'Comfort · Est. \$18',
            badge: const MrBadge(label: 'Driver assigned', variant: MrBadgeVariant.success),
          ),
          const SizedBox(height: MrSpacing.lg),
          MrButton(label: '+ Schedule new ride', variant: MrButtonVariant.secondary, fullWidth: true, onPressed: () => context.go('/rider/schedule')),
          const SizedBox(height: MrSpacing.md),
          MrButton(label: 'Wallet', fullWidth: true, onPressed: () => context.go('/rider/wallet')),
        ],
      ),
    );
  }
}

class _ScheduledCard extends StatelessWidget {
  const _ScheduledCard({required this.when, required this.route, required this.meta, required this.badge});

  final String when;
  final String route;
  final String meta;
  final MrBadge badge;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(MrSpacing.md),
      decoration: BoxDecoration(
        color: MrColors.surfaceCard,
        borderRadius: BorderRadius.circular(MrRadius.lg),
        border: Border.all(color: MrColors.borderDefault),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(when, style: const TextStyle(fontSize: 11, color: MrColors.brandPrimary, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          Text(route, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          Text(meta, style: const TextStyle(fontSize: 13, color: MrColors.textSecondary)),
          const SizedBox(height: 8),
          badge,
        ],
      ),
    );
  }
}
