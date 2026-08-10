import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:my_ride/services/live_data_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/utils/mr_logger.dart';
import 'package:my_ride/widgets/motion/mr_phone_frame.dart';
import 'package:my_ride/widgets/motion/mr_animated_map.dart';
import 'package:my_ride/widgets/motion/mr_glass_card.dart';
import 'package:my_ride/widgets/motion/mr_glow_button.dart';
import 'package:my_ride/widgets/motion/mr_live_badge.dart';

/// Pixel-match of prototypes/showcase/rider-live.html
class RiderLiveScreen extends StatefulWidget {
  const RiderLiveScreen({super.key, this.embed = false});

  final bool embed;

  @override
  State<RiderLiveScreen> createState() => _RiderLiveScreenState();
}

class _RiderLiveScreenState extends State<RiderLiveScreen> with TickerProviderStateMixin {
  late final AnimationController _slideCtrl = AnimationController(vsync: this, duration: MrMotion.slideUp);
  late final AnimationController _sheetCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 600));
  late final AnimationController _progressCtrl = AnimationController(vsync: this, duration: MrMotion.progressFill)..repeat(reverse: true);
  late final AnimationController _etaPulseCtrl = AnimationController(vsync: this, duration: MrMotion.etaPulse)..repeat(reverse: true);
  late final Animation<Offset> _slideAnim = Tween<Offset>(begin: const Offset(0, 0.08), end: Offset.zero).animate(CurvedAnimation(parent: _slideCtrl, curve: Curves.decelerate));
  late final Animation<Offset> _sheetAnim = Tween<Offset>(begin: const Offset(0, 0.12), end: Offset.zero).animate(CurvedAnimation(parent: _sheetCtrl, curve: Curves.decelerate));

  @override
  void initState() {
    super.initState();
    if (!widget.embed) {
      MrLogger.screenOpen('Rider Live Trip');
      LiveDataService.instance.startRiderLive();
      LiveDataService.instance.addListener(_onData);
    }
    _slideCtrl.forward();
    Future.delayed(const Duration(milliseconds: 150), () => _sheetCtrl.forward());
  }

  void _onData() => setState(() {});

  @override
  void dispose() {
    if (!widget.embed) {
      LiveDataService.instance.stopRiderLive();
      LiveDataService.instance.removeListener(_onData);
    }
    _slideCtrl.dispose();
    _sheetCtrl.dispose();
    _progressCtrl.dispose();
    _etaPulseCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final body = MrPhoneFrame(child: _buildScreen());
    if (widget.embed) return body;
    return Scaffold(backgroundColor: MrColors.showcaseBg, body: Center(child: body));
  }

  Widget _buildScreen() {
    final jakarta = GoogleFonts.plusJakartaSans();
    final mono = GoogleFonts.jetBrainsMono();
    final etaColor = Color.lerp(MrColors.cyan, Colors.white, _etaPulseCtrl.value)!;

    return Stack(
      fit: StackFit.expand,
      children: [
        const MrAnimatedRiderMap(),
        Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 52, 20, 12),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: MrColors.ctaGradient,
                      border: Border.all(color: Colors.white.withValues(alpha: 0.3), width: 2),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: SlideTransition(
                      position: _slideAnim,
                      child: FadeTransition(
                        opacity: _slideCtrl,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.95),
                            borderRadius: BorderRadius.circular(14),
                            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.2), blurRadius: 20)],
                          ),
                          child: Text('📍 Central Station → Airport Terminal 2', style: jakarta.copyWith(fontSize: 14, fontWeight: FontWeight.w600, color: MrColors.textPrimary)),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Text('🔔', style: TextStyle(fontSize: 20)),
                ],
              ),
            ),
          ],
        ),
        Positioned(
          top: 140,
          left: 0,
          right: 0,
          child: Center(
            child: MrGlassCard(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
              child: Column(
                children: [
                  Text('ARRIVING IN', style: jakarta.copyWith(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: MrColors.textSecondary)),
                  AnimatedBuilder(
                    animation: _etaPulseCtrl,
                    builder: (_, __) => Text(
                      widget.embed ? '4:32' : LiveDataService.instance.etaFormatted,
                      style: mono.copyWith(fontSize: 32, fontWeight: FontWeight.w800, color: etaColor, shadows: [if (_etaPulseCtrl.value > 0.5) Shadow(color: MrColors.cyan.withValues(alpha: 0.8), blurRadius: 12)]),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        Positioned(
          top: 220,
          left: 24,
          right: 24,
          child: Column(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: SizedBox(
                  height: 6,
                  child: AnimatedBuilder(
                    animation: _progressCtrl,
                    builder: (_, __) => Align(
                      alignment: Alignment.centerLeft,
                      child: FractionallySizedBox(
                        widthFactor: 0.12 + _progressCtrl.value * 0.66,
                        child: DecoratedBox(
                          decoration: const BoxDecoration(gradient: MrColors.ctaGradient),
                          child: const SizedBox(height: 6),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Picked up', style: jakarta.copyWith(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.6))),
                  Text('En route', style: jakarta.copyWith(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.6))),
                  Text('Drop-off', style: jakarta.copyWith(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white.withValues(alpha: 0.6))),
                ],
              ),
            ],
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 36,
          child: SlideTransition(
            position: _sheetAnim,
            child: FadeTransition(
              opacity: _sheetCtrl,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: MrGlassCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 52,
                            height: 52,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), gradient: MrColors.ctaGradient),
                            child: const Text('🚗', style: TextStyle(fontSize: 24)),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text('James O.', style: jakarta.copyWith(fontSize: 17, fontWeight: FontWeight.w800)),
                                    const SizedBox(width: 8),
                                    const MrLiveBadge(),
                                  ],
                                ),
                                Text('Toyota Camry · 4.97 ★', style: jakarta.copyWith(fontSize: 13, color: MrColors.textSecondary)),
                              ],
                            ),
                          ),
                          _iconBtn('📞'),
                          const SizedBox(width: 8),
                          _iconBtn('💬'),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Divider(color: MrColors.borderLight, height: 1),
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            _stat('Est. fare', '\$18.40', mono),
                            _stat('Distance', '6.2 mi', mono, alignEnd: true),
                          ],
                        ),
                      ),
                      Divider(color: MrColors.borderLight, height: 1),
                      const SizedBox(height: 16),
                      const MrGlowButton(label: 'Request Ride'),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _iconBtn(String emoji) => Container(
        width: 44,
        height: 44,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: MrColors.iconBg, borderRadius: BorderRadius.circular(12)),
        child: Text(emoji, style: const TextStyle(fontSize: 18)),
      );

  Widget _stat(String label, String value, TextStyle mono, {bool alignEnd = false}) {
    final jakarta = GoogleFonts.plusJakartaSans();
    return Column(
      crossAxisAlignment: alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        Text(label, style: jakarta.copyWith(fontSize: 11, color: MrColors.textSecondary)),
        Text(value, style: mono.copyWith(fontSize: 22, fontWeight: FontWeight.w800)),
      ],
    );
  }
}
