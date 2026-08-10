import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:my_ride/theme/mr_tokens.dart';

Path buildRiderRoutePath() {
  final path = Path()
    ..moveTo(80, 620)
    ..quadraticBezierTo(120, 500, 180, 420)
    ..quadraticBezierTo(240, 340, 280, 280)
    ..quadraticBezierTo(320, 220, 310, 200);
  return path;
}

Path buildDriverNavPath() {
  return Path()
    ..moveTo(30, 180)
    ..quadraticBezierTo(100, 120, 180, 90)
    ..quadraticBezierTo(260, 60, 320, 40);
}

class MrAnimatedRiderMap extends StatefulWidget {
  const MrAnimatedRiderMap({super.key, this.showVehiclePins = false, this.lightMode = false});

  final bool showVehiclePins;
  final bool lightMode;

  @override
  State<MrAnimatedRiderMap> createState() => _MrAnimatedRiderMapState();
}

class _MrAnimatedRiderMapState extends State<MrAnimatedRiderMap> with TickerProviderStateMixin {
  late final AnimationController _routeCtrl = AnimationController(vsync: this, duration: MrMotion.routeDraw)..repeat();
  late final AnimationController _carCtrl = AnimationController(vsync: this, duration: MrMotion.carMove)..repeat();
  late final AnimationController _pulseCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 2000))..repeat();

  @override
  void dispose() {
    _routeCtrl.dispose();
    _carCtrl.dispose();
    _pulseCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([_routeCtrl, _carCtrl, _pulseCtrl]),
      builder: (context, _) {
        return SizedBox.expand(
          child: CustomPaint(
            painter: _RiderMapPainter(
              routeProgress: _routeCtrl.value,
              carProgress: _carCtrl.value,
              pulseProgress: _pulseCtrl.value,
              showVehiclePins: widget.showVehiclePins,
              lightMode: widget.lightMode,
            ),
          ),
        );
      },
    );
  }
}

class _RiderMapPainter extends CustomPainter {
  _RiderMapPainter({required this.routeProgress, required this.carProgress, required this.pulseProgress, this.showVehiclePins = false, this.lightMode = false});

  final double routeProgress;
  final double carProgress;
  final double pulseProgress;
  final bool showVehiclePins;
  final bool lightMode;

  @override
  void paint(Canvas canvas, Size size) {
    final scaleX = size.width / 390;
    final scaleY = size.height / 844;
    canvas.save();
    canvas.scale(scaleX, scaleY);

    final bg = Paint()..color = lightMode ? MrColors.mapLight : MrColors.mapDark;
    if (!lightMode) {
      bg.shader = ui.Gradient.linear(const Offset(0, 0), const Offset(390, 844), [MrColors.mapDark, MrColors.navyMid]);
    }
    canvas.drawRect(const Rect.fromLTWH(0, 0, 390, 844), bg);

    if (lightMode) {
      final roadLight = Paint()
        ..color = MrColors.mapRoadLight
        ..style = PaintingStyle.stroke
        ..strokeWidth = 20
        ..strokeCap = StrokeCap.round;
      canvas.drawPath(Path()..moveTo(50, 200)..quadraticBezierTo(150, 150, 250, 220)..quadraticBezierTo(300, 190, 340, 180), roadLight);
      canvas.drawPath(Path()..moveTo(80, 350)..quadraticBezierTo(200, 300, 320, 380), roadLight..strokeWidth = 16);
      canvas.drawPath(Path()..moveTo(30, 450)..quadraticBezierTo(120, 420, 200, 480), roadLight..strokeWidth = 12);
      for (final b in [Rect.fromLTWH(40, 120, 30, 60), Rect.fromLTWH(80, 100, 40, 80), Rect.fromLTWH(260, 140, 35, 70), Rect.fromLTWH(300, 110, 28, 90)]) {
        canvas.drawRRect(RRect.fromRectAndRadius(b, const Radius.circular(4)), Paint()..color = MrColors.mapBuilding);
      }
    } else {
      final road = Paint()
        ..color = MrColors.mapRoad
        ..style = PaintingStyle.stroke
        ..strokeWidth = 18
        ..strokeCap = StrokeCap.round;
      for (final y in [300.0, 500.0, 700.0]) {
        canvas.drawLine(Offset(0, y), Offset(390, y), road);
      }
      canvas.drawLine(const Offset(100, 0), const Offset(100, 844), road);
      canvas.drawLine(const Offset(250, 0), const Offset(250, 844), road);
    }

    if (showVehiclePins) {
      const pins = [Offset(120, 280), Offset(280, 320), Offset(180, 420)];
      for (final p in pins) {
        canvas.drawCircle(p, 18, Paint()..color = MrColors.primary.withValues(alpha: 0.2));
        canvas.drawCircle(p, 8, Paint()..color = MrColors.secondary);
        canvas.drawPath(Path()..moveTo(p.dx - 6, p.dy - 2)..lineTo(p.dx + 6, p.dy - 2)..lineTo(p.dx + 4, p.dy + 4)..lineTo(p.dx - 4, p.dy + 4)..close(), Paint()..color = MrColors.primary);
      }
      // User location — Coral Burst
      canvas.drawCircle(const Offset(187, 400), 24, Paint()..color = MrColors.accent.withValues(alpha: 0.15));
      canvas.drawCircle(const Offset(187, 400), 12, Paint()..color = MrColors.accent);
      canvas.drawCircle(const Offset(187, 400), 12, Paint()
        ..color = Colors.transparent
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..color = Colors.white);
    }

    if (!lightMode) {
      final route = buildRiderRoutePath();
      final routePaint = Paint()
        ..shader = ui.Gradient.linear(const Offset(80, 620), const Offset(310, 200), [MrColors.electric, MrColors.cyan])
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round;
      _drawDashedPath(canvas, route, routePaint, dashLength: 12, gap: 8, offset: (1 - routeProgress) * 200);

      final pulseR = ui.lerpDouble(10, 16, pulseProgress)!;
      final ringR = ui.lerpDouble(16, 36, pulseProgress)!;
      final ringOpacity = ui.lerpDouble(0.6, 0, pulseProgress)!;
      canvas.drawCircle(const Offset(80, 620), pulseR, Paint()..color = MrColors.mint.withValues(alpha: 0.9));
      canvas.drawCircle(
        const Offset(80, 620),
        ringR,
        Paint()
          ..color = MrColors.mint.withValues(alpha: ringOpacity)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );

      final metrics = route.computeMetrics().first;
      final tangent = metrics.getTangentForOffset(metrics.length * carProgress);
      if (tangent != null) {
        final pos = tangent.position;
        final angle = tangent.angle;
        canvas.drawCircle(pos, 14, Paint()..color = MrColors.electric..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3));
        canvas.save();
        canvas.translate(pos.dx, pos.dy);
        canvas.rotate(angle);
        final arrow = Path()
          ..moveTo(-6, -4)
          ..lineTo(8, 0)
          ..lineTo(-6, 4)
          ..close();
        canvas.drawPath(arrow, Paint()..color = MrColors.cyan);
        canvas.restore();
      }

      canvas.save();
      canvas.translate(310, 200);
      canvas.rotate(math.pi / 4);
      canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromCenter(center: Offset.zero, width: 24, height: 24), const Radius.circular(6)), Paint()..color = MrColors.accent);
      canvas.restore();
    }

    canvas.restore();
  }

  void _drawDashedPath(Canvas canvas, Path path, Paint paint, {required double dashLength, required double gap, required double offset}) {
    for (final metric in path.computeMetrics()) {
      var distance = -offset;
      while (distance < metric.length) {
        final start = distance.clamp(0.0, metric.length);
        final end = (distance + dashLength).clamp(0.0, metric.length);
        if (end > start) canvas.drawPath(metric.extractPath(start, end), paint);
        distance += dashLength + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _RiderMapPainter old) =>
      old.routeProgress != routeProgress || old.carProgress != carProgress || old.pulseProgress != pulseProgress || old.showVehiclePins != showVehiclePins || old.lightMode != lightMode;
}

class MrAnimatedDriverNavMap extends StatefulWidget {
  const MrAnimatedDriverNavMap({super.key});

  @override
  State<MrAnimatedDriverNavMap> createState() => _MrAnimatedDriverNavMapState();
}

class _MrAnimatedDriverNavMapState extends State<MrAnimatedDriverNavMap> with TickerProviderStateMixin {
  late final AnimationController _routeCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 4000))..repeat();
  late final AnimationController _carCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 5000))..repeat();

  @override
  void dispose() {
    _routeCtrl.dispose();
    _carCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([_routeCtrl, _carCtrl]),
      builder: (context, _) => SizedBox.expand(
        child: CustomPaint(
          painter: _DriverNavPainter(routeProgress: _routeCtrl.value, carProgress: _carCtrl.value),
        ),
      ),
    );
  }
}

class _DriverNavPainter extends CustomPainter {
  _DriverNavPainter({required this.routeProgress, required this.carProgress});
  final double routeProgress;
  final double carProgress;

  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / 350;
    final sy = size.height / 220;
    canvas.save();
    canvas.scale(sx, sy);
    canvas.drawRect(const Rect.fromLTWH(0, 0, 350, 220), Paint()..color = MrColors.mapDark);

    final path = buildDriverNavPath();
    canvas.drawPath(path, Paint()
      ..color = MrColors.mapRoad
      ..style = PaintingStyle.stroke
      ..strokeWidth = 24
      ..strokeCap = StrokeCap.round);

    final routePaint = Paint()
      ..shader = ui.Gradient.linear(const Offset(30, 180), const Offset(320, 40), [MrColors.electric, MrColors.cyan])
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;
    _drawDashed(canvas, path, routePaint, (1 - routeProgress) * 300);

    final metric = path.computeMetrics().first;
    final t = metric.getTangentForOffset(metric.length * carProgress);
    if (t != null) canvas.drawCircle(t.position, 10, Paint()..color = MrColors.electric);

    const textStyle = TextStyle(color: Color(0xB3FFFFFF), fontSize: 11, fontWeight: FontWeight.w700);
    final tp = TextPainter(text: const TextSpan(text: 'TURN RIGHT · 0.3 mi', style: textStyle), textDirection: TextDirection.ltr)..layout();
    tp.paint(canvas, const Offset(16, 18));
    canvas.restore();
  }

  void _drawDashed(Canvas canvas, Path path, Paint paint, double offset) {
    for (final m in path.computeMetrics()) {
      var d = -offset;
      while (d < m.length) {
        final a = d.clamp(0.0, m.length);
        final b = (d + 14).clamp(0.0, m.length);
        if (b > a) canvas.drawPath(m.extractPath(a, b), paint);
        d += 22;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DriverNavPainter old) => old.routeProgress != routeProgress || old.carProgress != carProgress;
}
