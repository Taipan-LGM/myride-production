import 'package:flutter/material.dart';
import 'package:my_ride/theme/brand_assets.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/widgets/brand/mr_logo.dart';

class MrBrandHeader extends StatelessWidget {
  const MrBrandHeader({
    super.key,
    this.subtitle,
    this.onDark = false,
    this.driverMode = false,
  });

  final String? subtitle;
  final bool onDark;
  final bool driverMode;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (onDark)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(10)),
            child: const MrLogo.appBar(),
          )
        else
          const MrLogo.appBar(),
        if (driverMode) ...[
          const SizedBox(height: 6),
          Text(
            'DRIVER',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 2,
              color: onDark ? MrColors.success : MrColors.brandPrimary,
            ),
          ),
        ],
        if (subtitle != null) ...[
          const SizedBox(height: 4),
          Text(
            subtitle!,
            style: TextStyle(
              fontSize: 13,
              color: onDark ? MrColors.textTertiary : MrColors.textSecondary,
            ),
          ),
        ] else ...[
          const SizedBox(height: 4),
          Text(
            BrandAssets.tagline,
            style: TextStyle(
              fontSize: 12,
              fontStyle: FontStyle.italic,
              color: onDark ? MrColors.textTertiary : MrColors.textSecondary,
            ),
          ),
        ],
      ],
    );
  }
}

class MrOnboardingProgress extends StatelessWidget {
  const MrOnboardingProgress({super.key, required this.step, required this.total});

  final int step;
  final int total;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: LinearProgressIndicator(
        value: step / total,
        minHeight: 8,
        backgroundColor: MrColors.borderDefault,
        color: MrColors.brandPrimary,
      ),
    );
  }
}

class MrMapPlaceholder extends StatelessWidget {
  const MrMapPlaceholder({super.key, this.height = 280, this.onDark = false});

  final double height;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: onDark
              ? [const Color(0xFF1E3A4C), const Color(0xFF1E293B)]
              : [const Color(0xFFE8F4F8), const Color(0xFFB2DFDB)],
        ),
      ),
      child: CustomPaint(painter: _MapGridPainter(onDark: onDark)),
    );
  }
}

class _MapGridPainter extends CustomPainter {
  _MapGridPainter({required this.onDark});

  final bool onDark;

  @override
  void paint(Canvas canvas, Size size) {
    final road = Paint()
      ..color = onDark ? const Color(0xFF2D4A5E) : Colors.white.withValues(alpha: 0.85)
      ..strokeWidth = 12
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(Offset(0, size.height * 0.55), Offset(size.width, size.height * 0.55), road);
    canvas.drawLine(Offset(size.width * 0.4, 0), Offset(size.width * 0.4, size.height), road..strokeWidth = 8);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
