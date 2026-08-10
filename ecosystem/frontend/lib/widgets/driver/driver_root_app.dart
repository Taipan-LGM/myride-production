import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/app.dart';
import 'package:my_ride/config/app_flavor.dart';
import 'package:my_ride/core/platform/background_location_permission.dart';
import 'package:my_ride/providers/driver_provider.dart';
import 'package:my_ride/services/location/location_permission_storage.dart';
import 'package:my_ride/services/permission_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_theme.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _driverPermissionsCompleteKey = 'driver_permissions_complete';

/// Whether driver startup permissions (foreground, background, notifications) are done.
final driverSetupCompleteProvider = FutureProvider<bool>((ref) async {
  if (kIsWeb || AppConfig.emulatorDev) return true;

  final prefs = await SharedPreferences.getInstance();
  if (prefs.getBool(_driverPermissionsCompleteKey) == true) return true;

  final foreground = await _safeForegroundGranted();
  final background = await BackgroundLocationPermission.isGranted();
  final notifications = await _safeNotificationGranted();

  return foreground && background && notifications;
});

Future<bool> _safeForegroundGranted() async {
  try {
    return await Permission.location.isGranted;
  } catch (_) {
    return kIsWeb;
  }
}

Future<bool> _safeNotificationGranted() async {
  try {
    return await Permission.notification.isGranted;
  } catch (_) {
    return true;
  }
}

Future<void> markDriverPermissionsComplete() async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool(_driverPermissionsCompleteKey, true);
  await LocationPermissionStorage.saveState(BackgroundPermissionState.granted);
}

/// Wraps [MyRideApp] — shows permission setup UI before the main app (native driver only).
class DriverRootApp extends ConsumerWidget {
  const DriverRootApp({super.key, this.navigatorKey});

  final GlobalKey<NavigatorState>? navigatorKey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final setup = ref.watch(driverSetupCompleteProvider);

    return setup.when(
      loading: () => MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: myRideTheme(),
        home: const Scaffold(
          backgroundColor: MrColors.primary,
          body: Center(child: CircularProgressIndicator(color: MrColors.secondary)),
        ),
      ),
      error: (e, _) => MaterialApp(
        home: Scaffold(body: Center(child: Text('Startup error: $e'))),
      ),
      data: (complete) {
        if (!complete) {
          return MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: myRideTheme(),
            home: DriverPermissionSetupScreen(
              onComplete: () => ref.invalidate(driverSetupCompleteProvider),
            ),
          );
        }
        return MyRideApp(flavor: AppFlavor.driver, navigatorKey: navigatorKey);
      },
    );
  }
}

/// First-launch driver permission flow — prompts run after Activity exists (not in main()).
class DriverPermissionSetupScreen extends ConsumerStatefulWidget {
  const DriverPermissionSetupScreen({super.key, required this.onComplete});

  final VoidCallback onComplete;

  @override
  ConsumerState<DriverPermissionSetupScreen> createState() => _DriverPermissionSetupScreenState();
}

class _DriverPermissionSetupScreenState extends ConsumerState<DriverPermissionSetupScreen> {
  int _step = 0;
  bool _busy = false;
  String? _error;

  static const _steps = [
    (
      title: 'Location while using the app',
      body: 'Tap "While using the app" when Android asks:\n\n'
          '"Allow My Ride to access this device\'s location?"',
      icon: Icons.location_on_outlined,
    ),
    (
      title: 'Location all the time',
      body: 'Tap "Allow all the time" when Android asks:\n\n'
          '"Allow My Ride to access location all the time?"\n\n'
          'This is required for background ride requests.',
      icon: Icons.my_location,
    ),
    (
      title: 'Notifications',
      body: 'Tap "Allow" when Android asks:\n\n'
          '"Allow My Ride to send notifications?"\n\n'
          'Needed for the online driver foreground service.',
      icon: Icons.notifications_active_outlined,
    ),
  ];

  Future<void> _runCurrentStep() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      if (_step == 0) {
        await Future<void>.delayed(const Duration(milliseconds: 400));
        final status = await requestForegroundLocationPermission();
        if (!status.isGranted && !kIsWeb) {
          setState(() => _error = 'Foreground location is required to continue.');
          return;
        }
        setState(() => _step++);
      } else if (_step == 1) {
        await Future<void>.delayed(const Duration(milliseconds: 400));
        if (BackgroundLocationPermission.isSupported) {
          final status = await BackgroundLocationPermission.request();
          if (!status.isGranted) {
            await LocationPermissionStorage.saveState(BackgroundPermissionState.denied);
            PermissionService.backgroundLocationDenied = true;
            setState(() => _error = 'Choose "Allow all the time" in Settings to continue.');
            return;
          }
          await LocationPermissionStorage.saveState(BackgroundPermissionState.granted);
          ref.read(driverProvider.notifier).setBackgroundPermission(BackgroundPermissionState.granted);
        }
        setState(() => _step++);
      } else if (_step == 2) {
        await Future<void>.delayed(const Duration(milliseconds: 400));
        await requestNotificationPermission();
        await markDriverPermissionsComplete();
        widget.onComplete();
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final step = _steps[_step.clamp(0, _steps.length - 1)];

    return Scaffold(
      backgroundColor: MrColors.primary,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 24),
              Icon(step.icon, size: 72, color: MrColors.secondary),
              const SizedBox(height: 24),
              Text(
                'Driver setup (${_step + 1}/${_steps.length})',
                style: MrText.sans(color: Colors.white70, size: 14),
              ),
              const SizedBox(height: 8),
              Text(step.title, style: MrText.sans(color: Colors.white, size: 26, weight: FontWeight.w800)),
              const SizedBox(height: 16),
              Text(step.body, style: MrText.sans(color: Colors.white70, size: 16, height: 1.4)),
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(_error!, style: MrText.sans(color: MrColors.accent, size: 14)),
              ],
              const Spacer(),
              if (_error != null)
                OutlinedButton.icon(
                  onPressed: _busy
                      ? null
                      : () async {
                          await openAppSettings();
                        },
                  icon: const Icon(Icons.settings, color: Colors.white),
                  label: const Text('Open Settings', style: TextStyle(color: Colors.white)),
                ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _busy ? null : _runCurrentStep,
                style: FilledButton.styleFrom(
                  backgroundColor: MrColors.secondary,
                  foregroundColor: MrColors.primary,
                  minimumSize: const Size.fromHeight(52),
                ),
                child: Text(
                  _busy
                      ? 'Waiting…'
                      : (_step == 0
                          ? 'Allow location'
                          : _step == 1
                              ? 'Allow all the time'
                              : 'Allow notifications'),
                  style: MrText.sans(weight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
