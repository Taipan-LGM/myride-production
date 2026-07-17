import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/config/app_config.dart';
import 'package:my_ride/core/api/api_config.dart';
import 'package:my_ride/core/api/api_exception.dart';
import 'package:my_ride/core/utils/debouncer.dart';
import 'package:my_ride/data/sample_data.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/providers/auth_provider.dart';
import 'package:my_ride/providers/location_provider.dart';
import 'package:my_ride/models/ride/ride_request.dart';
import 'package:my_ride/providers/ride_provider.dart';
import 'package:my_ride/providers/socket_provider.dart';
import 'package:my_ride/providers/trip_provider.dart';
import 'package:my_ride/services/api/geocode_api.dart';
import 'package:my_ride/services/api/wallet_api_service.dart';
import 'package:my_ride/services/mobile_api_service.dart';
import 'package:my_ride/services/payment_service.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/common/mr_error_snackbar.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';
import 'package:my_ride/widgets/safety/sos_actions.dart';

class RideRequestScreen extends ConsumerStatefulWidget {
  const RideRequestScreen({super.key, this.suggestion});

  final String? suggestion;

  @override
  ConsumerState<RideRequestScreen> createState() => _RideRequestScreenState();
}

class _RideRequestScreenState extends ConsumerState<RideRequestScreen> {
  late final _pickup = TextEditingController();
  late final _dropoff = TextEditingController();
  late final _promo = TextEditingController();
  Map<String, dynamic>? _fare;
  bool _loading = false;
  bool _locating = false;
  String? _error;
  String? _promoMsg;
  GeoPoint? _pickupPoint;
  GeoPoint? _dropoffPoint;
  final _debouncer = Debouncer();
  final _pickupDebounce = Debouncer();
  final _dropoffDebounce = Debouncer();
  List<String> _filteredSuggestions = SampleData.addressSuggestions;
  List<PlaceSuggestion> _pickupOsm = const [];
  List<PlaceSuggestion> _dropoffOsm = const [];
  List<Map<String, dynamic>> _savedPlaces = const [];
  final _api = MobileApiService();
  final _geocode = GeocodeApi();
  final _walletApi = WalletApiService();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ref.read(locationProvider.notifier).init();
      if (!mounted) return;
      final loc = ref.read(locationProvider);
      _pickupPoint = loc.position ?? GeoPoint(lat: ApiConfig.defaultLat, lng: ApiConfig.defaultLng);
      final suggestion = widget.suggestion?.trim();
      if (suggestion != null &&
          suggestion.isNotEmpty &&
          suggestion != 'Current location') {
        _pickup.text = suggestion;
      } else if (loc.position != null && loc.address != null) {
        _pickup.text = loc.address!;
      } else {
        _pickup.clear();
      }
      try {
        final places = await _walletApi.getPlaces();
        if (mounted) {
          setState(() {
            _savedPlaces = places.map((e) => Map<String, dynamic>.from(e as Map)).toList();
          });
        }
      } catch (_) {}
      _loadFare();
    });
  }

  Future<void> _useCurrentLocation() async {
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      await ref.read(locationProvider.notifier).refresh();
      final loc = ref.read(locationProvider);
      final pos = loc.position;
      if (pos == null) {
        setState(() {
          _error =
              'GPS unavailable. Type your pickup address below (OpenStreetMap autofill).';
        });
        _pickup.selection = TextSelection(baseOffset: 0, extentOffset: _pickup.text.length);
        return;
      }
      var label = loc.address ?? 'Current location';
      try {
        final rev = await _geocode.reverse(pos.lat, pos.lng);
        if (rev != null) label = rev.label;
      } catch (_) {}
      setState(() {
        _pickupPoint = pos;
        _pickup.text = label;
        _pickupOsm = const [];
        _error = null;
      });
      await _loadFare();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Pickup set to your current location')),
        );
      }
    } catch (e) {
      setState(() {
        _error =
            'GPS unavailable. Type your pickup address below (OpenStreetMap autofill).';
      });
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  void dispose() {
    _debouncer.dispose();
    _pickupDebounce.dispose();
    _dropoffDebounce.dispose();
    _pickup.dispose();
    _dropoff.dispose();
    _promo.dispose();
    super.dispose();
  }

  void _onPickupChanged(String value) {
    _pickupDebounce.run(() async {
      if (AppConfig.legacyBackend) return;
      try {
        final results = await _geocode.search(value);
        if (mounted) setState(() => _pickupOsm = results);
      } catch (_) {
        if (mounted) setState(() => _pickupOsm = const []);
      }
    });
  }

  void _onDropoffChanged(String value) {
    _debouncer.run(() {
      final q = value.toLowerCase();
      setState(() {
        _filteredSuggestions = SampleData.addressSuggestions
            .where((s) => s.toLowerCase().contains(q))
            .toList();
      });
      _loadFare();
    });
    _dropoffDebounce.run(() async {
      if (AppConfig.legacyBackend) return;
      try {
        final results = await _geocode.search(value);
        if (mounted) setState(() => _dropoffOsm = results);
      } catch (_) {
        if (mounted) setState(() => _dropoffOsm = const []);
      }
    });
  }

  Future<void> _loadFare() async {
    final pickup = _pickupPoint ?? ref.read(locationProvider).position;
    final dropoff = _dropoffPoint;
    if (pickup == null || dropoff == null) {
      if (mounted) setState(() => _fare = null);
      return;
    }
    try {
      final fare = await _api.fareEstimate(pickup: pickup, dropoff: dropoff);
      if (mounted) setState(() => _fare = fare);
    } catch (_) {}
  }

  Future<void> _ensureApiReachable() async {
    try {
      await _api.fareEstimate(
        pickup: GeoPoint(lat: ApiConfig.defaultLat, lng: ApiConfig.defaultLng),
        dropoff: const GeoPoint(lat: -33.9180, lng: 18.4232),
      );
    } catch (e) {
      throw ApiException(
        'Cannot reach My Ride API at ${AppConfig.apiBaseUrl}. '
        'Start it with: cd ecosystem && ./run-api.sh',
      );
    }
  }

  Future<void> _requestRide() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    ref.read(tripProvider.notifier).setLoading(true);
    try {
      final pos = _pickupPoint ?? ref.read(locationProvider).position;
      final pickupLat = pos?.lat ?? ApiConfig.defaultLat;
      final pickupLng = pos?.lng ?? ApiConfig.defaultLng;

      if (AppConfig.legacyBackend) {
        final response = await ref.read(rideProvider.notifier).requestRide(
              RideRequest(
                pickupAddress: _pickup.text.trim().isEmpty ? 'Pickup' : _pickup.text.trim(),
                pickupLat: pickupLat,
                pickupLng: pickupLng,
                dropoffAddress: _dropoff.text.trim().isEmpty ? 'Dropoff' : _dropoff.text.trim(),
                dropoffLat: ApiConfig.defaultLat + 0.01,
                dropoffLng: ApiConfig.defaultLng + 0.01,
                vehicleType: 'Car',
                paymentMethod: 'cash',
              ),
            );

        ref.watch(socketConnectionProvider);
        if (mounted) context.go('/rider/tracking/${response.rideId}');
        return;
      }

      await _ensureApiReachable();

      final user = ref.read(authProvider).user;
      final riderId = user?.id ?? ApiConfig.defaultRiderId;
      final amountCents = (_fare?['total_cents'] as num?)?.toInt() ?? 2450;

      final intent = await _api.createPaymentIntent(
        amountCents: amountCents,
        riderId: riderId,
      );
      final paymentIntentId = intent['id'] as String?;

      if (AppConfig.stripeEnabled && intent['client_secret'] != null) {
        await Stripe.instance.initPaymentSheet(
          paymentSheetParameters: SetupPaymentSheetParameters(
            paymentIntentClientSecret: intent['client_secret'] as String,
            merchantDisplayName: 'My Ride',
            applePay: const PaymentSheetApplePay(merchantCountryCode: 'ZA'),
            googlePay: const PaymentSheetGooglePay(merchantCountryCode: 'ZA', testEnv: true),
          ),
        );
        await Stripe.instance.presentPaymentSheet();
      } else if (!AppConfig.useMockPayments) {
        final hold = await PaymentService.instance.authorizeTripHold(
          tripId: intent['trip_id'] as String? ?? 'temp',
          riderId: riderId,
          amountCents: amountCents,
        );
        if (!hold.success) {
          throw Exception(hold.message ?? 'Payment authorization failed');
        }
      }

      final drop = _dropoffPoint;
      if (drop == null) {
        throw Exception('Pick a dropoff from OpenStreetMap suggestions first.');
      }
      final trip = await _api.requestRide(
        riderId: riderId,
        pickup: GeoPoint(lat: pickupLat, lng: pickupLng),
        dropoff: drop,
        pickupAddress: _pickup.text.trim().isEmpty ? 'Current location' : _pickup.text.trim(),
        dropoffAddress: _dropoff.text.trim().isEmpty ? 'Dropoff' : _dropoff.text.trim(),
        paymentIntentId: paymentIntentId,
        fareEstimateCents: amountCents,
        distanceKm: (_fare?['distance_km'] as num?)?.toDouble(),
        durationMinutes: (_fare?['duration_minutes'] as num?)?.toInt(),
      );

      ref.read(tripProvider.notifier).setCurrent(trip);
      if (mounted) context.go('/rider/tracking/${trip.id}');
    } catch (e) {
      final message = switch (e) {
        ApiException ae => ae.displayMessage,
        NetworkException ne => '${ne.message} — check API at ${AppConfig.apiBaseUrl}',
        _ => e.toString(),
      };
      setState(() => _error = message);
      ref.read(tripProvider.notifier).setError(message);
      if (mounted) MrErrorSnackbar.showException(context, e, onRetry: _requestRide);
    } finally {
      ref.read(tripProvider.notifier).setLoading(false);
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Request ride'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: SosFab(
              onPressed: () => SosActions.trigger(
                context,
                lat: _pickupPoint?.lat ?? ref.read(locationProvider).position?.lat,
                lng: _pickupPoint?.lng ?? ref.read(locationProvider).position?.lng,
                note: 'Ride request SOS',
              ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_savedPlaces.isNotEmpty) ...[
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _savedPlaces.map((p) {
                final kind = p['kind']?.toString() ?? 'other';
                final label = p['label']?.toString() ?? kind;
                return ActionChip(
                  avatar: Icon(kind == 'work' ? Icons.work_outline : Icons.home_outlined, size: 18),
                  label: Text(label),
                  onPressed: () {
                    final point = GeoPoint(
                      lat: (p['lat'] as num).toDouble(),
                      lng: (p['lng'] as num).toDouble(),
                    );
                    setState(() {
                      if (kind == 'work') {
                        _dropoff.text = label;
                        _dropoffPoint = point;
                      } else {
                        _pickup.text = label;
                        _pickupPoint = point;
                        _error = null;
                      }
                    });
                    _loadFare();
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _pickup,
            decoration: InputDecoration(
              labelText: 'Pickup',
              hintText: 'Type house number + street',
              prefixIcon: const Icon(Icons.trip_origin, color: MrColors.secondary),
              border: const OutlineInputBorder(),
              suffixIcon: IconButton(
                tooltip: 'Current location',
                onPressed: _locating ? null : _useCurrentLocation,
                icon: _locating
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.my_location, color: MrColors.primary),
              ),
            ),
            onTap: () {
              final v = _pickup.text.trim();
              if (v == 'Current location' ||
                  v == 'Cape Town CBD' ||
                  v.startsWith('Current location')) {
                _pickup.clear();
              }
              if (_error != null) setState(() => _error = null);
            },
            onChanged: (v) {
              if (_error != null) setState(() => _error = null);
              _onPickupChanged(v);
              _loadFare();
            },
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _locating ? null : _useCurrentLocation,
            icon: const Icon(Icons.gps_fixed),
            label: Text(_locating ? 'Getting location…' : 'Use current location'),
          ),
          if (_pickupOsm.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text('OpenStreetMap suggestions', style: MrText.sans(size: 12, color: MrColors.textSecondary)),
            ..._pickupOsm.map(
              (p) => ListTile(
                dense: true,
                leading: const Icon(Icons.place_outlined, size: 18),
                title: Text(p.label, style: MrText.sans(size: 13)),
            onTap: () {
                  final typed = _pickup.text;
                  final house = RegExp(r'^(\d+[A-Za-z]?)\b').firstMatch(typed)?.group(1);
                  var label = p.label;
                  if (house != null && !label.split(',').first.contains(house)) {
                    label = '$house $label';
                  }
                  // Keep rider-typed line when it already has number + street
                  if (house != null && RegExp(r'\d+[A-Za-z]?\s+\S{2,}').hasMatch(typed.trim())) {
                    label = typed.trim();
                  }
                  setState(() {
                    _pickup.text = label;
                    _pickupPoint = GeoPoint(lat: p.lat, lng: p.lng);
                    _pickupOsm = const [];
                  });
                  _loadFare();
                },
              ),
            ),
          ],
          const SizedBox(height: 12),
          if (AppConfig.legacyBackend)
            ..._filteredSuggestions.map((s) => ListTile(
                  dense: true,
                  title: Text(s, style: MrText.sans(size: 13)),
                  onTap: () {
                    _dropoff.text = s;
                    _onDropoffChanged(s);
                  },
                )),
          const SizedBox(height: 8),
          TextField(
            controller: _dropoff,
            decoration: const InputDecoration(
              labelText: 'Dropoff',
              hintText: 'Type house number + street',
              prefixIcon: Icon(Icons.place, color: MrColors.accent),
              border: OutlineInputBorder(),
              helperText: 'Type to search OpenStreetMap',
            ),
            onTap: () {
              final v = _dropoff.text.trim();
              if (v == 'V&A Waterfront, Cape Town' || v == 'V&A Waterfront') {
                _dropoff.clear();
              }
            },
            onChanged: _onDropoffChanged,
          ),
          if (_dropoffOsm.isNotEmpty) ...[
            const SizedBox(height: 4),
            ..._dropoffOsm.map(
              (p) => ListTile(
                dense: true,
                leading: const Icon(Icons.flag_outlined, size: 18),
                title: Text(p.label, style: MrText.sans(size: 13)),
                onTap: () {
                  final typed = _dropoff.text;
                  final house = RegExp(r'^(\d+[A-Za-z]?)\b').firstMatch(typed)?.group(1);
                  var label = p.label;
                  if (house != null && !label.split(',').first.contains(house)) {
                    label = '$house $label';
                  }
                  if (house != null && RegExp(r'\d+[A-Za-z]?\s+\S{2,}').hasMatch(typed.trim())) {
                    label = typed.trim();
                  }
                  setState(() {
                    _dropoff.text = label;
                    _dropoffPoint = GeoPoint(lat: p.lat, lng: p.lng);
                    _dropoffOsm = const [];
                  });
                  _loadFare();
                },
              ),
            ),
          ],
          if (_fare != null) ...[
            const SizedBox(height: 20),
            _FareCard(fare: _fare!),
          ],
          const SizedBox(height: 16),
          ListTile(
            tileColor: MrColors.neutral100,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            leading: const Icon(Icons.credit_card, color: Color(0xFF635BFF)),
            title: Text(AppConfig.useMockPayments ? 'Demo payment (no card needed)' : 'Visa •••• 4242'),
            trailing: AppConfig.useMockPayments ? null : TextButton(onPressed: () {}, child: const Text('Add card')),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _promo,
            decoration: const InputDecoration(
              labelText: 'Promo code',
              hintText: 'MYRIDE50',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.local_offer_outlined),
            ),
            textCapitalization: TextCapitalization.characters,
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              onPressed: () async {
                final code = _promo.text.trim();
                if (code.isEmpty) return;
                try {
                  final res = await _walletApi.redeemPromo(code);
                  setState(() {
                    _promoMsg =
                        'Credited R${((res['credited_cents'] as num?) ?? 0) / 100} — ${res['label'] ?? code}';
                  });
                } catch (e) {
                  setState(() => _promoMsg = e.toString());
                }
              },
              child: const Text('Redeem promo'),
            ),
          ),
          if (_promoMsg != null)
            Text(_promoMsg!, style: MrText.sans(size: 12, color: MrColors.textSecondary)),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 24),
          MrGlowButton(label: _loading ? 'Requesting…' : 'Request Ride', fullWidth: true, onPressed: _loading ? null : _requestRide),
        ],
      ),
    );
  }
}

class _FareCard extends StatelessWidget {
  const _FareCard({required this.fare});
  final Map<String, dynamic> fare;

  @override
  Widget build(BuildContext context) {
    final carbon = fare['carbon'] as Map<String, dynamic>?;
    final co2 = (carbon?['co2_kg'] as num?)?.toDouble();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: MrColors.primary.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          _row('Distance', '${fare['distance_km']} km'),
          _row('Duration', '${fare['duration_minutes']} min'),
          _row('Base fare', 'R${(((fare['base_fare_cents'] as num?) ?? 0) / 100).toStringAsFixed(2)}'),
          if ((fare['surge_multiplier'] as num?) != null && (fare['surge_multiplier'] as num) > 1)
            _row('Surge', '${fare['surge_multiplier']}x'),
          if (co2 != null) _row('Carbon', '~${co2.toStringAsFixed(2)} kg CO₂e'),
          const Divider(),
          _row('Total', 'R${(((fare['total_cents'] as num?) ?? 0) / 100).toStringAsFixed(2)}', bold: true),
        ],
      ),
    );
  }

  Widget _row(String k, String v, {bool bold = false}) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(k, style: MrText.sans(weight: bold ? FontWeight.w700 : FontWeight.w400)),
        Text(v, style: MrText.mono(weight: bold ? FontWeight.w800 : FontWeight.w500)),
      ],
    ),
  );
}
