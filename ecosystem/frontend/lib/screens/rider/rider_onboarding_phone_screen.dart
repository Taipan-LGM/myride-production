import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/services/auth_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/mr_button.dart';
import 'package:my_ride/widgets/mr_input.dart';
import 'package:my_ride/widgets/mr_layout.dart';

class RiderOnboardingPhoneScreen extends StatefulWidget {
  const RiderOnboardingPhoneScreen({super.key});

  @override
  State<RiderOnboardingPhoneScreen> createState() => _RiderOnboardingPhoneScreenState();
}

class _RiderOnboardingPhoneScreenState extends State<RiderOnboardingPhoneScreen> {
  final _phoneController = TextEditingController(text: '+1 (555) 123-4567');
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _continue() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await AuthService.instance.sendOtp(_phoneController.text);
      if (mounted) context.go('/rider/onboarding/otp');
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(MrSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const MrBrandHeader(subtitle: 'Rider onboarding · Step 1/4'),
              const SizedBox(height: MrSpacing.lg),
              const Text('What\'s your number?', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
              const SizedBox(height: MrSpacing.sm),
              const Text('We\'ll send a verification code via SMS.', style: TextStyle(fontSize: 15, color: MrColors.textSecondary)),
              if (AppConfig.useMockAuth) ...[
                const SizedBox(height: MrSpacing.sm),
                const Text('Mock mode: any number → OTP 482901', style: TextStyle(fontSize: 12, color: MrColors.brandPrimary)),
              ],
              const SizedBox(height: MrSpacing.lg),
              MrInput(
                controller: _phoneController,
                hint: '(555) 000-0000',
                label: 'Mobile number',
                keyboardType: TextInputType.phone,
                errorText: _error,
              ),
              const SizedBox(height: MrSpacing.md),
              MrButton(label: 'Continue', fullWidth: true, loading: _loading, onPressed: _loading ? null : _continue),
              const Spacer(),
              const MrOnboardingProgress(step: 1, total: 4),
            ],
          ),
        ),
      ),
    );
  }
}
