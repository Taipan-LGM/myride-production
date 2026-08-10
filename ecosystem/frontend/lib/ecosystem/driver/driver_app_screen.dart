import 'package:flutter/material.dart';
import 'package:my_ride/l10n/app_localizations.dart';
import 'package:my_ride/models/api_models.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/services/live_data_service.dart';
import 'package:my_ride/services/trip_session_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/theme/mr_text.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';

class DriverAppScreen extends StatefulWidget {
  const DriverAppScreen({super.key});

  @override
  State<DriverAppScreen> createState() => _DriverAppScreenState();
}

class _DriverAppScreenState extends State<DriverAppScreen> with SingleTickerProviderStateMixin {
  int _tab = 0;
  bool _online = true;
  bool _requestVisible = true;
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();

  @override
  void initState() {
    super.initState();
    LiveDataService.instance.addListener(_onData);
    AppSettingsService.instance.addListener(_onData);
    TripSessionService.instance.addListener(_onData);
    TripSessionService.instance.driverSetOnline(_online);
  }

  void _onData() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    LiveDataService.instance.removeListener(_onData);
    AppSettingsService.instance.removeListener(_onData);
    TripSessionService.instance.removeListener(_onData);
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = TripSessionService.instance;
    final trip = session.activeTrip;
    final hasRequest = trip != null &&
        (trip.status == TripStatus.driverArriving ||
            trip.status == TripStatus.driverAssigned ||
            trip.status == TripStatus.requested);

    return ColoredBox(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: Column(
        children: [
          _DriverHeader(
            online: _online,
            onToggle: (v) {
              setState(() => _online = v);
              TripSessionService.instance.driverSetOnline(v);
            },
          ),
          Expanded(
            child: IndexedStack(
              index: _tab,
              children: [
                _HomeTab(
                  online: _online,
                  requestVisible: _requestVisible && hasRequest,
                  trip: trip,
                  pulse: _pulse,
                  isLoading: session.isLoading,
                  onAccept: () async {
                    final accepted = await TripSessionService.instance.driverAcceptTrip();
                    if (accepted != null && mounted) setState(() => _requestVisible = false);
                  },
                  onDecline: () => setState(() => _requestVisible = false),
                ),
                const _EarningsTab(),
                const _ProfileTab(),
              ],
            ),
          ),
          _DriverBottomNav(index: _tab, onChanged: (i) => setState(() => _tab = i)),
        ],
      ),
    );
  }
}

class _DriverHeader extends StatelessWidget {
  const _DriverHeader({required this.online, required this.onToggle});
  final bool online;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final settings = AppSettingsService.instance;
    final earnings = LiveDataService.instance.driverEarnings;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      color: MrColors.primary,
      child: SafeArea(
        bottom: false,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.todayEarnings, style: MrText.sans(size: 13, color: Colors.white70)),
                  TweenAnimationBuilder<double>(
                    key: ValueKey(earnings),
                    tween: Tween(begin: (earnings - 1).clamp(0, 99999).toDouble(), end: earnings.toDouble()),
                    duration: const Duration(milliseconds: 500),
                    curve: Curves.easeOutCubic,
                    builder: (_, value, __) => Text(
                      settings.formatFromUsd(value),
                      style: MrText.mono(size: 36, weight: FontWeight.w700, color: MrColors.secondary),
                    ),
                  ),
                  Text('8 trips · 4h 12m online', style: MrText.sans(size: 12, color: Colors.white60)),
                ],
              ),
            ),
            _OnlineToggle(online: online, onChanged: onToggle),
          ],
        ),
      ),
    );
  }
}

class _OnlineToggle extends StatelessWidget {
  const _OnlineToggle({required this.online, required this.onChanged});
  final bool online;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => onChanged(!online),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 80,
        height: 36,
        padding: const EdgeInsets.symmetric(horizontal: 6),
        decoration: BoxDecoration(color: online ? MrColors.secondary : Colors.white24, borderRadius: BorderRadius.circular(18)),
        child: Stack(
          children: [
            if (online)
              Align(alignment: Alignment.centerLeft, child: Padding(padding: const EdgeInsets.only(left: 8), child: Text('ONLINE', style: MrText.sans(size: 10, weight: FontWeight.w700, color: MrColors.primary)))),
            AnimatedAlign(
              duration: const Duration(milliseconds: 200),
              alignment: online ? Alignment.centerRight : Alignment.centerLeft,
              child: Container(width: 28, height: 28, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle)),
            ),
          ],
        ),
      ),
    );
  }
}

class _HomeTab extends StatelessWidget {
  const _HomeTab({
    required this.online,
    required this.requestVisible,
    required this.trip,
    required this.pulse,
    required this.isLoading,
    required this.onAccept,
    required this.onDecline,
  });
  final bool online;
  final bool requestVisible;
  final Trip? trip;
  final AnimationController pulse;
  final bool isLoading;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final settings = AppSettingsService.instance;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 16, 12, 16),
      children: [
        if (requestVisible && online)
          _TripRequestCard(
            pulse: pulse,
            trip: trip,
            isLoading: isLoading,
            onAccept: onAccept,
            onDecline: onDecline,
          ),
        const SizedBox(height: 16),
        Text('Earnings Breakdown', style: MrText.sans(size: 16, weight: FontWeight.w700, color: MrColors.primary)),
        const SizedBox(height: 12),
        _BreakdownRow(icon: '+', iconColor: MrColors.secondary, title: l10n.tripFares, subtitle: '8 completed trips', amount: settings.formatFromUsd(132.00)),
        const SizedBox(height: 8),
        _BreakdownRow(icon: '★', iconColor: MrColors.accent, title: l10n.tips, subtitle: 'From 3 customers', amount: settings.formatFromUsd(15.50)),
        const SizedBox(height: 20),
        _HeatmapCard(),
      ],
    );
  }
}

class _TripRequestCard extends StatefulWidget {
  const _TripRequestCard({
    required this.pulse,
    required this.trip,
    required this.isLoading,
    required this.onAccept,
    required this.onDecline,
  });
  final AnimationController pulse;
  final Trip? trip;
  final bool isLoading;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  @override
  State<_TripRequestCard> createState() => _TripRequestCardState();
}

class _TripRequestCardState extends State<_TripRequestCard> with SingleTickerProviderStateMixin {
  late final AnimationController _countdown = AnimationController(vsync: this, duration: const Duration(seconds: 12))..forward();

  @override
  void dispose() {
    _countdown.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = AppSettingsService.instance;
    final trip = widget.trip;
    final pickup = trip?.pickupAddress ?? 'Cape Town CBD';
    final dropoff = trip?.dropoffAddress ?? 'V&A Waterfront';
    final fare = trip?.fareEstimate != null ? settings.formatFromUsd(trip!.fareEstimate!) : settings.formatFromUsd(14.75);
    final secs = ((1 - _countdown.value) * 12).ceil();
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), boxShadow: MrElevation.card),
      child: Column(
        children: [
          AnimatedBuilder(
            animation: widget.pulse,
            builder: (_, __) {
              final r = 20.0 + widget.pulse.value * 8;
              return Stack(
                alignment: Alignment.center,
                children: [
                  Container(width: r * 2, height: r * 2, decoration: BoxDecoration(shape: BoxShape.circle, color: MrColors.secondary.withValues(alpha: 0.2 * (1 - widget.pulse.value)))),
                  Container(width: 16, height: 16, decoration: const BoxDecoration(color: MrColors.secondary, shape: BoxShape.circle)),
                ],
              );
            },
          ),
          const SizedBox(height: 8),
          Text('New Trip Request', style: MrText.sans(size: 14, weight: FontWeight.w600, color: MrColors.primary)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: MrColors.neutral100, borderRadius: BorderRadius.circular(12)),
            child: Column(
              children: [
                _RouteLine(color: MrColors.secondary, label: pickup, trailing: '2.4 mi'),
                const SizedBox(height: 12),
                _RouteLine(color: MrColors.accent, label: dropoff, trailing: fare),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: widget.onDecline,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 44),
                    backgroundColor: MrColors.accent.withValues(alpha: 0.1),
                    side: BorderSide.none,
                    foregroundColor: MrColors.accent,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text('Decline', style: MrText.sans(weight: FontWeight.w600)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(child: MrGlowButton(label: widget.isLoading ? 'Accepting…' : 'Accept (${secs}s)', onPressed: widget.isLoading ? null : widget.onAccept, fontSize: 14)),
            ],
          ),
        ],
      ),
    );
  }
}

class _RouteLine extends StatelessWidget {
  const _RouteLine({required this.color, required this.label, required this.trailing});
  final Color color;
  final String label;
  final String trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(width: 12, height: 12, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 12),
        Expanded(child: Text(label, style: MrText.sans(size: 12, weight: FontWeight.w500))),
        Text(trailing, style: MrText.sans(size: 14, weight: FontWeight.w700, color: MrColors.primary)),
      ],
    );
  }
}

class _BreakdownRow extends StatelessWidget {
  const _BreakdownRow({required this.icon, required this.iconColor, required this.title, required this.subtitle, required this.amount});
  final String icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final String amount;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: MrElevation.card),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: iconColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
            child: Text(icon, style: TextStyle(color: iconColor, fontSize: 16, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: MrText.sans(size: 14, weight: FontWeight.w600)),
            Text(subtitle, style: MrText.sans(size: 12, color: MrColors.textSecondary)),
          ])),
          Text(amount, style: MrText.mono(size: 16, weight: FontWeight.w700, color: MrColors.primary)),
        ],
      ),
    );
  }
}

class _HeatmapCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: MrElevation.card),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Demand Heatmap', style: MrText.sans(size: 14, weight: FontWeight.w600, color: MrColors.primary)),
          const SizedBox(height: 12),
          Row(
            children: [
              _heatCell(0.2, 'Low'),
              const SizedBox(width: 10),
              _heatCell(0.5, ''),
              const SizedBox(width: 10),
              _heatCell(1.0, 'High', lightText: true),
            ],
          ),
          const SizedBox(height: 12),
          Text('Downtown showing high demand. Head there for +1.5x boost.', style: MrText.sans(size: 12, color: MrColors.textSecondary)),
        ],
      ),
    );
  }

  Widget _heatCell(double opacity, String label, {bool lightText = false}) {
    return Expanded(
      child: Container(
        height: 24,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: MrColors.secondary.withValues(alpha: opacity), borderRadius: BorderRadius.circular(4)),
        child: Text(label, style: MrText.sans(size: 10, color: lightText ? Colors.white : MrColors.primary)),
      ),
    );
  }
}

class _EarningsTab extends StatelessWidget {
  const _EarningsTab();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Weekly Summary', style: MrText.sans(size: 24, weight: FontWeight.w700, color: MrColors.primary)),
        const SizedBox(height: 16),
        ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                SizedBox(width: 36, child: Text(d, style: MrText.sans(size: 12))),
                Expanded(child: LinearProgressIndicator(value: 0.3 + d.hashCode % 5 * 0.12, minHeight: 8, borderRadius: BorderRadius.circular(4), backgroundColor: MrColors.mapRoadLight, color: MrColors.secondary)),
              ]),
            )),
      ],
    );
  }
}

class _ProfileTab extends StatelessWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Documents', style: MrText.sans(size: 24, weight: FontWeight.w700, color: MrColors.primary)),
        const SizedBox(height: 12),
        _docRow('Driver license', 'Verified'),
        _docRow('Vehicle registration', 'Verified'),
        _docRow('Background check', 'Upload required', pending: true),
      ],
    );
  }

  Widget _docRow(String name, String status, {bool pending = false}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), boxShadow: MrElevation.card),
      child: Row(children: [
        Icon(pending ? Icons.upload_file : Icons.description, color: MrColors.secondary),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(name, style: MrText.sans(weight: FontWeight.w600)), Text(status, style: MrText.sans(size: 12, color: MrColors.textSecondary))])),
      ]),
    );
  }
}

class _DriverBottomNav extends StatelessWidget {
  const _DriverBottomNav({required this.index, required this.onChanged});
  final int index;
  final ValueChanged<int> onChanged;
  static const _labels = ['Home', 'Earnings', 'Profile'];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: MrColors.mapRoadLight))),
      padding: const EdgeInsets.fromLTRB(0, 8, 0, 4),
      child: SafeArea(
        top: false,
        child: Row(
          children: List.generate(_labels.length, (i) {
            final selected = i == index;
            return Expanded(
              child: InkWell(
                onTap: () => onChanged(i),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (selected) Container(width: 8, height: 8, margin: const EdgeInsets.only(bottom: 4), decoration: const BoxDecoration(color: MrColors.secondary, shape: BoxShape.circle)),
                    if (!selected) const SizedBox(height: 12),
                    Text(_labels[i], style: MrText.sans(size: 11, weight: selected ? FontWeight.w600 : FontWeight.w500, color: selected ? MrColors.secondary : MrColors.textSecondary)),
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}
