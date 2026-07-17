import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:my_ride/theme/brand_assets.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/utils/mr_logger.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';

/// Mirrors prototypes/showcase/index.html — lightweight hub (previews are thumbnails, not live embeds).
class HubShowcaseScreen extends StatefulWidget {
  const HubShowcaseScreen({super.key});

  @override
  State<HubShowcaseScreen> createState() => _HubShowcaseScreenState();
}

class _HubShowcaseScreenState extends State<HubShowcaseScreen> {
  @override
  void initState() {
    super.initState();
    MrLogger.hubLoaded();
  }

  @override
  Widget build(BuildContext context) {
    final display = GoogleFonts.plusJakartaSans();

    return Scaffold(
      backgroundColor: MrColors.navy,
      body: DecoratedBox(
        decoration: const BoxDecoration(gradient: MrColors.heroGradient),
        child: SafeArea(
          child: SingleChildScrollView(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 48, 24, 32),
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const MrLogo(variant: MrLogoVariant.wordmark, height: 100, maxWidth: 280),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        BrandAssets.tagline,
                        textAlign: TextAlign.center,
                        style: display.copyWith(fontSize: 15, fontStyle: FontStyle.italic, color: Colors.white70),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'My Ride Ecosystem',
                        textAlign: TextAlign.center,
                        style: display.copyWith(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Complete professional UI — Rider · Driver · Admin — with live motion, gradients, and real-time data visuals.',
                        textAlign: TextAlign.center,
                        style: display.copyWith(fontSize: 15, color: Colors.white70, height: 1.5),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 0, 24, 48),
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final w = constraints.maxWidth;
                      final isWide = w > 900;
                      return Wrap(
                        spacing: 28,
                        runSpacing: 28,
                        alignment: WrapAlignment.center,
                        children: [
                          _PreviewCard(
                            width: isWide ? (w - 28) / 2 : w,
                            label: 'Rider App',
                            title: 'Live Trip Tracking',
                            accent: MrColors.cyan,
                            icon: Icons.navigation_rounded,
                            previewLines: const ['Animated dark map', 'Live ETA · 4:32', 'Pulsing Request Ride CTA'],
                            onOpen: () => context.push('/showcase/rider'),
                          ),
                          _PreviewCard(
                            width: isWide ? (w - 28) / 2 : w,
                            label: 'Driver App',
                            title: 'Earnings & Trip Management',
                            accent: MrColors.mint,
                            icon: Icons.local_taxi_rounded,
                            previewLines: const ['Earnings ticker \$247+', 'Incoming request timer', 'Nav map animation'],
                            onOpen: () => context.push('/showcase/driver'),
                          ),
                          _PreviewCard(
                            width: w,
                            label: 'Admin Dashboard',
                            title: 'Analytics · Live Transactions · Fleet',
                            accent: MrColors.electric,
                            icon: Icons.dashboard_rounded,
                            previewLines: const ['Live KPI cards', 'Animated charts', 'Transaction + activity feed'],
                            onOpen: () => context.push('/showcase/admin'),
                            tall: true,
                          ),
                        ],
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PreviewCard extends StatefulWidget {
  const _PreviewCard({
    required this.width,
    required this.label,
    required this.title,
    required this.accent,
    required this.icon,
    required this.previewLines,
    required this.onOpen,
    this.tall = false,
  });

  final double width;
  final String label;
  final String title;
  final Color accent;
  final IconData icon;
  final List<String> previewLines;
  final VoidCallback onOpen;
  final bool tall;

  @override
  State<_PreviewCard> createState() => _PreviewCardState();
}

class _PreviewCardState extends State<_PreviewCard> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final display = GoogleFonts.plusJakartaSans();
    final previewHeight = widget.tall ? 220.0 : 180.0;

    return MouseRegion(
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutBack,
        width: widget.width,
        transform: Matrix4.translationValues(0, _hover ? -6.0 : 0.0, 0),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: widget.accent.withValues(alpha: 0.35)),
          boxShadow: _hover ? [BoxShadow(color: MrColors.electric.withValues(alpha: 0.25), blurRadius: 60, offset: const Offset(0, 20))] : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 24, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.label.toUpperCase(), style: display.copyWith(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1.2, color: widget.accent)),
                  Text(widget.title, style: display.copyWith(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white)),
                ],
              ),
            ),
            Divider(height: 1, color: Colors.white.withValues(alpha: 0.08)),
            SizedBox(
              height: previewHeight,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [MrColors.showcaseBg, MrColors.navyMid],
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Row(
                    children: [
                      Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(colors: [widget.accent, MrColors.electric]),
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Icon(widget.icon, color: Colors.white, size: 32),
                      ),
                      const SizedBox(width: 20),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: widget.previewLines
                              .map((line) => Padding(
                                    padding: const EdgeInsets.only(bottom: 6),
                                    child: Text('• $line', style: display.copyWith(fontSize: 13, color: Colors.white70, fontWeight: FontWeight.w600)),
                                  ))
                              .toList(),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: widget.onOpen,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text('Open fullscreen →', textAlign: TextAlign.center, style: display.copyWith(fontWeight: FontWeight.w700, color: MrColors.cyan)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
