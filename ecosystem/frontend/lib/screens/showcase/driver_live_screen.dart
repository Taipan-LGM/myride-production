import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:my_ride/widgets/motion/mr_phone_frame.dart';
import 'package:my_ride/services/live_data_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/utils/mr_logger.dart';
import 'package:my_ride/widgets/motion/mr_animated_map.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';
import 'package:my_ride/widgets/motion/mr_live_badge.dart';

/// Pixel-match of prototypes/showcase/driver-live.html
class DriverLiveScreen extends StatefulWidget {
  const DriverLiveScreen({super.key, this.embed = false});

  final bool embed;

  @override
  State<DriverLiveScreen> createState() => _DriverLiveScreenState();
}

class _DriverLiveScreenState extends State<DriverLiveScreen> with TickerProviderStateMixin {
  late final AnimationController _slideCtrl = AnimationController(vsync: this, duration: MrMotion.slideUp)..forward();
  late final AnimationController _timerCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 28))..repeat();

  @override
  void initState() {
    super.initState();
    if (!widget.embed) {
      MrLogger.screenOpen('Driver Live');
      LiveDataService.instance.startDriverLive();
      LiveDataService.instance.addListener(_onData);
      MrLogger.driverRequest(timer: '0:28');
    }
    _slideCtrl.forward();
  }

  void _onData() => setState(() {});

  @override
  void dispose() {
    if (!widget.embed) {
      LiveDataService.instance.stopDriverLive();
      LiveDataService.instance.removeListener(_onData);
    }
    _slideCtrl.dispose();
    _timerCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final screen = MrPhoneFrame(
      child: DecoratedBox(
        decoration: const BoxDecoration(gradient: MrColors.driverScreenGradient),
        child: _buildContent(),
      ),
    );
    if (widget.embed) return screen;
    return Scaffold(backgroundColor: MrColors.showcaseBg, body: Center(child: screen));
  }

  Widget _buildContent() {
    final jakarta = GoogleFonts.plusJakartaSans();
    final mono = GoogleFonts.jetBrainsMono();
    final earnings = widget.embed ? 247 : LiveDataService.instance.driverEarnings;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 52, 20, 16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text("TODAY'S EARNINGS", style: jakarta.copyWith(fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 1.4, color: Colors.white.withValues(alpha: 0.5))),
                    const SizedBox(height: 4),
                    RichText(
                      text: TextSpan(
                        style: mono.copyWith(fontSize: 42, fontWeight: FontWeight.w800, color: Colors.white, height: 1),
                        children: [
                          TextSpan(text: '\$$earnings'),
                          TextSpan(text: '.83', style: mono.copyWith(fontSize: 24, color: MrColors.mint)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text('↑ \$32.50 since last trip', style: jakarta.copyWith(fontSize: 13, fontWeight: FontWeight.w600, color: MrColors.mint)),
                  ],
                ),
              ),
              const MrLiveBadge(label: 'Online'),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(16)),
            child: Row(
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: MrColors.mint,
                      borderRadius: BorderRadius.circular(12),
                      boxShadow: [BoxShadow(color: MrColors.mint.withValues(alpha: 0.4), blurRadius: 20)],
                    ),
                    child: Text('● Online', style: jakarta.copyWith(fontSize: 14, fontWeight: FontWeight.w700, color: MrColors.navy)),
                  ),
                ),
                Expanded(
                  child: Text('Offline', textAlign: TextAlign.center, style: jakarta.copyWith(fontSize: 14, fontWeight: FontWeight.w700, color: Colors.white.withValues(alpha: 0.5))),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        SlideTransition(
          position: Tween<Offset>(begin: const Offset(0, 0.06), end: Offset.zero).animate(CurvedAnimation(parent: _slideCtrl, curve: Curves.decelerate)),
          child: FadeTransition(
            opacity: _slideCtrl,
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 20),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: MrColors.accent.withValues(alpha: 0.8)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('NEW REQUEST · 0:28', style: jakarta.copyWith(fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1.1, color: MrColors.accent)),
                      SizedBox(
                        width: 48,
                        height: 48,
                        child: AnimatedBuilder(
                          animation: _timerCtrl,
                          builder: (_, __) => CustomPaint(
                            painter: _CountdownRingPainter(progress: 1 - _timerCtrl.value),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text('Central Station → Airport T2', style: jakarta.copyWith(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white)),
                  const SizedBox(height: 4),
                  Text('6.2 mi · 18 min · \$18.40 fare', style: jakarta.copyWith(fontSize: 13, color: Colors.white.withValues(alpha: 0.55))),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () {},
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            side: BorderSide(color: Colors.white.withValues(alpha: 0.2), width: 2),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            foregroundColor: Colors.white,
                          ),
                          child: Text('Decline', style: jakarta.copyWith(fontWeight: FontWeight.w700)),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(flex: 12, child: MrGlowButton(label: 'Accept', padding: const EdgeInsets.symmetric(vertical: 16), fontSize: 14)),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: const MrAnimatedDriverNavMap(),
            ),
          ),
        ),
        ColoredBox(
          color: Colors.black.withValues(alpha: 0.3),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(0, 12, 0, 28),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Text('Trips', style: jakarta.copyWith(fontSize: 11, fontWeight: FontWeight.w700, color: MrColors.cyan)),
                Text('Earnings', style: jakarta.copyWith(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.4))),
                Text('Profile', style: jakarta.copyWith(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.4))),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _CountdownRingPainter extends CustomPainter {
  _CountdownRingPainter({required this.progress});
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    canvas.drawCircle(c, 20, Paint()
      ..color = MrColors.accent.withValues(alpha: 0.3)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4);
    canvas.drawArc(
      Rect.fromCircle(center: c, radius: 20),
      -1.5708,
      6.28318 * progress,
      false,
      Paint()
        ..color = MrColors.accent
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(covariant _CountdownRingPainter old) => old.progress != progress;
}
