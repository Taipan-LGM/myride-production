import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/services/admin_otp_service.dart';
import 'package:my_ride/services/api/auth_api.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';

class AdminLoginScreen extends StatefulWidget {
  const AdminLoginScreen({super.key});

  @override
  State<AdminLoginScreen> createState() => _AdminLoginScreenState();
}

class _AdminLoginScreenState extends State<AdminLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _otpController = TextEditingController();
  bool _obscurePassword = true;
  bool _isLoading = false;
  bool _showOtpField = false;
  String? _statusMessage;
  String? _devOtpCode;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _otpController.dispose();
    super.dispose();
  }

  void _showSnack(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message, style: const TextStyle(fontFamily: 'Inter')), backgroundColor: error ? MrColors.accent : MrColors.primary),
    );
  }

  Future<void> _loginEcosystem() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _isLoading = true;
      _statusMessage = null;
    });
    try {
      await AuthApi().login(
        email: _emailController.text.trim(),
        password: _passwordController.text,
        role: 'admin',
      );
      if (mounted) {
        _showSnack('Admin signed in');
        context.go('/admin/dashboard');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _statusMessage = e.toString());
        _showSnack(e.toString(), error: true);
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _sendOtp() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _statusMessage = null;
    });

    try {
      final email = _emailController.text.trim();
      final result = await AdminOtpService.instance.sendOtp(email);
      if (!mounted) return;
      setState(() {
        _showOtpField = true;
        _devOtpCode = result.devCode;
        _statusMessage = result.consoleDev
            ? 'Dev mode — add SMTP_PASSWORD to backend/.env for real email'
            : 'Check your inbox at $email for the 6-digit code.';
      });
      _showSnack(result.consoleDev ? 'OTP generated (dev mode)' : result.message);
    } on AdminOtpException catch (e) {
      if (mounted) {
        setState(() => _statusMessage = e.message);
        _showSnack(e.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _verifyAndEnter() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
      _statusMessage = null;
    });

    try {
      await AdminOtpService.instance.verifyOtp(_emailController.text.trim(), _otpController.text.trim());
      if (mounted) context.go('/admin/dashboard');
    } on AdminOtpException catch (e) {
      if (mounted) {
        setState(() => _statusMessage = e.message);
        _showSnack(e.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _onPrimaryPressed() async {
    if (!AppConfig.legacyBackend) {
      await _loginEcosystem();
      return;
    }
    if (_showOtpField) {
      await _verifyAndEnter();
    } else {
      await _sendOtp();
    }
  }

  void _resetOtpStep() {
    setState(() {
      _showOtpField = false;
      _otpController.clear();
      _statusMessage = null;
      _devOtpCode = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MrColors.neutral100,
      body: Center(
        child: Container(
          constraints: BoxConstraints(maxWidth: 420.w),
          padding: EdgeInsets.symmetric(horizontal: 40.w, vertical: 48.h),
          child: SingleChildScrollView(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const MrLogo.appBar(heroTag: 'logo'),
                SizedBox(height: 8.h),
                Text('Admin Console', style: TextStyle(fontFamily: 'Inter', fontSize: 13.sp, fontWeight: FontWeight.w500, color: MrColors.secondary)),
                SizedBox(height: 48.h),
                Text('Secure Admin Access', style: TextStyle(fontFamily: 'Inter', fontSize: 28.sp, fontWeight: FontWeight.w700, color: MrColors.primary, letterSpacing: -0.5)),
                SizedBox(height: 12.h),
                Text(
                  'Enter your email manually. A real 6-digit code will be sent to your inbox.',
                  style: TextStyle(fontFamily: 'Inter', fontSize: 14.sp, color: MrColors.neutral900.withValues(alpha: 0.6), height: 1.6),
                ),
                if (_devOtpCode != null) ...[
                  SizedBox(height: 16.h),
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.all(16.w),
                    decoration: BoxDecoration(
                      color: MrColors.secondary.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12.r),
                      border: Border.all(color: MrColors.secondary, width: 2),
                    ),
                    child: Column(
                      children: [
                        Text('Your verification code', style: TextStyle(fontSize: 13.sp, color: MrColors.primary, fontWeight: FontWeight.w600)),
                        SizedBox(height: 8.h),
                        Text(_devOtpCode!, style: TextStyle(fontSize: 32.sp, fontWeight: FontWeight.w800, color: MrColors.primary, letterSpacing: 8, fontFamily: 'Roboto Mono')),
                      ],
                    ),
                  ),
                ],
                if (_statusMessage != null) ...[
                  SizedBox(height: 16.h),
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.all(12.w),
                    decoration: BoxDecoration(
                      color: MrColors.secondary.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12.r),
                      border: Border.all(color: MrColors.secondary.withValues(alpha: 0.3)),
                    ),
                    child: Text(_statusMessage!, style: TextStyle(fontSize: 13.sp, color: MrColors.primary)),
                  ),
                ],
                SizedBox(height: 40.h),
                Container(
                  width: double.infinity,
                  padding: EdgeInsets.all(16.w),
                  decoration: BoxDecoration(
                    color: MrColors.accent.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(12.r),
                    border: Border.all(color: MrColors.accent.withValues(alpha: 0.2)),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.security_rounded, color: MrColors.accent, size: 24.sp),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: Text('All access attempts are logged and monitored.', style: TextStyle(fontSize: 12.sp, color: MrColors.accent.withValues(alpha: 0.8))),
                      ),
                    ],
                  ),
                ),
                SizedBox(height: 32.h),
                Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextFormField(
                        controller: _emailController,
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.email],
                        enabled: !_showOtpField && !_isLoading,
                        style: TextStyle(fontSize: 15.sp, color: MrColors.neutral900),
                        decoration: _fieldDecoration(label: 'Admin Email', hint: 'you@example.com', prefix: Icons.admin_panel_settings_outlined, disabled: _showOtpField),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) return 'Admin email is required';
                          if (!RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,}$').hasMatch(value.trim())) {
                            return 'Enter a valid email address';
                          }
                          return null;
                        },
                      ),
                      SizedBox(height: 16.h),
                      TextFormField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        textInputAction: TextInputAction.done,
                        enabled: !_showOtpField && !_isLoading,
                        style: TextStyle(fontSize: 15.sp, color: MrColors.neutral900),
                        decoration: _fieldDecoration(
                          label: 'Password',
                          prefix: Icons.lock_outline,
                          disabled: _showOtpField,
                          suffix: IconButton(
                            icon: Icon(_obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined, color: MrColors.primary.withValues(alpha: 0.4), size: 20.sp),
                            onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                            splashRadius: 20.r,
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.isEmpty) return 'Password is required';
                          if (value.length < 10) return 'Admin password must be at least 10 characters';
                          return null;
                        },
                      ),
                      if (_showOtpField) ...[
                        SizedBox(height: 16.h),
                        TextFormField(
                          controller: _otpController,
                          keyboardType: TextInputType.number,
                          maxLength: 6,
                          textInputAction: TextInputAction.done,
                          enabled: !_isLoading,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                          style: TextStyle(fontSize: 20.sp, fontWeight: FontWeight.w700, color: MrColors.primary, letterSpacing: 8),
                          textAlign: TextAlign.center,
                          decoration: _fieldDecoration(label: '6-Digit OTP', prefix: Icons.pin_outlined, counterText: ''),
                          validator: (value) {
                            if (value == null || value.isEmpty) return 'Enter the OTP code';
                            if (value.length != 6) return 'OTP must be 6 digits';
                            return null;
                          },
                        ),
                        SizedBox(height: 8.h),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            TextButton(
                              onPressed: _isLoading ? null : _resetOtpStep,
                              child: Text('Edit credentials', style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w600, color: MrColors.primary)),
                            ),
                            TextButton(
                              onPressed: _isLoading ? null : _sendOtp,
                              child: Text('Resend OTP', style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w600, color: MrColors.secondary)),
                            ),
                          ],
                        ),
                      ],
                      SizedBox(height: 24.h),
                      SizedBox(
                        height: 48.h,
                        child: ElevatedButton(
                          onPressed: _isLoading ? null : _onPrimaryPressed,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: MrColors.secondary,
                            foregroundColor: MrColors.primary,
                            elevation: 0,
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
                          ),
                          child: _isLoading
                              ? SizedBox(width: 24.w, height: 24.w, child: const CircularProgressIndicator(strokeWidth: 2.5, valueColor: AlwaysStoppedAnimation<Color>(MrColors.primary)))
                              : Text(
                                  _showOtpField ? 'Verify & Enter Console' : 'Send OTP & Continue',
                                  style: TextStyle(fontFamily: 'Inter', fontSize: 16.sp, fontWeight: FontWeight.w700, color: MrColors.primary),
                                ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration({
    required String label,
    required IconData prefix,
    String? hint,
    bool disabled = false,
    Widget? suffix,
    String? counterText,
  }) {
    final border = OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: BorderSide.none);
    return InputDecoration(
      labelText: label,
      hintText: hint,
      counterText: counterText,
      labelStyle: TextStyle(fontSize: 14.sp, color: MrColors.neutral900.withValues(alpha: 0.5)),
      prefixIcon: Icon(prefix, color: MrColors.primary.withValues(alpha: 0.4), size: 20.sp),
      suffixIcon: suffix,
      filled: true,
      fillColor: Colors.white,
      border: border,
      enabledBorder: border,
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: const BorderSide(color: MrColors.secondary, width: 2)),
      disabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: BorderSide(color: MrColors.primary.withValues(alpha: 0.1))),
      errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: const BorderSide(color: MrColors.accent, width: 2)),
      contentPadding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 16.h),
    );
  }
}
