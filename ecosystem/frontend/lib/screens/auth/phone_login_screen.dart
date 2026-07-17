import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/services/auth_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';

class PhoneLoginScreen extends ConsumerStatefulWidget {
  const PhoneLoginScreen({super.key});

  @override
  ConsumerState<PhoneLoginScreen> createState() => _PhoneLoginScreenState();
}

class _PhoneLoginScreenState extends ConsumerState<PhoneLoginScreen> {
  final _phone = TextEditingController(text: '+27 82 123 4567');
  String _countryCode = '+27';
  bool _loading = false;
  String? _error;

  static const _codes = ['+27', '+1', '+44', '+234', '+254'];

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _sendOtp() async {
    setState(() { _loading = true; _error = null; });
    ref.read(authProvider.notifier).setLoading(true);
    try {
      final full = '$_countryCode${_phone.text.replaceAll(RegExp(r'\D'), '').replaceFirst(RegExp(r'^0'), '')}';
      await AuthService.instance.sendOtp(full);
      if (mounted) context.push('/auth/otp');
    } catch (e) {
      setState(() => _error = e.toString());
      ref.read(authProvider.notifier).setError(e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = ref.watch(authProvider).pendingRole;
    return Scaffold(
      appBar: AppBar(title: Text('${role?.name ?? 'User'} login', style: MrText.sans(weight: FontWeight.w600))),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Enter your phone', style: MrText.sans(size: 28, weight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text('We\'ll send a 6-digit OTP via Firebase Auth.', style: MrText.sans(color: MrColors.textSecondary)),
            if (AppConfig.useMockAuth)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Mock OTP: 482901', style: MrText.sans(size: 12, color: MrColors.secondary)),
              ),
            const SizedBox(height: 24),
            Row(
              children: [
                DropdownButton<String>(
                  value: _countryCode,
                  items: _codes.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                  onChanged: (v) => setState(() => _countryCode = v!),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    decoration: InputDecoration(
                      hintText: 'Phone number',
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ),
              ],
            ),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: Colors.red))),
            const Spacer(),
            MrGlowButton(label: _loading ? 'Sending…' : 'Send OTP', fullWidth: true, onPressed: _loading ? null : _sendOtp),
          ],
        ),
      ),
    );
  }
}
