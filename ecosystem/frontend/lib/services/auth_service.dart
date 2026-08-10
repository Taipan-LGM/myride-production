import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:my_ride/config/app_config.dart';

/// Phone OTP via Firebase Auth, with mock fallback for local dev.
class AuthService extends ChangeNotifier {
  AuthService._();
  static final AuthService instance = AuthService._();

  FirebaseAuth? _auth;
  String? _verificationId;
  String? _mockOtp;
  String? _phoneE164;
  User? _user;

  User? get user => _user;
  bool get isSignedIn => _user != null;
  String? get phoneNumber => _phoneE164 ?? _user?.phoneNumber;

  Future<void> init() async {
    if (!AppConfig.firebaseEnabled) return;
    _auth = FirebaseAuth.instance;
    _user = _auth!.currentUser;
    _auth!.authStateChanges().listen((u) {
      _user = u;
      notifyListeners();
    });
  }

  Future<void> sendOtp(String phoneRaw) async {
    final phone = _normalizePhone(phoneRaw);
    _phoneE164 = phone;

    if (AppConfig.useMockAuth) {
      _mockOtp = '482901';
      _verificationId = 'mock-verification';
      notifyListeners();
      return;
    }

    final completer = Completer<void>();
    await _auth!.verifyPhoneNumber(
      phoneNumber: phone,
      verificationCompleted: (credential) async {
        await _auth!.signInWithCredential(credential);
        _user = _auth!.currentUser;
        notifyListeners();
        if (!completer.isCompleted) completer.complete();
      },
      verificationFailed: (e) {
        if (!completer.isCompleted) completer.completeError(e.message ?? 'Verification failed');
      },
      codeSent: (verificationId, _) {
        _verificationId = verificationId;
        notifyListeners();
        if (!completer.isCompleted) completer.complete();
      },
      codeAutoRetrievalTimeout: (verificationId) {
        _verificationId = verificationId;
      },
    );
    return completer.future;
  }

  Future<void> verifyOtp(String code) async {
    if (AppConfig.useMockAuth) {
      if (code != _mockOtp) {
        throw Exception('Invalid code. Use $_mockOtp in mock mode.');
      }
      notifyListeners();
      return;
    }

    if (_verificationId == null) throw Exception('No verification in progress');
    final credential = PhoneAuthProvider.credential(verificationId: _verificationId!, smsCode: code);
    await _auth!.signInWithCredential(credential);
    _user = _auth!.currentUser;
    notifyListeners();
  }

  Future<void> signOut() async {
    if (!AppConfig.useMockAuth) await _auth?.signOut();
    _user = null;
    _verificationId = null;
    _mockOtp = null;
    notifyListeners();
  }

  String _normalizePhone(String raw) {
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.startsWith('1') && digits.length == 11) return '+$digits';
    if (digits.length == 10) return '+1$digits';
    if (raw.startsWith('+')) return raw;
    return '+$digits';
  }
}
