import 'dart:convert';

/// Thrown when the device has no network connectivity before an API call.
class NetworkException implements Exception {
  const NetworkException([this.message = 'No internet connection']);

  final String message;

  @override
  String toString() => 'NetworkException: $message';
}

/// HTTP/API failures with parsed server messages and status codes.
class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode, this.body, this.detail});

  final String message;
  final int? statusCode;
  final String? body;
  final String? detail;

  /// User-facing message for Snackbars.
  String get displayMessage {
    if (detail != null && detail!.isNotEmpty) return detail!;
    if (statusCode == 401) return 'Please sign in again';
    if (statusCode == 403) return 'You do not have permission for this action';
    if (statusCode == 404) return 'Resource not found';
    if (statusCode != null && statusCode! >= 500) return 'Server error — please try again';
    return message;
  }

  /// Parse FastAPI `{"detail": "..."}` or validation error lists.
  factory ApiException.fromResponse(int statusCode, String body, {String fallback = 'Request failed'}) {
    String? detail;
    try {
      if (body.isNotEmpty) {
        final decoded = jsonDecode(body);
        if (decoded is Map<String, dynamic>) {
          final d = decoded['detail'];
          if (d is String) {
            detail = d;
          } else if (d is List && d.isNotEmpty) {
            final first = d.first;
            if (first is Map && first['msg'] != null) detail = first['msg'].toString();
          } else if (decoded['message'] is String) {
            detail = decoded['message'] as String;
          } else if (decoded['error'] is String) {
            detail = decoded['error'] as String;
          }
        }
      }
    } catch (_) {}
    return ApiException(fallback, statusCode: statusCode, body: body, detail: detail);
  }

  @override
  String toString() => 'ApiException($statusCode): $displayMessage';
}
