import 'package:my_ride/models/api_models.dart';

/// Sample trips for offline UI development when API is unreachable.
abstract final class SampleData {
  static const pickup = GeoPoint(lat: -33.9249, lng: 18.4241);
  static const dropoff = GeoPoint(lat: -33.9180, lng: 18.4232);

  static List<Trip> get sampleTrips => [
        Trip(
          id: 'trip-sample-001',
          riderId: 'rider-demo-001',
          driverId: 'driver-demo-001',
          status: TripStatus.completed,
          pickup: pickup,
          dropoff: dropoff,
          pickupAddress: 'Cape Town CBD',
          dropoffAddress: 'V&A Waterfront',
          fareEstimateCents: 2450,
          fareFinalCents: 2450,
          currency: 'zar',
        ),
        Trip(
          id: 'trip-sample-002',
          riderId: 'rider-demo-001',
          status: TripStatus.cancelled,
          pickup: pickup,
          dropoff: dropoff,
          pickupAddress: 'Camps Bay',
          dropoffAddress: 'Airport',
          fareEstimateCents: 4500,
          currency: 'zar',
        ),
      ];

  static const addressSuggestions = [
    'Cape Town CBD',
    'V&A Waterfront',
    'Camps Bay Beach',
    'Table Mountain Cableway',
    'Cape Town International Airport',
    'Stellenbosch',
    'Bellville',
  ];
}
