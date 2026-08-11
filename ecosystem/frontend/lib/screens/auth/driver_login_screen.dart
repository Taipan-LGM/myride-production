import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/services/api/auth_api.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';
import 'package:my_ride/widgets/common/mr_error_snackbar.dart';
import 'package:my_ride/widgets/mr_badge.dart';

class DriverLoginScreen extends StatefulWidget {
  const DriverLoginScreen({super.key});

  @override
  State<DriverLoginScreen> createState() => _DriverLoginScreenState();
}

class _DriverLoginScreenState extends State<DriverLoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _phoneController = TextEditingController(text: 'driver@myride.co.za');
  final _passwordController = TextEditingController(text: 'drive123');
  bool _obscurePassword = true;
  bool _isLoading = false;
  bool _rememberMe = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);
    try {
      await AuthApi().login(
        email: _phoneController.text.trim(),
        password: _passwordController.text,
        role: 'driver',
      );
      if (mounted) context.go('/driver/home');
    } catch (e) {
      if (mounted) MrErrorSnackbar.showException(context, e);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: MrColors.primary,
      body: SafeArea(
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: EdgeInsets.symmetric(horizontal: 24.w, vertical: 40.h),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: EdgeInsets.all(12.w),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16.r),
                    ),
                    child: MrLogo(variant: MrLogoVariant.wordmark, height: 72.h, maxWidth: 240.w, heroTag: 'logo'),
                  ),
                  SizedBox(height: 24.h),
                  Text(
                    'Driver Portal',
                    style: TextStyle(fontFamily: 'Inter', fontSize: 28.sp, fontWeight: FontWeight.w700, color: Colors.white, letterSpacing: -0.5),
                  ),
                  SizedBox(height: 8.h),
                  Text('My Ride Partner', style: TextStyle(fontFamily: 'Inter', fontSize: 16.sp, fontWeight: FontWeight.w500, color: MrColors.secondary)),
                  SizedBox(height: 8.h),
                  // Version badge
                  Center(
                    child: VersionBadge(
                      version: '0.3.1',
                      padding: EdgeInsets.zero,
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    'Sign in to start earning and manage your trips.',
                    style: TextStyle(fontFamily: 'Inter', fontSize: 14.sp, color: Colors.white.withValues(alpha: 0.6), height: 1.5),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Container(
                width: double.infinity,
                decoration: BoxDecoration(
                  color: MrColors.neutral100,
                  borderRadius: BorderRadius.only(topLeft: Radius.circular(32.r), topRight: Radius.circular(32.r)),
                ),
                child: SingleChildScrollView(
                  padding: EdgeInsets.symmetric(horizontal: 24.w, vertical: 32.h),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        TextFormField(
                          controller: _phoneController,
                          keyboardType: TextInputType.phone,
                          textInputAction: TextInputAction.next,
                          style: TextStyle(fontSize: 16.sp, color: MrColors.neutral900),
                          decoration: InputDecoration(
                            labelText: 'Phone Number',
                            labelStyle: TextStyle(fontSize: 14.sp, color: MrColors.neutral900.withValues(alpha: 0.5)),
                            prefixIcon: Container(
                              margin: EdgeInsets.only(left: 16.w, right: 8.w),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text('+1', style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.w600, color: MrColors.primary)),
                                  SizedBox(width: 4.w),
                                  Icon(Icons.arrow_drop_down, color: MrColors.primary.withValues(alpha: 0.4), size: 20.sp),
                                ],
                              ),
                            ),
                            prefixIconConstraints: BoxConstraints(minWidth: 80.w, minHeight: 48.h),
                            filled: true,
                            fillColor: Colors.white,
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: BorderSide.none),
                            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: BorderSide.none),
                            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: const BorderSide(color: MrColors.secondary, width: 2)),
                            contentPadding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 16.h),
                          ),
                          validator: (value) {
                            if (value == null || value.isEmpty) return 'Please enter your phone number';
                            if (value.length < 10) return 'Please enter a valid phone number';
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
                          decoration: InputDecoration(
                            labelText: 'Password',
                            labelStyle: TextStyle(fontSize: 14.sp, color: MrColors.neutral900.withValues(alpha: 0.5)),
                            prefixIcon: Icon(Icons.lock_outline, color: MrColors.primary.withValues(alpha: 0.4), size: 20.sp),
                            suffixIcon: IconButton(
                              icon: Icon(_obscurePassword ? Icons.visibility_off_outlined : Icons.visibility_outlined, color: MrColors.primary.withValues(alpha: 0.4), size: 20.sp),
                              onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                              splashRadius: 20.r,
                            ),
                            filled: true,
                            fillColor: Colors.white,
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: BorderSide.none),
                            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: BorderSide.none),
                            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12.r), borderSide: const BorderSide(color: MrColors.secondary, width: 2)),
                            contentPadding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 16.h),
                          ),
                          validator: (value) {
                            if (value == null || value.isEmpty) return 'Please enter your password';
                            if (value.length < 8) return 'Password must be at least 8 characters';
                            return null;
                          },
                        ),
                        SizedBox(height: 16.h),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                SizedBox(
                                  width: 24.w,
                                  height: 24.w,
                                  child: Checkbox(
                                    value: _rememberMe,
                                    onChanged: (value) => setState(() => _rememberMe = value ?? false),
                                    activeColor: MrColors.secondary,
                                    checkColor: MrColors.primary,
                                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6.r)),
                                    side: BorderSide(color: MrColors.primary.withValues(alpha: 0.2), width: 1.5),
                                  ),
                                ),
                                SizedBox(width: 8.w),
                                Text('Remember me', style: TextStyle(fontSize: 14.sp, color: MrColors.neutral900.withValues(alpha: 0.6))),
                              ],
                            ),
                            TextButton(
                              onPressed: () => context.push('/driver/forgot-password'),
                              style: TextButton.styleFrom(minimumSize: Size(0, 44.h), padding: EdgeInsets.symmetric(horizontal: 8.w)),
                              child: Text('Forgot?', style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w600, color: MrColors.primary)),
                            ),
                          ],
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
                                : Text('Sign In as Driver', style: TextStyle(fontFamily: 'Inter', fontSize: 16.sp, fontWeight: FontWeight.w700, color: MrColors.primary)),
                          ),
                        ),
                        SizedBox(height: 24.h),
                        Center(
                          child: TextButton(
                            onPressed: () => context.push('/driver/register'),
                            style: TextButton.styleFrom(minimumSize: Size(0, 44.h)),
                            child: RichText(
                              text: TextSpan(
                                text: 'Not a partner yet? ',
                                style: TextStyle(fontSize: 14.sp, color: MrColors.neutral900.withValues(alpha: 0.6)),
                                children: [
                                  TextSpan(text: 'Join My Ride', style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w700, color: MrColors.secondary)),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}