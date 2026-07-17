import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/providers/socket_provider.dart';
import 'package:my_ride/services/api/auth_api.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';
import 'package:my_ride/widgets/common/mr_error_snackbar.dart';

/// Customer registration against legacy Node `POST /api/users/register`.
class RiderRegisterScreen extends ConsumerStatefulWidget {
  const RiderRegisterScreen({super.key});

  @override
  ConsumerState<RiderRegisterScreen> createState() => _RiderRegisterScreenState();
}

class _RiderRegisterScreenState extends ConsumerState<RiderRegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  bool _isLoading = false;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _register() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);
    try {
      final user = await AuthApi().register(
        name: _nameController.text.trim(),
        email: _emailController.text.trim(),
        password: _passwordController.text,
      );
      ref.read(authProvider.notifier).setUser(user);
      ref.read(socketConnectionProvider);
      if (mounted) context.go('/rider/home');
    } catch (e) {
      if (mounted) MrErrorSnackbar.showException(context, e);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MrColors.neutral100,
      appBar: AppBar(
        backgroundColor: MrColors.primary,
        foregroundColor: Colors.white,
        title: const Text('Create rider account'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.symmetric(horizontal: 24.w, vertical: 24.h),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
              const Center(child: MrLogo(variant: MrLogoVariant.wordmark, height: 96, maxWidth: 280)),
              SizedBox(height: 16.h),
              Text(
                  'Book rides in Nelson Mandela Bay',
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontSize: 22.sp,
                    fontWeight: FontWeight.w700,
                    color: MrColors.primary,
                  ),
                ),
                SizedBox(height: 8.h),
                Text(
                  'Create an account with email and password.',
                  style: TextStyle(fontSize: 14.sp, color: MrColors.neutral900.withValues(alpha: 0.6)),
                ),
                SizedBox(height: 32.h),
                TextFormField(
                  controller: _nameController,
                  textInputAction: TextInputAction.next,
                  decoration: _decoration('Full name', Icons.person_outline),
                  validator: (v) {
                    if (v == null || v.trim().length < 2) return 'Enter your name';
                    return null;
                  },
                ),
                SizedBox(height: 16.h),
                TextFormField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  decoration: _decoration('Email address', Icons.email_outlined),
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Enter your email';
                    if (!RegExp(r'^[\w.+-]+@([\w-]+\.)+[\w-]{2,}$').hasMatch(v)) {
                      return 'Enter a valid email';
                    }
                    return null;
                  },
                ),
                SizedBox(height: 16.h),
                TextFormField(
                  controller: _passwordController,
                  obscureText: _obscurePassword,
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _register(),
                  decoration: _decoration(
                    'Password',
                    Icons.lock_outline,
                    suffix: IconButton(
                      icon: Icon(
                        _obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                        color: MrColors.primary.withValues(alpha: 0.4),
                      ),
                      onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                    ),
                  ),
                  validator: (v) {
                    if (v == null || v.length < 8) return 'Password must be at least 8 characters';
                    return null;
                  },
                ),
                SizedBox(height: 28.h),
                SizedBox(
                  height: 48.h,
                  child: ElevatedButton(
                    onPressed: _isLoading ? null : _register,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: MrColors.secondary,
                      foregroundColor: MrColors.primary,
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
                    ),
                    child: _isLoading
                        ? SizedBox(
                            width: 24.w,
                            height: 24.w,
                            child: const CircularProgressIndicator(strokeWidth: 2.5),
                          )
                        : Text(
                            'Create account',
                            style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.w700),
                          ),
                  ),
                ),
                SizedBox(height: 16.h),
                TextButton(
                  onPressed: () => context.go('/rider/login'),
                  child: const Text('Already have an account? Sign in'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _decoration(String label, IconData prefix, {Widget? suffix}) {
    final border = OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: BorderSide.none);
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(prefix, color: MrColors.primary.withValues(alpha: 0.4)),
      suffixIcon: suffix,
      filled: true,
      fillColor: Colors.white,
      border: border,
      enabledBorder: border,
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12.r),
        borderSide: const BorderSide(color: MrColors.secondary, width: 2),
      ),
    );
  }
}
