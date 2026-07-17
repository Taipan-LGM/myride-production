import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/providers/socket_provider.dart';
import 'package:my_ride/services/api/auth_api.dart';
import 'package:my_ride/theme/brand_assets.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';
import 'package:my_ride/widgets/common/mr_error_snackbar.dart';

class RiderLoginScreen extends ConsumerStatefulWidget {
  const RiderLoginScreen({super.key});

  @override
  ConsumerState<RiderLoginScreen> createState() => _RiderLoginScreenState();
}

class _RiderLoginScreenState extends ConsumerState<RiderLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  bool _isLoading = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);
    try {
      final user = await AuthApi().login(
        email: _emailController.text.trim(),
        password: _passwordController.text,
        role: 'rider',
      );
      ref.read(authProvider.notifier).setUser(user);
      if (AppConfig.legacyBackend) {
        ref.read(socketConnectionProvider);
      }
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
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.symmetric(horizontal: 24.w),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(height: 40.h),
              const Center(child: MrLogo.auth(heroTag: 'logo')),
              SizedBox(height: 12.h),
              Center(
                child: Text(
                  BrandAssets.tagline,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: 'Inter',
                    fontSize: 14.sp,
                    fontStyle: FontStyle.italic,
                    color: MrColors.neutral900.withValues(alpha: 0.6),
                  ),
                ),
              ),
              SizedBox(height: 8.h),
              Text(
                'Sign in to book your next ride safely and quickly.',
                style: TextStyle(
                  fontFamily: 'Inter',
                  fontSize: 16.sp,
                  fontWeight: FontWeight.w400,
                  color: MrColors.neutral900.withValues(alpha: 0.6),
                  height: 1.5,
                ),
              ),
              SizedBox(height: 32.h),
              Form(
                key: _formKey,
                child: Column(
                  children: [
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      style: TextStyle(fontSize: 16.sp, color: MrColors.neutral900),
                      decoration: _fieldDecoration(label: 'Email Address', prefix: Icons.email_outlined),
                      validator: (value) {
                        if (value == null || value.isEmpty) return 'Please enter your email';
                        if (!RegExp(r'^[\w.+-]+@([\w-]+\.)+[\w-]{2,}$').hasMatch(value)) {
                          return 'Please enter a valid email';
                        }
                        return null;
                      },
                    ),
                    SizedBox(height: 16.h),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: _obscurePassword,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _login(),
                      style: TextStyle(fontSize: 16.sp, color: MrColors.neutral900),
                      decoration: _fieldDecoration(
                        label: 'Password',
                        prefix: Icons.lock_outline,
                        suffix: IconButton(
                          icon: Icon(_obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined, color: MrColors.primary.withValues(alpha: 0.4), size: 20.sp),
                          onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                          splashRadius: 20.r,
                        ),
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) return 'Please enter your password';
                        if (value.length < 8) return 'Password must be at least 8 characters';
                        return null;
                      },
                    ),
                    SizedBox(height: 12.h),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: () => context.push('/rider/forgot-password'),
                        style: TextButton.styleFrom(minimumSize: Size(0, 44.h), padding: EdgeInsets.symmetric(horizontal: 8.w)),
                        child: Text('Forgot Password?', style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w600, color: MrColors.primary)),
                      ),
                    ),
                    SizedBox(height: 24.h),
                    SizedBox(
                      width: double.infinity,
                      height: 48.h,
                      child: ElevatedButton(
                        onPressed: _isLoading ? null : _login,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: MrColors.secondary,
                          foregroundColor: MrColors.primary,
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
                        ),
                        child: _isLoading
                            ? SizedBox(width: 24.w, height: 24.w, child: const CircularProgressIndicator(strokeWidth: 2.5, valueColor: AlwaysStoppedAnimation<Color>(MrColors.primary)))
                            : Text('Sign In to My Ride', style: TextStyle(fontFamily: 'Inter', fontSize: 16.sp, fontWeight: FontWeight.w700, color: MrColors.primary)),
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(height: 32.h),
              Row(
                children: [
                  Expanded(child: Divider(color: MrColors.primary.withValues(alpha: 0.1))),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16.w),
                    child: Text('or continue with', style: TextStyle(fontSize: 13.sp, color: MrColors.neutral900.withValues(alpha: 0.4))),
                  ),
                  Expanded(child: Divider(color: MrColors.primary.withValues(alpha: 0.1))),
                ],
              ),
              SizedBox(height: 24.h),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _socialButton(icon: Icons.g_mobiledata_rounded, label: 'Google', onTap: () {}),
                  SizedBox(width: 16.w),
                  _socialButton(icon: Icons.apple, label: 'Apple', onTap: () {}),
                ],
              ),
              SizedBox(height: 40.h),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('New to My Ride? ', style: TextStyle(fontSize: 14.sp, color: MrColors.neutral900.withValues(alpha: 0.6))),
                  TextButton(
                    onPressed: () => context.push('/rider/register'),
                    style: TextButton.styleFrom(minimumSize: Size(0, 44.h), padding: EdgeInsets.symmetric(horizontal: 4.w)),
                    child: Text('Create Account', style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w700, color: MrColors.secondary)),
                  ),
                ],
              ),
              SizedBox(height: 24.h),
            ],
          ),
        ),
      ),
    );
  }

  InputDecoration _fieldDecoration({required String label, required IconData prefix, Widget? suffix}) {
    final border = OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: BorderSide.none);
    return InputDecoration(
      labelText: label,
      labelStyle: TextStyle(fontSize: 14.sp, color: MrColors.neutral900.withValues(alpha: 0.5)),
      prefixIcon: Icon(prefix, color: MrColors.primary.withValues(alpha: 0.4), size: 20.sp),
      suffixIcon: suffix,
      filled: true,
      fillColor: Colors.white,
      border: border,
      enabledBorder: border,
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: const BorderSide(color: MrColors.secondary, width: 2)),
      errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: const BorderSide(color: MrColors.accent, width: 2)),
      contentPadding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 16.h),
    );
  }

  Widget _socialButton({required IconData icon, required String label, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12.r),
      child: Container(
        width: 140.w,
        height: 52.h,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12.r),
          border: Border.all(color: MrColors.primary.withValues(alpha: 0.08)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 24.sp, color: MrColors.primary),
            SizedBox(width: 8.w),
            Text(label, style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w600, color: MrColors.primary)),
          ],
        ),
      ),
    );
  }
}
