import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/core/api/api_exception.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/models/ride_models.dart';
import 'package:my_ride/services/api/ai_api_service.dart';
import 'package:my_ride/services/api/driver_api_service.dart';
import 'package:my_ride/services/api/trip_api_service.dart';
import 'package:my_ride/services/location/location_service.dart';
import 'package:my_ride/services/payment_service.dart';
import 'package:my_ride/services/secure_storage_service.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Central trip + backend state shared across Rider / Driver tabs.
class TripSessionService extends ChangeNotifier {
  TripSessionService._();
  static final TripSessionService instance = TripSessionService._();

  final TripApiService _trips = TripApiService();
  final DriverApiService _drivers = DriverApiService();
  final AiApiService _ai = AiApiService();

  Trip? activeTrip;
  DriverProfile? assignedDriver;
  List<NearbyDriver> nearbyDrivers = [];
  bool isLoading = false;
  String? error;
  bool backendOnline = false;
  String backendVersion = '';
  WebSocketChannel? _ws;
  StreamSubscription? _wsSub;
  final List<TripWsEvent> wsEvents = [];

  String riderId = ApiConfig.defaultRiderId;
  String driverId = ApiConfig.defaultDriverId;

  Future<void> bootstrap() async {
    try {
      final health = await _trips.checkHealth();
      backendOnline = health['status'] == 'ok';
      backendVersion = health['version']?.toString() ?? '';
      if (backendOnline) {
        try {
          await _trips.seedDemo();
        } catch (_) {
          // seed endpoint only in DEBUG mode
        }
      }
      error = null;
    } on ApiException catch (e) {
      backendOnline = false;
      error = 'Backend offline: ${e.message}';
    } catch (e) {
      backendOnline = false;
      error = 'Backend unreachable: $e';
    }
    notifyListeners();
  }

  Future<Trip?> bookRide({
    required RideTier tier,
    String pickupAddress = 'Current location',
    String dropoffAddress = 'V&A Waterfront',
  }) async {
    isLoading = true;
    error = null;
    notifyListeners();
    try {
      final fareCents = (tier.baseFare * 100).round();
      final gps = await LocationService.instance.getCurrentPosition();
      final pickup = gps ?? GeoPoint(lat: ApiConfig.defaultLat, lng: ApiConfig.defaultLng);
      final resolvedPickup = pickupAddress == 'Current location' || pickupAddress == 'Cape Town CBD'
          ? (await LocationService.instance.reverseGeocode(pickup) ?? 'Current location')
          : pickupAddress;
      final trip = await _trips.createTrip(
        riderId: riderId,
        pickup: pickup,
        dropoff: const GeoPoint(lat: -33.9180, lng: 18.4232),
        pickupAddress: resolvedPickup,
        dropoffAddress: dropoffAddress,
        fareEstimateCents: fareCents,
      );
      activeTrip = trip;

      final payment = await PaymentService.instance.authorizeTripHold(
        tripId: trip.id,
        riderId: riderId,
        amountCents: fareCents,
        currency: trip.currency,
      );
      if (!payment.success) {
        error = payment.message ?? 'Payment authorization failed';
        return null;
      }

      nearbyDrivers = await _trips.nearbyDrivers();
      if (nearbyDrivers.isNotEmpty) {
        assignedDriver = nearbyDrivers.first.driver;
        activeTrip = await _trips.assignDriver(tripId: trip.id, driverId: nearbyDrivers.first.driver.id);
      }

      await _connectWs(trip.id);
      activeTrip = await _trips.updateStatus(tripId: trip.id, status: TripStatus.driverArriving);
      return activeTrip;
    } on ApiException catch (e) {
      error = e.message;
      return null;
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<void> driverSetOnline(bool online) async {
    try {
      await _drivers.updateLocation(
        driverId: driverId,
        location: GeoPoint(lat: ApiConfig.defaultLat, lng: ApiConfig.defaultLng),
        isOnline: online,
      );
      error = null;
    } on ApiException catch (e) {
      error = e.message;
    }
    notifyListeners();
  }

  Future<Trip?> driverAcceptTrip() async {
    final trip = activeTrip;
    if (trip == null) return null;
    isLoading = true;
    notifyListeners();
    try {
      activeTrip = await _trips.assignDriver(tripId: trip.id, driverId: driverId);
      activeTrip = await _trips.updateStatus(tripId: trip.id, status: TripStatus.inProgress);
      return activeTrip;
    } on ApiException catch (e) {
      error = e.message;
      return null;
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<AiParseResponse> parseMessage(String text, {String channel = 'whatsapp'}) =>
      _ai.parse(text: text, userId: riderId, channel: channel);

  Future<Trip?> bookFromAi(String text) async {
    final ai = await parseMessage(text, channel: 'whatsapp');
    if (ai.intent != 'book_ride') return null;
    return bookRide(
      tier: RideTier.economy,
      pickupAddress: ai.suggestedPickup ?? 'Pickup',
      dropoffAddress: ai.suggestedDropoff ?? 'Destination',
    );
  }

  Future<void> _connectWs(String tripId) async {
    await _wsSub?.cancel();
    await _ws?.sink.close();
    final token = await SecureStorageService.instance.loadJwtToken();
    if (token == null || token.isEmpty) {
      throw StateError('Login required for trip updates');
    }
    final uri = ApiConfig.wsUri('/ws/trips/$tripId');
    _ws = WebSocketChannel.connect(uri);
    _ws!.sink.add(jsonEncode({'type': 'auth', 'token': token}));
    _wsSub = _ws!.stream.listen((raw) {
      try {
        final map = jsonDecode(raw as String) as Map<String, dynamic>;
        final event = TripWsEvent.fromJson(map);
        wsEvents.insert(0, event);
        notifyListeners();
      } catch (_) {}
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    _ws?.sink.close();
    super.dispose();
  }
}
