import 'package:flutter/material.dart';
import 'package:my_ride/theme/mr_tokens.dart';

class MrLiveBadge extends StatefulWidget {
  const MrLiveBadge({super.key, this.label = 'Live'});

  final String label;

  @override
  State<MrLiveBadge> createState() => _MrLiveBadgeState();
}

class _MrLiveBadgeState extends State<MrLiveBadge> with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat(reverse: true);
  late final Animation<double> _pulse = Tween<double>(begin: 1, end: 0.85).animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut));
  late final Animation<double> _opacity = Tween<double>(begin: 1, end: 0.5).animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeInOut));

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        AnimatedBuilder(
          animation: _ctrl,
          builder: (_, __) => Transform.scale(
            scale: _pulse.value,
            child: Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: MrColors.mint.withValues(alpha: _opacity.value),
                shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: MrColors.mint.withValues(alpha: 0.8), blurRadius: 8)],
              ),
            ),
          ),
        ),
        const SizedBox(width: 6),
        Text(
          widget.label.toUpperCase(),
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.08 * 11, color: MrColors.mint),
        ),
      ],
    );
  }
}
