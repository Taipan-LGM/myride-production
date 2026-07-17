import 'package:my_ride/core/api/api_client.dart';

/// Rider wallet / loyalty / places against FastAPI.
class WalletApiService {
  WalletApiService({ApiClient? client}) : _client = client ?? ApiClient();

  final ApiClient _client;

  Future<Map<String, dynamic>> getWallet() => _client.getJson('/wallet');

  Future<Map<String, dynamic>> topUp({required int amountCents}) =>
      _client.postJson('/wallet/top-up', {'amount_cents': amountCents});

  Future<Map<String, dynamic>> getLoyalty() => _client.getJson('/loyalty');

  Future<List<dynamic>> getPlaces() async {
    final data = await _client.getJson('/places');
    return (data['places'] as List?) ?? const [];
  }

  Future<Map<String, dynamic>> savePlace({
    required String kind,
    required String label,
    required double lat,
    required double lng,
  }) =>
      _client.postJson('/places', {
        'kind': kind,
        'label': label,
        'lat': lat,
        'lng': lng,
      });

  Future<Map<String, dynamic>> redeemPromo(String code) =>
      _client.postJson('/promos/redeem', {'code': code.trim()});

  Future<Map<String, dynamic>> referralMe() => _client.getJson('/referrals/me');
}

/// Driver earnings against FastAPI.
class DriverEarningsApiService {
  DriverEarningsApiService({ApiClient? client}) : _client = client ?? ApiClient();

  final ApiClient _client;

  Future<Map<String, dynamic>> summary() => _client.getJson('/driver/earnings');
}
