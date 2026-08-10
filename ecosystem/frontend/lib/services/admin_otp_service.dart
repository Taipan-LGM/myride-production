import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:my_ride/config/app_config.dart';

class AdminOtpException implements Exception {
  AdminOtpException(this.message);
  final String message;
  @override
  String toString() => message;
}

class AdminOtpSendResult {
  const AdminOtpSendResult({required this.message, this.consoleDev = false, this.devCode});
  final String message;
  final bool consoleDev;
  final String? devCode;
}

/// Sends and verifies admin MFA codes via the local OTP mailer service.
class AdminOtpService {
  AdminOtpService._();
  static final AdminOtpService instance = AdminOtpService._();

  String get _base => AppConfig.adminOtpApiUrl.replaceAll(RegExp(r'/+$'), '');

  Future<AdminOtpSendResult> sendOtp(String email) async {
    final normalized = email.trim().toLowerCase();
    if (_base.isEmpty) {
      throw AdminOtpException(
        'OTP email service is not configured. Start backend/admin_otp_server.py with SMTP credentials.',
      );
    }

    final uri = Uri.parse('$_base/send');
    http.Response response;
    try {
      response = await http
          .post(
            uri,
            headers: const {'Content-Type': 'application/json'},
            body: jsonEncode({'email': normalized}),
          )
          .timeout(const Duration(seconds: 30));
    } catch (e) {
      throw AdminOtpException(
        'Could not reach OTP server at $_base. Run: cd backend && python3 admin_otp_server.py',
      );
    }

    final body = _decode(response);
    if (response.statusCode < 200 || response.statusCode >= 300 || body['ok'] != true) {
      throw AdminOtpException(body['error']?.toString() ?? 'Failed to send OTP email');
    }

    return AdminOtpSendResult(
      message: body['message']?.toString() ?? 'OTP sent',
      consoleDev: body['mode'] == 'console',
      devCode: body['dev_code']?.toString(),
    );
  }

  Future<void> verifyOtp(String email, String code) async {
    final normalized = email.trim().toLowerCase();
    if (_base.isEmpty) {
      throw AdminOtpException('OTP email service is not configured.');
    }

    final uri = Uri.parse('$_base/verify');
    http.Response response;
    try {
      response = await http
          .post(
            uri,
            headers: const {'Content-Type': 'application/json'},
            body: jsonEncode({'email': normalized, 'code': code.trim()}),
          )
          .timeout(const Duration(seconds: 15));
    } catch (e) {
      throw AdminOtpException('Could not reach OTP server at $_base');
    }

    final body = _decode(response);
    if (response.statusCode < 200 || response.statusCode >= 300 || body['ok'] != true) {
      throw AdminOtpException(body['error']?.toString() ?? 'Invalid or expired OTP');
    }
  }

  Map<String, dynamic> _decode(http.Response response) {
    try {
      return jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      return {'ok': false, 'error': response.body.isEmpty ? 'Empty response from OTP server' : response.body};
    }
  }
}
