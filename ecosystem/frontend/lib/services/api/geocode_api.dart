import 'package:my_ride/core/api/api_client.dart';

class PlaceSuggestion {
  const PlaceSuggestion({
    required this.label,
    required this.lat,
    required this.lng,
  });

  final String label;
  final double lat;
  final double lng;

  factory PlaceSuggestion.fromJson(Map<String, dynamic> json) => PlaceSuggestion(
        label: json['label'] as String? ?? '',
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
      );
}

/// OpenStreetMap Nominatim via FastAPI `/geocode/*` proxy.
class GeocodeApi {
  GeocodeApi({ApiClient? client}) : _client = client ?? ApiClient();

  final ApiClient _client;

  Future<List<PlaceSuggestion>> search(String query, {int limit = 6}) async {
    if (query.trim().length < 2) return const [];
    final data = await _client.getJson(
      '/geocode/search?q=${Uri.encodeQueryComponent(query.trim())}&limit=$limit',
    );
    final raw = data['results'] as List<dynamic>? ?? const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(PlaceSuggestion.fromJson)
        .toList();
  }

  Future<PlaceSuggestion?> reverse(double lat, double lng) async {
    final data = await _client.getJson('/geocode/reverse?lat=$lat&lng=$lng');
    if (data['label'] == null) return null;
    return PlaceSuggestion.fromJson(data);
  }
}
