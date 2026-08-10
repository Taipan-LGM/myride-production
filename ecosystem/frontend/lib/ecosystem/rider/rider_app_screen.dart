import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:my_ride/core/api/api_client.dart';
import 'package:my_ride/l10n/app_localizations.dart';
import 'package:my_ride/models/ride_models.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/services/fare_service.dart';
import 'package:my_ride/services/live_data_service.dart';
import 'package:my_ride/services/trip_session_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/widgets/motion/mr_animated_map.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';
import 'package:my_ride/widgets/motion/mr_live_badge.dart';
import 'package:url_launcher/url_launcher.dart';

class RiderAppScreen extends StatefulWidget {
  const RiderAppScreen({super.key});

  @override
  State<RiderAppScreen> createState() => _RiderAppScreenState();
}

class _RiderAppScreenState extends State<RiderAppScreen> with TickerProviderStateMixin {
  bool _tracking = false;
  bool _splitFare = false;
  late final AnimationController _progressCtrl = AnimationController(vsync: this, duration: MrMotion.progressFill)..repeat(reverse: true);
  late final AnimationController _etaPulseCtrl = AnimationController(vsync: this, duration: MrMotion.etaPulse)..repeat(reverse: true);

  @override
  void initState() {
    super.initState();
    LiveDataService.instance.addListener(_onData);
    FareService.instance.addListener(_onData);
    AppSettingsService.instance.addListener(_onData);
    TripSessionService.instance.addListener(_onData);
    FareService.instance.selectTier(RideTier.economy);
    FareService.instance.lockFare();
  }

  void _onData() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    LiveDataService.instance.removeListener(_onData);
    FareService.instance.removeListener(_onData);
    AppSettingsService.instance.removeListener(_onData);
    TripSessionService.instance.removeListener(_onData);
    _progressCtrl.dispose();
    _etaPulseCtrl.dispose();
    super.dispose();
  }

  Future<void> _confirmRide() async {
    final session = TripSessionService.instance;
    final tier = FareService.instance.tier;
    final trip = await session.bookRide(tier: tier);
    if (!mounted) return;
    if (trip != null) {
      setState(() => _tracking = true);
    } else if (session.error != null) {
      final err = session.error!;
      final needAuth = err.toLowerCase().contains('sign in');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err),
          action: needAuth
              ? SnackBarAction(
                  label: 'Sign in',
                  onPressed: () => context.go('/rider/login'),
                )
              : null,
        ),
      );
    }
  }

  Future<void> _postSos(String? tripId) async {
    try {
      await ApiClient().postJson('/safety/sos', {
        if (tripId != null) 'trip_id': tripId,
        'note': 'Flutter SOS',
      });
    } catch (_) {
      // Still show dial UI even if API unreachable
    }
  }

  void _triggerSos() {
    final tripId = TripSessionService.instance.activeTrip?.id;
    unawaited(_postSos(tripId));
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: MrColors.primary,
        title: Text('SOS activated', style: MrText.sans(color: Colors.white, weight: FontWeight.w700)),
        content: Text(
          'Call 112 now. My Ride safety ops notified. Live trip context shared when available.',
          style: MrText.body(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () async {
              final uri = Uri.parse('tel:112');
              if (await canLaunchUrl(uri)) {
                await launchUrl(uri);
              }
            },
            child: const Text('Call 112', style: TextStyle(color: Colors.white)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('OK', style: TextStyle(color: Colors.white70)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_tracking) {
      return _RiderTracking(
        progressCtrl: _progressCtrl,
        etaPulseCtrl: _etaPulseCtrl,
        splitFare: _splitFare,
        onSplit: () => setState(() => _splitFare = !_splitFare),
        onSos: _triggerSos,
        onBack: () => setState(() => _tracking = false),
      );
    }
    return _RiderHome(onConfirm: _confirmRide, onSos: _triggerSos, isBooking: TripSessionService.instance.isLoading);
  }
}

class _RiderHome extends StatelessWidget {
  const _RiderHome({required this.onConfirm, required this.onSos, required this.isBooking});
  final Future<void> Function() onConfirm;
  final VoidCallback onSos;
  final bool isBooking;

  @override
  Widget build(BuildContext context) {
    final fare = FareService.instance;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return ColoredBox(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: Stack(
        fit: StackFit.expand,
        children: [
          MrAnimatedRiderMap(showVehiclePins: true, lightMode: !isDark),
          Positioned(top: 12, left: 20, right: 20, child: _SearchBar()),
          Positioned(top: 84, right: 20, child: _QuickActions()),
          Positioned(top: 84, left: 20, child: _SosFab(onPressed: onSos)),
          Positioned(left: 0, right: 0, bottom: 0, child: _BookingSheet(fare: fare, onConfirm: onConfirm, isBooking: isBooking)),
        ],
      ),
    );
  }
}

class _SearchBar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      height: 56,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: MrElevation.card,
      ),
      child: Row(
        children: [
          Container(width: 16, height: 16, decoration: const BoxDecoration(color: MrColors.secondary, shape: BoxShape.circle)),
          const SizedBox(width: 12),
          Expanded(child: Text(l10n.whereTo, style: MrText.sans(size: 15, weight: FontWeight.w500))),
          Container(
            width: 48,
            height: 24,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: MrColors.neutral100, borderRadius: BorderRadius.circular(12)),
            child: Text('+', style: MrText.sans(size: 16, weight: FontWeight.w600, color: MrColors.primary)),
          ),
        ],
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _ActionChip(
          icon: Icons.my_location,
          label: 'Current',
          onTap: () => context.push('/rider/request', extra: 'Current location'),
        ),
        const SizedBox(height: 8),
        _ActionChip(icon: Icons.chat_bubble_outline, label: 'Chat', onTap: () => context.push('/chat')),
        const SizedBox(height: 8),
        _ActionChip(icon: Icons.mic_none, label: 'Voice', onTap: () => context.push('/voice')),
        const SizedBox(height: 8),
        _ActionChip(icon: Icons.chat, label: 'WhatsApp', onTap: () => context.push('/chat')),
      ],
    );
  }
}

class _ActionChip extends StatelessWidget {
  const _ActionChip({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      elevation: 2,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 16, color: MrColors.primary),
              const SizedBox(width: 4),
              Text(label, style: MrText.sans(size: 11, weight: FontWeight.w600)),
            ],
          ),
        ),
      ),
    );
  }
}

class _SosFab extends StatelessWidget {
  const _SosFab({required this.onPressed});
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: MrColors.accent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onPressed,
        customBorder: const CircleBorder(),
        child: const SizedBox(width: 40, height: 40, child: Center(child: Text('SOS', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700)))),
      ),
    );
  }
}

class _BookingSheet extends StatelessWidget {
  const _BookingSheet({required this.fare, required this.onConfirm, required this.isBooking});
  final FareService fare;
  final Future<void> Function() onConfirm;
  final bool isBooking;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final sheetColor = Theme.of(context).cardTheme.color ?? Colors.white;
    return Container(
      decoration: BoxDecoration(
        color: sheetColor,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [BoxShadow(color: Color(0x140A2540), offset: Offset(0, -4), blurRadius: 24)],
      ),
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 26, height: 4, margin: const EdgeInsets.only(bottom: 16), decoration: BoxDecoration(color: MrColors.mapRoadLight, borderRadius: BorderRadius.circular(2))),
            SizedBox(
              height: 100,
              child: Row(
                children: RideTier.values.map((t) {
                  final selected = fare.tier == t;
                  return Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: _TierCard(tier: t, selected: selected, onTap: () => fare.selectTier(t)),
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 16),
            Container(
              height: 48,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(color: MrColors.primary.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(12)),
              child: Row(
                children: [
                  Container(width: 20, height: 20, decoration: const BoxDecoration(color: Color(0xFF635BFF), shape: BoxShape.circle)),
                  const SizedBox(width: 12),
                  Text('Visa •••• 4242', style: MrText.sans(size: 13, weight: FontWeight.w500)),
                  const Spacer(),
                  Text('Switch', style: MrText.sans(size: 12, weight: FontWeight.w600, color: MrColors.secondary)),
                ],
              ),
            ),
            const SizedBox(height: 12),
            MrGlowButton(
              label: isBooking ? 'Booking…' : l10n.confirmRide,
              fullWidth: true,
              onPressed: isBooking ? null : () => onConfirm(),
            ),
          ],
        ),
      ),
    );
  }
}

class _TierCard extends StatelessWidget {
  const _TierCard({required this.tier, required this.selected, required this.onTap});
  final RideTier tier;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final lang = AppSettingsService.instance.locale.languageCode;
    return Material(
      color: MrColors.neutral100,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: selected ? MrColors.secondary : Colors.transparent, width: 2),
          ),
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(tier.labelFor(lang), style: MrText.sans(size: 12, weight: FontWeight.w600, color: MrColors.primary)),
              const SizedBox(height: 4),
              Text('${tier.eta} away', style: MrText.sans(size: 10, color: MrColors.textSecondary)),
              const Spacer(),
              Text(tier.fareFormatted, style: MrText.mono(size: 16, weight: FontWeight.w700, color: MrColors.primary)),
            ],
          ),
        ),
      ),
    );
  }
}

class _RiderTracking extends StatelessWidget {
  const _RiderTracking({required this.progressCtrl, required this.etaPulseCtrl, required this.splitFare, required this.onSplit, required this.onSos, required this.onBack});
  final AnimationController progressCtrl;
  final AnimationController etaPulseCtrl;
  final bool splitFare;
  final VoidCallback onSplit;
  final VoidCallback onSos;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final session = TripSessionService.instance;
    final trip = session.activeTrip;
    final driver = session.assignedDriver;
    final eta = LiveDataService.instance.etaFormatted;
    final settings = AppSettingsService.instance;
    final splitAmount = settings.formatFromUsd(6.25);
    final statusLabel = trip?.status.label.toUpperCase() ?? 'DRIVER ARRIVING';
    final driverName = driver?.name ?? 'James O.';
    final vehicleLabel = driver?.vehicleLabel ?? 'Toyota Camry';
    final rating = driver?.rating.toStringAsFixed(2) ?? '4.97';
    return Stack(
      fit: StackFit.expand,
      children: [
        const MrAnimatedRiderMap(showVehiclePins: true, lightMode: true),
        Positioned(top: 8, left: 8, child: IconButton(onPressed: onBack, icon: const Icon(Icons.arrow_back, color: MrColors.primary))),
        Positioned(top: 12, right: 16, child: _SosFab(onPressed: onSos)),
        SafeArea(
          child: Column(
            children: [
              const SizedBox(height: 48),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: MrElevation.card),
                child: AnimatedBuilder(
                  animation: etaPulseCtrl,
                  builder: (_, __) => Column(children: [
                    Text(statusLabel, style: MrText.sans(size: 11, color: MrColors.textSecondary, letterSpacing: 1.1)),
                    Text(eta, style: MrText.mono(size: 32, weight: FontWeight.w800, color: Color.lerp(MrColors.secondary, MrColors.primary, etaPulseCtrl.value))),
                  ]),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
                child: AnimatedBuilder(
                  animation: progressCtrl,
                  builder: (_, __) => ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(value: 0.12 + progressCtrl.value * 0.66, minHeight: 6, backgroundColor: MrColors.mapRoadLight, color: MrColors.secondary),
                  ),
                ),
              ),
              const Spacer(),
              Container(
                margin: const EdgeInsets.all(16),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), boxShadow: MrElevation.card),
                child: Column(
                  children: [
                    Row(children: [
                      Container(width: 52, height: 52, decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), color: MrColors.secondary)),
                      const SizedBox(width: 14),
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [Text(driverName, style: MrText.sans(size: 17, weight: FontWeight.w700)), const SizedBox(width: 8), const MrLiveBadge()]),
                        Text('$vehicleLabel · $rating ★', style: MrText.sans(size: 13, color: MrColors.textSecondary)),
                      ])),
                      IconButton(onPressed: () {}, icon: const Icon(Icons.phone, color: MrColors.secondary)),
                    ]),
                    const Divider(height: 20),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text('Split fare', style: MrText.sans(weight: FontWeight.w600)),
                      subtitle: Text(splitFare ? '$splitAmount each · 1 invite sent' : 'Share cost via link', style: MrText.sans(size: 12, color: MrColors.textSecondary)),
                      value: splitFare,
                      activeThumbColor: MrColors.secondary,
                      onChanged: (_) => onSplit(),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
