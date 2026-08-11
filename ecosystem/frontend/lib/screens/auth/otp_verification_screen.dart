import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/models/app_user.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/services/api/ecosystem_auth_api.dart';
import 'package:my_ride/services/auth_service.dart';
import 'package:my_ride/services/secure_storage_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';

class OtpVerificationScreen extends ConsumerStatefulWidget {
  const OtpVerificationScreen({super.key});

  @override
  ConsumerState<OtpVerificationScreen> createState() => _OtpVerificationScreenState();
}

class _OtpVerificationScreenState extends ConsumerState<OtpVerificationScreen> {
  final _controllers = List.generate(6, (_) => TextEditingController());
  final _focusNodes = List.generate(6, (_) => FocusNode());
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    for (final c in _controllers) { c.dispose(); }
    for (final f in _focusNodes) { f.dispose(); }
    super.dispose();
  }

  String get _code => _controllers.map((c) => c.text).join();

  Future<void> _verify() async {
    if (_code.length < 6) return;
    setState(() { _loading = true; _error = null; });
    try {
      await AuthService.instance.verifyOtp(_code);
      if (AppConfig.useMockAuth) {
        await SecureStorageService.instance.saveRefreshToken('mock-refresh-${DateTime.now().millisecondsSinceEpoch}');
      } else {
        final role = ref.read(authProvider).pendingRole ?? UserRole.rider;
        final idToken = await AuthService.instance.firebaseIdToken();
        final user = await EcosystemAuthApi().loginWithFirebase(
          idToken: idToken,
          role: role.name,
        );
        ref.read(authProvider.notifier).setUser(user);
      }
      if (mounted) context.go('/auth/profile');
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onChanged(int index, String value) {
    if (value.length == 1 && index < 5) {
      _focusNodes[index + 1].requestFocus();
    }
    if (_code.length == 6) _verify();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Verify OTP')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Enter 6-digit code', style: MrText.sans(size: 28, weight: FontWeight.w700)),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: List.generate(6, (i) => SizedBox(
                width: 44,
                child: TextField(
                  controller: _controllers[i],
                  focusNode: _focusNodes[i],
                  textAlign: TextAlign.center,
                  keyboardType: TextInputType.number,
                  maxLength: 1,
                  decoration: InputDecoration(counterText: '', border: OutlineInputBorder(borderRadius: BorderRadius.circular(8))),
                  onChanged: (v) => _onChanged(i, v),
                ),
              )),
            ),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: Colors.red))),
            const Spacer(),
            if (_loading) const Center(child: CircularProgressIndicator(color: MrColors.secondary)),
          ],
        ),
      ),
    );
  }
}
