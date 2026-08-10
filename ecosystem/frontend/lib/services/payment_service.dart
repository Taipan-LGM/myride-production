import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:http/http.dart' as http;
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/services/api/payment_api_service.dart';

enum PaymentProvider { stripe, paystack, mock }

class PaymentResult {
  const PaymentResult({required this.success, this.message, this.reference});

  final bool success;
  final String? message;
  final String? reference;
}

/// Stripe PaymentSheet + Paystack initialize via backend URL.
class PaymentService extends ChangeNotifier {
  PaymentService._();
  static final PaymentService instance = PaymentService._();

  double _walletBalance = 24.50;

  double get walletBalance => _walletBalance;

  Future<void> init() async {}

  /// Authorize trip fare via FastAPI `/payments/hold` and optionally present Stripe PaymentSheet.
  Future<PaymentResult> authorizeTripHold({
    required String tripId,
    required String riderId,
    required int amountCents,
    String currency = 'zar',
  }) async {
    final hold = await PaymentApiService().createHold(
      tripId: tripId,
      riderId: riderId,
      amountCents: amountCents,
      currency: currency,
    );

    if (AppConfig.useMockPayments) {
      return PaymentResult(success: true, message: 'Payment hold authorized (mock)', reference: hold['id']?.toString());
    }

    if (AppConfig.stripeEnabled) {
      return _presentStripeHold(hold);
    }

    return PaymentResult(success: true, reference: hold['id']?.toString());
  }

  Future<PaymentResult> _presentStripeHold(Map<String, dynamic> hold) async {
    final clientSecret = hold['client_secret'] as String?;
    if (clientSecret == null || clientSecret.isEmpty) {
      return PaymentResult(success: true, message: 'Hold created without client_secret (dev mock)', reference: hold['id']?.toString());
    }

    try {
      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          paymentIntentClientSecret: clientSecret,
          merchantDisplayName: 'My Ride',
        ),
      );
      await Stripe.instance.presentPaymentSheet();
      return PaymentResult(success: true, reference: hold['id']?.toString());
    } catch (e) {
      return PaymentResult(success: false, message: e.toString());
    }
  }

  Future<PaymentResult> topUp({required double amountUsd, PaymentProvider? provider}) async {
    final p = provider ?? _defaultProvider();

    return switch (p) {
      PaymentProvider.mock => _mockTopUp(amountUsd),
      PaymentProvider.stripe => _stripeTopUp(amountUsd),
      PaymentProvider.paystack => _paystackTopUp(amountUsd),
    };
  }

  Future<PaymentResult> chargeTrip({required double amountUsd, String? description}) async {
    if (_walletBalance < amountUsd) {
      return const PaymentResult(success: false, message: 'Insufficient wallet balance');
    }
    _walletBalance -= amountUsd;
    notifyListeners();
    return PaymentResult(success: true, message: description ?? 'Trip charged', reference: 'MR-${DateTime.now().millisecondsSinceEpoch}');
  }

  PaymentProvider _defaultProvider() {
    if (AppConfig.stripeEnabled) return PaymentProvider.stripe;
    if (AppConfig.paystackEnabled) return PaymentProvider.paystack;
    return PaymentProvider.mock;
  }

  Future<PaymentResult> _mockTopUp(double amount) async {
    await Future<void>.delayed(const Duration(milliseconds: 600));
    _walletBalance += amount;
    notifyListeners();
    return PaymentResult(success: true, message: 'Mock top-up successful', reference: 'mock-${amount.toStringAsFixed(2)}');
  }

  Future<PaymentResult> _stripeTopUp(double amountUsd) async {
    final backend = AppConfig.stripeBackendUrl;
    if (backend.isEmpty && AppConfig.apiEnabled) {
      final hold = await PaymentApiService().createHold(
        tripId: 'wallet-topup-${DateTime.now().millisecondsSinceEpoch}',
        riderId: 'wallet',
        amountCents: (amountUsd * 100).round(),
        currency: 'usd',
      );
      return _presentStripeHold(hold);
    }

    if (backend.isEmpty) {
      return const PaymentResult(success: false, message: 'Set STRIPE_BACKEND_URL or API_BASE_URL for Stripe');
    }

    final res = await http.post(
      Uri.parse('$backend/stripe/payment-intent'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'amount_cents': (amountUsd * 100).round(), 'currency': 'usd'}),
    );

    if (res.statusCode != 200) {
      return PaymentResult(success: false, message: 'Stripe backend error: ${res.statusCode}');
    }

    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final clientSecret = data['client_secret'] as String?;
    if (clientSecret == null) {
      return const PaymentResult(success: false, message: 'Missing client_secret from backend');
    }

    await Stripe.instance.initPaymentSheet(
      paymentSheetParameters: SetupPaymentSheetParameters(
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: 'My Ride',
      ),
    );
    await Stripe.instance.presentPaymentSheet();

    _walletBalance += amountUsd;
    notifyListeners();
    return PaymentResult(success: true, reference: data['id']?.toString());
  }

  Future<PaymentResult> _paystackTopUp(double amountUsd) async {
    final backend = AppConfig.paystackBackendUrl;
    final res = await http.post(
      Uri.parse('$backend/paystack/initialize'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'amount': (amountUsd * 100).round(),
        'email': 'rider@myride.app',
        'currency': 'USD',
      }),
    );

    if (res.statusCode != 200) {
      return PaymentResult(success: false, message: 'Paystack init failed: ${res.statusCode}');
    }

    final data = jsonDecode(res.body) as Map<String, dynamic>;
    final authorizationUrl = data['authorization_url'] as String?;
    if (authorizationUrl == null) {
      return PaymentResult(success: false, message: 'Missing authorization_url — open in WebView in production');
    }

    // Production: launch WebView / url_launcher to authorizationUrl, verify via callback.
    _walletBalance += amountUsd;
    notifyListeners();
    return PaymentResult(success: true, message: 'Paystack initialized (complete in WebView)', reference: data['reference']?.toString());
  }
}
