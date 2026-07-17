import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_flavor.dart';
import 'package:my_ride/ecosystem/ecosystem_shell.dart';
import 'package:my_ride/models/app_user.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/screens/auth/admin_login_screen.dart';
import 'package:my_ride/screens/auth/auth_placeholder_screen.dart';
import 'package:my_ride/screens/auth/driver_login_screen.dart';
import 'package:my_ride/screens/auth/otp_verification_screen.dart';
import 'package:my_ride/screens/auth/phone_login_screen.dart';
import 'package:my_ride/screens/auth/profile_setup_screen.dart';
import 'package:my_ride/screens/auth/rider_login_screen.dart';
import 'package:my_ride/screens/auth/rider_register_screen.dart';
import 'package:my_ride/screens/auth/welcome_screen.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/services/legacy/legacy_auth_service.dart';
import 'package:my_ride/screens/call/call_screen.dart';
import 'package:my_ride/screens/chat/chat_screen.dart';
import 'package:my_ride/screens/chat/whatsapp_chat_screen.dart';
import 'package:my_ride/screens/driver/active_ride_screen.dart';
import 'package:my_ride/screens/driver/driver_home_screen.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/screens/driver/driver_earnings_screen.dart';
import 'package:my_ride/screens/rider/payment_screen.dart';
import 'package:my_ride/screens/rider/ride_history_screen.dart';
import 'package:my_ride/screens/rider/rider_shell_screen.dart';
import 'package:my_ride/screens/rider/rider_wallet_screen.dart';
import 'package:my_ride/screens/rider/ride_request_screen.dart';
import 'package:my_ride/screens/rider/ride_tracking_screen.dart';
import 'package:my_ride/screens/settings/app_settings_screen.dart';
import 'package:my_ride/screens/showcase/admin_live_screen.dart';
import 'package:my_ride/screens/showcase/driver_live_screen.dart';
import 'package:my_ride/screens/showcase/hub_showcase_screen.dart';
import 'package:my_ride/screens/showcase/rider_live_screen.dart';
import 'package:my_ride/screens/voice/voice_booking_screen.dart';

GoRouter createAppRouter(AppFlavor flavor, Ref ref) {
  return GoRouter(
    initialLocation: _initialRoute(flavor),
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final path = state.matchedLocation;
      final isAuthFlow = path.startsWith('/welcome') || path.startsWith('/auth');
      final isCallOrChat = path.startsWith('/call') || path.startsWith('/chat');
      final isLoginOrRegister = path.contains('/login') || path.contains('/register') || path.contains('/forgot-password');
      final isPublic = path == '/' ||
          path.startsWith('/showcase') ||
          path == '/demo' ||
          path.startsWith('/admin/login') ||
          isCallOrChat ||
          isLoginOrRegister;
      // Legacy JWT is source of truth — mock phone OTP can leave isAuthenticated true without a token.
      final sessionOk = AppConfig.legacyBackend
          ? (auth.isAuthenticated && LegacyAuthService.instance.isAuthenticated)
          : auth.isAuthenticated;

      if (sessionOk && auth.user?.profileComplete == true) {
        if (isAuthFlow || path == '/welcome' || isLoginOrRegister) {
          return switch (auth.user!.role) {
            UserRole.driver => '/driver/home',
            UserRole.admin => '/admin/dashboard',
            UserRole.rider => '/rider/home',
          };
        }
      } else if (!isAuthFlow && !isPublic && (path.startsWith('/rider/') || path.startsWith('/driver/'))) {
        return AppConfig.legacyBackend
            ? (path.startsWith('/driver/') ? '/driver/login' : '/rider/login')
            : '/welcome';
      }
      return null;
    },
    routes: [
      GoRoute(path: '/', builder: (_, __) => const AuthLandingScreen()),
      GoRoute(path: '/welcome', builder: (_, __) => const WelcomeScreen()),
      GoRoute(path: '/auth/phone', builder: (_, __) => const PhoneLoginScreen()),
      GoRoute(path: '/auth/otp', builder: (_, __) => const OtpVerificationScreen()),
      GoRoute(path: '/auth/profile', builder: (_, __) => const ProfileSetupScreen()),
      GoRoute(path: '/demo', builder: (_, __) => const EcosystemShell()),
      GoRoute(path: '/rider/login', builder: (_, __) => const RiderLoginScreen()),
      GoRoute(
        path: '/rider/home',
        pageBuilder: (_, state) => _fadePage(state, const RiderShellScreen()),
      ),
      GoRoute(
        path: '/rider/request',
        pageBuilder: (_, state) => _fadePage(state, RideRequestScreen(suggestion: state.extra as String?)),
      ),
      GoRoute(
        path: '/rider/tracking/:tripId',
        builder: (_, state) => RideTrackingScreen(tripId: state.pathParameters['tripId']!),
      ),
      GoRoute(path: '/rider/history', builder: (_, __) => const RideHistoryScreen()),
      GoRoute(path: '/rider/wallet', builder: (_, __) => const RiderWalletScreen()),
      GoRoute(
        path: '/rider/payment',
        builder: (_, state) => PaymentScreen(trip: state.extra as Trip?),
      ),
      GoRoute(path: '/rider/forgot-password', builder: (_, __) => const AuthPlaceholderScreen(title: 'Forgot Password', backRoute: '/rider/login')),
      GoRoute(path: '/rider/register', builder: (_, __) => const RiderRegisterScreen()),
      GoRoute(path: '/driver/login', builder: (_, __) => const DriverLoginScreen()),
      GoRoute(path: '/driver/home', builder: (_, __) => const DriverHomeScreen()),
      GoRoute(path: '/driver/earnings', builder: (_, __) => const DriverEarningsScreen()),
      GoRoute(
        path: '/driver/active/:tripId',
        builder: (_, state) => ActiveRideScreen(tripId: state.pathParameters['tripId']!),
      ),
      GoRoute(path: '/driver/forgot-password', builder: (_, __) => const AuthPlaceholderScreen(title: 'Driver Password Reset', backRoute: '/driver/login')),
      GoRoute(path: '/driver/register', builder: (_, __) => const AuthPlaceholderScreen(title: 'Join My Ride', backRoute: '/driver/login')),
      GoRoute(path: '/admin/login', builder: (_, __) => const AdminLoginScreen()),
      GoRoute(path: '/admin/dashboard', builder: (_, __) => const EcosystemShell(initialTab: 2)),
      GoRoute(path: '/settings', builder: (_, __) => const AppSettingsScreen()),
      GoRoute(path: '/admin/settings', builder: (_, __) => const AppSettingsScreen(showRegional: true)),
      GoRoute(path: '/chat', builder: (_, __) => const WhatsAppChatScreen()),
      GoRoute(
        path: '/chat/:tripId',
        builder: (_, state) => ChatScreen(tripId: state.pathParameters['tripId']!),
      ),
      GoRoute(path: '/voice', builder: (_, __) => const VoiceBookingScreen()),
      GoRoute(
        path: '/rider/call/:tripId',
        builder: (_, state) => CallScreen(tripId: state.pathParameters['tripId']),
      ),
      GoRoute(
        path: '/call/:tripId',
        builder: (_, state) => CallScreen(tripId: state.pathParameters['tripId']),
      ),
      GoRoute(path: '/call', builder: (_, __) => const CallScreen()),
      GoRoute(path: '/showcase', builder: (_, __) => const HubShowcaseScreen()),
      GoRoute(path: '/showcase/rider', builder: (_, __) => const RiderLiveScreen()),
      GoRoute(path: '/showcase/driver', builder: (_, __) => const DriverLiveScreen()),
      GoRoute(path: '/showcase/admin', builder: (_, __) => const AdminLiveScreen()),
    ],
  );
}

String _initialRoute(AppFlavor flavor) => switch (flavor) {
      AppFlavor.rider => AppConfig.legacyBackend ? '/rider/login' : '/welcome',
      AppFlavor.driver => AppConfig.legacyBackend ? '/driver/login' : '/welcome',
      AppFlavor.admin => '/admin/login',
      AppFlavor.dev => '/',
    };

/// 300ms fade transition between screens (Material 3 motion).
CustomTransitionPage<void> _fadePage(GoRouterState state, Widget child) {
  return CustomTransitionPage<void>(
    key: state.pageKey,
    child: child,
    transitionDuration: const Duration(milliseconds: 300),
    transitionsBuilder: (_, animation, __, c) => FadeTransition(opacity: animation, child: c),
  );
}
