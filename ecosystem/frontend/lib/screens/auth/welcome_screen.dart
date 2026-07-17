import 'package:animations/animations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/models/app_user.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/theme/brand_assets.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';

/// Welcome — Rider or Driver selection with hero transitions.
class WelcomeScreen extends ConsumerWidget {
  const WelcomeScreen({super.key});

  void _continueAsRider(BuildContext context, WidgetRef ref) {
    ref.read(authProvider.notifier).setPendingRole(UserRole.rider);
    if (AppConfig.legacyBackend) {
      context.go('/rider/login');
      return;
    }
    context.push('/auth/phone');
  }

  void _continueAsDriver(BuildContext context, WidgetRef ref) {
    ref.read(authProvider.notifier).setPendingRole(UserRole.driver);
    if (AppConfig.legacyBackend) {
      context.go('/driver/login');
      return;
    }
    context.push('/auth/phone');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [MrColors.primary, Color(0xFF0A2540)],
          ),
        ),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Spacer(),
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 24, offset: const Offset(0, 8)),
                    ],
                  ),
                  child: const Column(
                    children: [
                      MrLogo(variant: MrLogoVariant.hero, height: 220, maxWidth: 320, heroTag: 'logo'),
                      SizedBox(height: 8),
                      Text(
                        BrandAssets.tagline,
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 13, fontStyle: FontStyle.italic, color: Color(0xFF4A4A4A)),
                      ),
                    ],
                  ),
                ),
                const Spacer(),
                OpenContainer(
                  closedElevation: 0,
                  openElevation: 0,
                  closedColor: Colors.transparent,
                  openColor: MrColors.primary,
                  transitionDuration: const Duration(milliseconds: 500),
                  closedBuilder: (_, open) => MrGlowButton(
                    label: AppConfig.legacyBackend ? 'Rider sign in' : 'Continue as Rider',
                    fullWidth: true,
                    onPressed: () => _continueAsRider(context, ref),
                  ),
                  openBuilder: (_, __) => const SizedBox(),
                ),
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () => _continueAsDriver(context, ref),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: MrColors.secondary),
                    minimumSize: const Size.fromHeight(48),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text(
                    AppConfig.legacyBackend ? 'Driver sign in' : 'Continue as Driver',
                    style: MrText.sans(weight: FontWeight.w600),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
