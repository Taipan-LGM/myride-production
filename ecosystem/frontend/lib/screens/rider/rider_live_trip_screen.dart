import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_badge.dart';
import 'package:my_ride/widgets/mr_card.dart';
import 'package:my_ride/widgets/mr_google_map.dart';
import 'package:my_ride/widgets/mr_layout.dart';

class RiderLiveTripScreen extends StatelessWidget {
  const RiderLiveTripScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          MrGoogleMap(expand: true, showUserMarker: true, showRoute: true),
          SafeArea(
            child: Center(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                decoration: BoxDecoration(color: MrColors.surfaceCard, borderRadius: BorderRadius.circular(22)),
                child: const Text('Arriving in 6 min', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: Container(
              padding: const EdgeInsets.all(MrSpacing.md),
              decoration: const BoxDecoration(
                color: MrColors.surfaceCard,
                borderRadius: BorderRadius.vertical(top: Radius.circular(MrRadius.xl)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const MrBadge(label: 'On trip', variant: MrBadgeVariant.success),
                  const SizedBox(height: MrSpacing.md),
                  MrCard(
                    child: Row(
                      children: [
                        const CircleAvatar(radius: 28, child: Icon(Icons.person)),
                        const SizedBox(width: MrSpacing.md),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('James O.', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                              Text('Toyota Camry · ABC-1234', style: TextStyle(fontSize: 12, color: MrColors.textSecondary)),
                            ],
                          ),
                        ),
                        IconButton(onPressed: () {}, icon: const Icon(Icons.phone, color: MrColors.brandPrimary)),
                        IconButton(onPressed: () {}, icon: const Icon(Icons.chat_bubble_outline, color: MrColors.brandPrimary)),
                      ],
                    ),
                  ),
                  const SizedBox(height: MrSpacing.sm),
                  const Text('Central Station, Platform 3', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  const Text('Est. fare: \$18.40 · Card ···4242', style: TextStyle(fontSize: 12, color: MrColors.textSecondary)),
                  const SizedBox(height: MrSpacing.md),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(onPressed: () => context.go('/rider/receipt'), child: const Text('Simulate arrival')),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
