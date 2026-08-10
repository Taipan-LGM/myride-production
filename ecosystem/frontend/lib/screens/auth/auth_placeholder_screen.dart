import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/theme/brand_assets.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';

class AuthPlaceholderScreen extends StatelessWidget {
  const AuthPlaceholderScreen({super.key, required this.title, this.backRoute});

  final String title;
  final String? backRoute;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MrColors.neutral100,
      appBar: AppBar(
        backgroundColor: MrColors.primary,
        foregroundColor: Colors.white,
        title: Text(title, style: MrText.sans(color: Colors.white, weight: FontWeight.w600)),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: MrText.h1()),
            const SizedBox(height: 12),
            Text('This flow will connect to Firebase Auth in production.', style: MrText.body(color: MrColors.textSecondary)),
            const Spacer(),
            if (backRoute != null)
              OutlinedButton(onPressed: () => context.go(backRoute!), child: const Text('Back to sign in')),
          ],
        ),
      ),
    );
  }
}

class AuthLandingScreen extends StatelessWidget {
  const AuthLandingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MrColors.neutral100,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Spacer(),
              const Center(child: MrLogo.auth()),
              const SizedBox(height: 12),
              Text(
                BrandAssets.tagline,
                textAlign: TextAlign.center,
                style: MrText.body(color: MrColors.textSecondary),
              ),
              const SizedBox(height: 8),
              Text(
                BrandAssets.heritage,
                textAlign: TextAlign.center,
                style: MrText.sans(size: 12, color: MrColors.textSecondary),
              ),
              const SizedBox(height: 32),
              Text('Choose how you want to continue', style: MrText.body(color: MrColors.textSecondary)),
              const SizedBox(height: 24),
              ElevatedButton(onPressed: () => context.go('/rider/login'), child: const Text('Rider Sign In')),
              const SizedBox(height: 12),
              ElevatedButton(onPressed: () => context.go('/driver/login'), child: const Text('Driver Sign In')),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: () => context.go('/admin/login'), child: const Text('Admin Sign In')),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: () => context.go('/demo'), child: const Text('Open Demo Ecosystem')),
              const Spacer(),
            ],
          ),
        ),
      ),
    );
  }
}
