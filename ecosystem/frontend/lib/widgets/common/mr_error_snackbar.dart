import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/core/api/api_exception.dart';
import 'package:my_ride/theme/mr_tokens.dart';

/// Shows API/network errors as Material Snackbars.
abstract final class MrErrorSnackbar {
  static void show(
    BuildContext context,
    String message, {
    VoidCallback? onRetry,
    String retryLabel = 'Retry',
  }) {
    if (!context.mounted) return;
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message, semanticsLabel: 'Error: $message'),
          backgroundColor: MrColors.accent,
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 4),
          action: onRetry != null
              ? SnackBarAction(label: retryLabel, textColor: Colors.white, onPressed: onRetry)
              : null,
        ),
      );
  }

  static void showException(BuildContext context, Object error, {VoidCallback? onRetry}) {
    final msg = _messageFor(error);
    if (error is ApiException && error.statusCode == 401 && onRetry == null) {
      show(
        context,
        msg,
        retryLabel: 'Sign in',
        onRetry: () {
          if (!context.mounted) return;
          context.go(AppConfig.legacyBackend ? '/rider/login' : '/welcome');
        },
      );
      return;
    }
    show(context, msg, onRetry: onRetry);
  }

  static String _messageFor(Object error) {
    if (error is ApiException) {
      final d = error.detail?.trim();
      if (d != null && d.isNotEmpty) {
        return switch (d) {
          'invalid_credentials' => 'Wrong email or password',
          'email_already_in_use' => 'That email is already registered — sign in instead',
          'invalid_input' => 'Check name, email, and password (8+ characters)',
          'too_many_requests' => 'Too many attempts — wait a minute and try again',
          _ => d,
        };
      }
      return error.displayMessage;
    }
    if (error is NetworkException) return error.message;
    final s = error.toString();
    if (s.contains('Failed to fetch') || s.contains('ClientException') || s.contains('XMLHttpRequest')) {
      return 'Cannot reach API. Is Node running on :3000?';
    }
    return s;
  }
}
