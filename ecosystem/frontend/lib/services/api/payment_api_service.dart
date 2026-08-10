import 'package:my_ride/core/api/api_client.dart';

class PaymentApiService {
  PaymentApiService({ApiClient? client}) : _client = client ?? ApiClient();
  final ApiClient _client;

  Future<Map<String, dynamic>> createHold({
    required String tripId,
    required String riderId,
    required int amountCents,
    String currency = 'zar',
  }) =>
      _client.postJson('/payments/hold', {
        'trip_id': tripId,
        'rider_id': riderId,
        'amount_cents': amountCents,
        'currency': currency,
      });

  Future<Map<String, dynamic>> capture({
    required String tripId,
    required String paymentIntentId,
    int? amountCents,
  }) =>
      _client.postJson('/payments/capture', {
        'trip_id': tripId,
        'payment_intent_id': paymentIntentId,
        if (amountCents != null) 'amount_cents': amountCents,
      });

  Future<Map<String, dynamic>> transfer({
    required String tripId,
    required String driverStripeAccountId,
    required int amountCents,
  }) =>
      _client.postJson('/payments/transfer', {
        'trip_id': tripId,
        'driver_stripe_account_id': driverStripeAccountId,
        'amount_cents': amountCents,
      });
}
