import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/services/auth_service.dart';
import 'package:my_ride/services/push_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';
import 'package:my_ride/widgets/mr_layout.dart';

class RiderOnboardingOtpScreen extends StatefulWidget {
  const RiderOnboardingOtpScreen({super.key});

  @override
  State<RiderOnboardingOtpScreen> createState() => _RiderOnboardingOtpScreenState();
}

class _RiderOnboardingOtpScreenState extends State<RiderOnboardingOtpScreen> {
  final _codeController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await AuthService.instance.verifyOtp(_codeController.text.trim());
      if (mounted) context.go('/rider/onboarding/permissions');
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final phone = AuthService.instance.phoneNumber ?? '+1 (555) 123-4567';

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(MrSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              IconButton(onPressed: () => context.go('/rider/onboarding/phone'), icon: const Icon(Icons.arrow_back)),
              const Text('Enter verification code', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
              const SizedBox(height: MrSpacing.sm),
              Text('Sent to $phone', style: const TextStyle(fontSize: 15, color: MrColors.textSecondary)),
              if (AppConfig.useMockAuth)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text('Mock OTP: 482901', style: TextStyle(fontSize: 13, color: MrColors.brandPrimary, fontWeight: FontWeight.w600)),
                ),
              const SizedBox(height: MrSpacing.lg),
              TextField(
                controller: _codeController,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: InputDecoration(
                  hintText: '6-digit code',
                  errorText: _error,
                  counterText: '',
                ),
              ),
              const SizedBox(height: MrSpacing.md),
              MrButton(label: 'Verify', fullWidth: true, loading: _loading, onPressed: _loading ? null : _verify),
              const Spacer(),
              const MrOnboardingProgress(step: 2, total: 4),
            ],
          ),
        ),
      ),
    );
  }
}
