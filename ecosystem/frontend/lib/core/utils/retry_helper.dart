import 'dart:async';
import 'dart:math';

import 'package:my_ride/core/api/api_exception.dart';

/// Retries an async operation up to [maxAttempts] with exponential backoff.
Future<T> retryWithBackoff<T>(
  Future<T> Function() operation, {
  int maxAttempts = 3,
  Duration initialDelay = const Duration(milliseconds: 400),
  bool Function(Object error)? retryIf,
}) async {
  var attempt = 0;
  while (true) {
    attempt++;
    try {
      return await operation();
    } catch (e) {
      final shouldRetry = retryIf?.call(e) ?? _defaultRetry(e);
      if (!shouldRetry || attempt >= maxAttempts) rethrow;
      final delay = initialDelay * pow(2, attempt - 1);
      await Future<void>.delayed(delay);
    }
  }
}

bool _defaultRetry(Object error) {
  if (error is NetworkException) return true;
  if (error is ApiException) {
    final code = error.statusCode;
    if (code == null) return true;
    return code >= 500 || code == 408 || code == 429;
  }
  return error is TimeoutException;
}
