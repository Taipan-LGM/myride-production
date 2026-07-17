import 'package:flutter/material.dart';
import 'package:my_ride/services/location/location_service.dart';
import 'package:my_ride/services/permission_service.dart';

/// UI helpers for background location education (used by driver screens).
abstract final class Bootstrap {
  Bootstrap._();

  static bool get backgroundLocationDenied => PermissionService.backgroundLocationDenied;

  static Future<void> showBackgroundLocationEducationDialog(BuildContext context) async {
    if (!context.mounted) return;

    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Background location needed'),
        content: const Text(
          'As a driver, My Ride needs "Allow all the time" location access so you '
          'can receive ride requests and share your position while the app is in the background.\n\n'
          'On the next screen, choose "Allow all the time".',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Not now')),
          FilledButton(
            onPressed: () async {
              Navigator.pop(ctx);
              try {
                await LocationService.instance.requestBackgroundPermission();
              } catch (_) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text(PermissionService.backgroundDeniedSnackbarMessage)),
                  );
                }
              }
            },
            child: const Text('Try again'),
          ),
        ],
      ),
    );
  }
}
