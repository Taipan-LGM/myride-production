import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:my_ride/ecosystem/admin/admin_extended_panels.dart';
import 'package:my_ride/l10n/app_localizations.dart';
import 'package:my_ride/screens/settings/app_settings_screen.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/services/live_data_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/utils/mr_logger.dart';
import 'package:my_ride/widgets/motion/mr_live_badge.dart';

/// Pixel-match of prototypes/showcase/admin-live.html
class AdminLiveScreen extends StatefulWidget {
  const AdminLiveScreen({super.key, this.embed = false});

  final bool embed;

  @override
  State<AdminLiveScreen> createState() => _AdminLiveScreenState();
}

class _AdminLiveScreenState extends State<AdminLiveScreen> with TickerProviderStateMixin {
  late final List<AnimationController> _barCtrls = List.generate(
    11,
    (i) => AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..forward(),
  );
  late final AnimationController _donutCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 2))..forward();
  late final AnimationController _lineCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 3))..repeat();

  static const _barHeights = [60.0, 90, 110, 130, 140, 125, 145, 155, 135, 150, 160];
  static const _navItems = ['Dashboard', 'Live Fleet', 'Users', 'Drivers', 'Trips', 'Promotions', 'Disputes', 'Settings'];
  int _selectedNav = 0;

  @override
  void initState() {
    super.initState();
    if (!widget.embed) {
      MrLogger.screenOpen('Admin Dashboard');
      LiveDataService.instance.startAdminLive();
    }
    LiveDataService.instance.addListener(_onData);
    AppSettingsService.instance.addListener(_onData);
    for (var i = 0; i < _barCtrls.length; i++) {
      Future.delayed(Duration(milliseconds: i * 100), () {
        if (mounted) _barCtrls[i].forward();
      });
    }
  }

  void _onData() => setState(() {});

  @override
  void dispose() {
    if (!widget.embed) {
      LiveDataService.instance.stopAdminLive();
    }
    LiveDataService.instance.removeListener(_onData);
    AppSettingsService.instance.removeListener(_onData);
    for (final c in _barCtrls) {
      c.dispose();
    }
    _donutCtrl.dispose();
    _lineCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 600;
        final content = wide
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Sidebar(items: _navItems, selected: _selectedNav, onSelect: (i) => setState(() => _selectedNav = i)),
                  Expanded(child: _MainPanel(embed: widget.embed, barCtrls: _barCtrls, donutCtrl: _donutCtrl, lineCtrl: _lineCtrl, section: _navItems[_selectedNav])),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    height: 52,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      children: _navItems.asMap().entries.map((e) {
                        final active = e.key == _selectedNav;
                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: FilterChip(
                            label: Text(e.value),
                            selected: active,
                            onSelected: (_) => setState(() => _selectedNav = e.key),
                            selectedColor: MrColors.secondary.withValues(alpha: 0.2),
                            labelStyle: TextStyle(color: active ? MrColors.secondary : Colors.white70, fontWeight: FontWeight.w600),
                            backgroundColor: MrColors.primary,
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  Expanded(child: _MainPanel(embed: widget.embed, barCtrls: _barCtrls, donutCtrl: _donutCtrl, lineCtrl: _lineCtrl, section: _navItems[_selectedNav])),
                ],
              );
        if (widget.embed) return content;
        return Scaffold(backgroundColor: MrColors.showcaseBg, body: content);
      },
    );
  }
}

class _Sidebar extends StatelessWidget {
  const _Sidebar({required this.items, required this.selected, required this.onSelect});
  final List<String> items;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final inter = GoogleFonts.inter();
    return Container(
      width: 260,
      padding: const EdgeInsets.fromLTRB(20, 28, 20, 28),
      color: MrColors.primary,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('My Ride', style: inter.copyWith(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white)),
          Text(l10n.adminConsole, style: inter.copyWith(fontSize: 12, fontWeight: FontWeight.w500, color: MrColors.secondary)),
          const SizedBox(height: 32),
          ...items.asMap().entries.map((e) {
            final active = e.key == selected;
            return Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Material(
                color: active ? MrColors.secondary.withValues(alpha: 0.15) : Colors.transparent,
                borderRadius: BorderRadius.circular(8),
                child: InkWell(
                  onTap: () => onSelect(e.key),
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    child: Text(e.value, style: inter.copyWith(fontSize: 14, fontWeight: FontWeight.w600, color: active ? MrColors.secondary : Colors.white.withValues(alpha: 0.6))),
                  ),
                ),
              ),
            );
          }),
          const Spacer(),
          Row(children: [
            CircleAvatar(backgroundColor: MrColors.secondary, child: Text('JD', style: inter.copyWith(fontSize: 12, fontWeight: FontWeight.w700, color: MrColors.primary))),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('John Doe', style: inter.copyWith(fontSize: 13, fontWeight: FontWeight.w600, color: Colors.white)),
              Text('Super Admin', style: inter.copyWith(fontSize: 11, color: Colors.white54)),
            ])),
          ]),
        ],
      ),
    );
  }
}

class _MainPanel extends StatelessWidget {
  const _MainPanel({required this.embed, required this.barCtrls, required this.donutCtrl, required this.lineCtrl, required this.section});
  final bool embed;
  final List<AnimationController> barCtrls;
  final AnimationController donutCtrl;
  final AnimationController lineCtrl;
  final String section;

  @override
  Widget build(BuildContext context) {
    final jakarta = GoogleFonts.plusJakartaSans();
    final mono = GoogleFonts.jetBrainsMono();
    final l10n = AppLocalizations.of(context)!;
    final settings = AppSettingsService.instance;
    final data = LiveDataService.instance;
    final rides = data.activeRides;
    final drivers = data.driversOnline;
    final feed = data.activityFeed.isNotEmpty ? data.activityFeed : data.previewActivityFeed();

    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final panelBg = isDark ? const Color(0xFF061828) : MrColors.surfaceBackground;
    final cardBg = theme.cardTheme.color ?? (isDark ? const Color(0xFF0F3152) : Colors.white);
    final headerText = isDark ? MrColors.textInverse : MrColors.primary;

    return ColoredBox(
      color: panelBg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: cardBg,
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l10n.analyticsOverview, style: jakarta.copyWith(fontSize: 18, fontWeight: FontWeight.w700, color: headerText)),
                      Text(l10n.liveDataUpdates, style: jakarta.copyWith(fontSize: 11, color: MrColors.textSecondary)),
                    ],
                  ),
                ),
                IconButton(onPressed: () {}, icon: const Icon(Icons.notifications_none, color: MrColors.primary)),
              ],
            ),
          ),
          const Divider(height: 1, color: MrColors.mapRoadLight),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
            if (section != 'Dashboard') ...[
              _sectionPanel(section),
              const SizedBox(height: 24),
            ],
            if (section == 'Dashboard') ...[
              LayoutBuilder(
                builder: (context, c) {
                  final cols = c.maxWidth > 900 ? 4 : 2;
                  return GridView.count(
                    crossAxisCount: cols,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 20,
                    mainAxisSpacing: 20,
                    childAspectRatio: cols == 4 ? 1.85 : 1.5,
                    children: [
                      _KpiCard(label: l10n.totalRevenueToday, value: settings.formatFromUsd(24850), delta: '+12.5%', mono: mono, jakarta: jakarta),
                      _KpiCard(label: l10n.activeTrips, value: _formatNum(rides > 1200 ? rides : 1247), delta: '+5.2%', mono: mono, jakarta: jakarta),
                      _KpiCard(label: l10n.availableDrivers, value: '$drivers', delta: '-2.1%', mono: mono, jakarta: jakarta, deltaColor: MrColors.accent),
                      _KpiCard(label: l10n.avgTripRating, value: '4.82', delta: '+0.3', mono: mono, jakarta: jakarta),
                    ],
                  );
                },
              ),
              const SizedBox(height: 28),
              LayoutBuilder(
                builder: (context, c) {
                  final wide = c.maxWidth > 700;
                  if (wide) {
                    return IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(child: _ChartPanel(barCtrls: barCtrls, lineCtrl: lineCtrl)),
                          const SizedBox(width: 16),
                          Expanded(child: _FleetMapPanel(jakarta: jakarta)),
                        ],
                      ),
                    );
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _ChartPanel(barCtrls: barCtrls, lineCtrl: lineCtrl),
                      const SizedBox(height: 16),
                      _FleetMapPanel(jakarta: jakarta),
                    ],
                  );
                },
              ),
              const SizedBox(height: 28),
              _TransactionsPanel(jakarta: jakarta, mono: mono, settings: settings, title: l10n.recentTrips),
            ],
            if (section == 'Live Fleet') _FeedPanel(jakarta: jakarta, feed: feed),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

String _formatNum(int n) {
  final s = n.toString();
  if (s.length <= 3) return s;
  return '${s.substring(0, s.length - 3)},${s.substring(s.length - 3)}';
}

Widget _sectionPanel(String section) {
  return Builder(
    builder: (context) {
      final cardBg = Theme.of(context).cardTheme.color ?? Colors.white;
      return DecoratedBox(
        decoration: BoxDecoration(
          color: cardBg,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [BoxShadow(color: MrColors.navy.withValues(alpha: 0.06), blurRadius: 20)],
        ),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: switch (section) {
            'Live Fleet' => const AdminFleetPanel(),
            'Users' => const AdminUsersPanel(),
            'Disputes' => const AdminDisputesPanel(),
            'Promotions' => const AdminPromosPanel(),
            'Drivers' => const AdminOnboardingPanel(),
            'Trips' => const AdminFleetPanel(),
            'Settings' => const AdminSettingsPanel(),
            _ => const SizedBox.shrink(),
          },
        ),
      );
    },
  );
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({required this.label, required this.value, required this.delta, required this.mono, required this.jakarta, this.deltaColor = MrColors.mint});
  final String label, value, delta;
  final TextStyle mono, jakarta;
  final Color deltaColor;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final cardBg = Theme.of(context).cardTheme.color ?? Colors.white;
    final valueColor = isDark ? MrColors.textInverse : MrColors.navy;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: MrColors.navy.withValues(alpha: 0.06), blurRadius: 20)],
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: jakarta.copyWith(fontSize: 12, fontWeight: FontWeight.w600, color: MrColors.textSecondary)),
            const SizedBox(height: 8),
            Text(value, style: mono.copyWith(fontSize: 28, fontWeight: FontWeight.w800, color: valueColor)),
            const SizedBox(height: 4),
            Text(delta, style: jakarta.copyWith(fontSize: 12, fontWeight: FontWeight.w700, color: deltaColor)),
          ],
        ),
      ),
    );
  }
}

class _ChartPanel extends StatelessWidget {
  const _ChartPanel({required this.barCtrls, required this.lineCtrl});
  final List<AnimationController> barCtrls;
  final AnimationController lineCtrl;

  @override
  Widget build(BuildContext context) {
    final jakarta = GoogleFonts.plusJakartaSans();
    return _Panel(
      title: 'Revenue Trend (7 Days)',
      child: SizedBox(
        height: 200,
        child: SizedBox.expand(
          child: AnimatedBuilder(
            animation: lineCtrl,
            builder: (_, __) => CustomPaint(
              painter: _BarChartPainter(barCtrls: barCtrls, lineProgress: lineCtrl.value),
            ),
          ),
        ),
      ),
      jakarta: jakarta,
    );
  }
}

class _BarChartPainter extends CustomPainter {
  _BarChartPainter({required this.barCtrls, required this.lineProgress});
  final List<AnimationController> barCtrls;
  final double lineProgress;

  @override
  void paint(Canvas canvas, Size size) {
    const heights = _AdminLiveScreenState._barHeights;
    final barW = 36.0;
    final gap = 12.0;
    final baseY = size.height - 20;
    for (var i = 0; i < heights.length; i++) {
      final x = 40 + i * (barW + gap);
      final h = heights[i] * barCtrls[i].value;
      final rect = Rect.fromLTWH(x, baseY - h, barW, h);
      final paint = Paint()..shader = const LinearGradient(begin: Alignment.bottomCenter, end: Alignment.topCenter, colors: [MrColors.electric, MrColors.cyan]).createShader(rect);
      canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(4)), paint);
    }
    const points = [Offset(58, 150), Offset(106, 120), Offset(154, 100), Offset(202, 80), Offset(250, 70), Offset(298, 85), Offset(346, 65), Offset(394, 55), Offset(442, 75), Offset(490, 60), Offset(538, 50)];
    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (final p in points.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    final metric = path.computeMetrics().first;
    final extract = metric.extractPath(0, metric.length * lineProgress);
    canvas.drawPath(extract, Paint()
      ..color = MrColors.mint
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round);
  }

  @override
  bool shouldRepaint(covariant _BarChartPainter old) => old.lineProgress != lineProgress || true;
}

class _FleetMapPanel extends StatelessWidget {
  const _FleetMapPanel({required this.jakarta});
  final TextStyle jakarta;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      title: 'Live Fleet Map',
      jakarta: jakarta,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(width: 8, height: 8, decoration: const BoxDecoration(color: MrColors.secondary, shape: BoxShape.circle)),
            const SizedBox(width: 8),
            Text('843 drivers online', style: jakarta.copyWith(fontSize: 12)),
          ]),
          const SizedBox(height: 12),
          Container(
            height: 200,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: MrColors.mapLight, borderRadius: BorderRadius.circular(12)),
            child: Stack(
              children: [
                for (final o in [const Offset(40, 50), const Offset(100, 80), const Offset(160, 45), const Offset(90, 120), const Offset(150, 110)])
                  Positioned(left: o.dx, top: o.dy, child: Container(width: 12, height: 12, decoration: const BoxDecoration(color: MrColors.secondary, shape: BoxShape.circle))),
                const Positioned(right: 24, bottom: 40, child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.warning, color: MrColors.accent, size: 14), SizedBox(width: 4), Text('SOS', style: TextStyle(color: MrColors.accent, fontSize: 10, fontWeight: FontWeight.w600))])),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _DonutPanel extends StatelessWidget {
  const _DonutPanel({required this.ctrl});
  final AnimationController ctrl;

  @override
  Widget build(BuildContext context) {
    final jakarta = GoogleFonts.plusJakartaSans();
    final mono = GoogleFonts.jetBrainsMono();
    return _Panel(
      title: 'Driver Availability',
      jakarta: jakarta,
      child: SizedBox(
        height: 180,
        child: AnimatedBuilder(
          animation: ctrl,
          builder: (_, __) => CustomPaint(
            painter: _DonutPainter(progress: ctrl.value),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('${(80 * ctrl.value).round()}%', style: mono.copyWith(fontSize: 28, fontWeight: FontWeight.w700, color: MrColors.navy)),
                  Text('Online now', style: jakarta.copyWith(fontSize: 11, color: MrColors.textSecondary)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DonutPainter extends CustomPainter {
  _DonutPainter({required this.progress});
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    canvas.drawCircle(c, 70, Paint()
      ..color = MrColors.borderLight
      ..style = PaintingStyle.stroke
      ..strokeWidth = 16);
    canvas.drawArc(
      Rect.fromCircle(center: c, radius: 70),
      -math.pi / 2,
      2 * math.pi * 0.8 * progress,
      false,
      Paint()
        ..shader = const LinearGradient(colors: [MrColors.electric, MrColors.cyan]).createShader(Rect.fromCircle(center: c, radius: 70))
        ..style = PaintingStyle.stroke
        ..strokeWidth = 16
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(covariant _DonutPainter old) => old.progress != progress;
}

class _TransactionsPanel extends StatelessWidget {
  const _TransactionsPanel({required this.jakarta, required this.mono, required this.settings, required this.title});
  final TextStyle jakarta, mono;
  final AppSettingsService settings;
  final String title;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      title: title,
      jakarta: jakarta,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Table(
        columnWidths: const {0: FlexColumnWidth(1.2), 1: FlexColumnWidth(1), 2: FlexColumnWidth(1), 3: FlexColumnWidth(1), 4: FlexColumnWidth(0.8), 5: FlexColumnWidth(0.8)},
        children: [
          TableRow(
            decoration: const BoxDecoration(color: MrColors.neutral100, borderRadius: BorderRadius.all(Radius.circular(8))),
            children: ['TRIP ID', 'RIDER', 'DRIVER', 'STATUS', 'FARE', 'TIME'].map((h) => Padding(padding: const EdgeInsets.all(10), child: Text(h, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: MrColors.textSecondary)))).toList(),
          ),
          _txRow('#TRP-78432', 'Sarah M.', 'Mike T.', 'Completed', settings.formatFromUsd(24.50), '2 min ago', true, jakarta, mono),
          _txRow('#TRP-78431', 'James K.', 'Lisa R.', 'Ongoing', settings.formatFromUsd(18.00), '5 min ago', false, jakarta, mono, ongoing: true),
          _txRow('#TRP-78430', 'Alex P.', 'David W.', 'Cancelled', settings.formatFromUsd(0), '12 min ago', false, jakarta, mono, cancelled: true),
        ],
        ),
      ),
    );
  }

  TableRow _txRow(String id, String rider, String driver, String status, String fare, String time, bool completed, TextStyle jakarta, TextStyle mono, {bool ongoing = false, bool cancelled = false}) {
    final statusColor = ongoing ? MrColors.accent : (cancelled ? MrColors.textSecondary : MrColors.secondary);
    return TableRow(
      children: [
        Padding(padding: const EdgeInsets.all(12), child: Text(id, style: jakarta.copyWith(fontSize: 13, fontWeight: FontWeight.w500, color: MrColors.primary))),
        Padding(padding: const EdgeInsets.all(12), child: Text(rider, style: jakarta.copyWith(fontSize: 13))),
        Padding(padding: const EdgeInsets.all(12), child: Text(driver, style: jakarta.copyWith(fontSize: 13))),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(6)),
            child: Text(status, style: jakarta.copyWith(fontSize: 11, fontWeight: FontWeight.w600, color: statusColor)),
          ),
        ),
        Padding(padding: const EdgeInsets.all(12), child: Text(fare, style: mono.copyWith(fontSize: 13, fontWeight: FontWeight.w600))),
        Padding(padding: const EdgeInsets.all(12), child: Text(time, style: jakarta.copyWith(fontSize: 13, color: MrColors.textSecondary))),
      ],
    );
  }
}

class _FeedPanel extends StatelessWidget {
  const _FeedPanel({required this.jakarta, required this.feed});
  final TextStyle jakarta;
  final List<String> feed;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final titleColor = isDark ? MrColors.textInverse : MrColors.navy;
    return _Panel(
      title: 'Activity Feed',
      jakarta: jakarta,
      child: SizedBox(
        height: 280,
        child: feed.isEmpty
            ? Center(child: Text('Waiting for live events…', style: jakarta.copyWith(color: MrColors.textSecondary)))
            : ListView.builder(
                itemCount: feed.length,
                itemBuilder: (_, i) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Row(
                    children: [
                      const MrLiveBadge(),
                      const SizedBox(width: 12),
                      Expanded(child: Text(feed[i], style: jakarta.copyWith(fontSize: 13, fontWeight: FontWeight.w600, color: titleColor))),
                    ],
                  ),
                ),
              ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.title, required this.child, required this.jakarta});
  final String title;
  final Widget child;
  final TextStyle jakarta;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final cardBg = Theme.of(context).cardTheme.color ?? Colors.white;
    final titleColor = isDark ? MrColors.textInverse : MrColors.navy;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [BoxShadow(color: MrColors.navy.withValues(alpha: 0.06), blurRadius: 20)],
      ),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: jakarta.copyWith(fontSize: 16, fontWeight: FontWeight.w800, color: titleColor)),
            const SizedBox(height: 20),
            child,
          ],
        ),
      ),
    );
  }
}
