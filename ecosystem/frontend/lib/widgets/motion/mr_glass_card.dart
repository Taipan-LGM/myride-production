import 'dart:ui' show ImageFilter;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:my_ride/theme/mr_tokens.dart';

class MrGlassCard extends StatelessWidget {
  const MrGlassCard({super.key, required this.child, this.padding = const EdgeInsets.all(20), this.borderRadius = MrRadius.lg});

  final Widget child;
  final EdgeInsets padding;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    // BackdropFilter blanks the canvas on many Flutter web builds.
    final fill = kIsWeb ? const Color(0xD9FFFFFF) : Colors.white.withValues(alpha: 0.82);

    Widget card = DecoratedBox(
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(borderRadius),
        border: Border.all(color: Colors.white.withValues(alpha: 0.6)),
        boxShadow: MrElevation.card,
      ),
      child: Padding(padding: padding, child: child),
    );

    if (!kIsWeb) {
      card = ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
          child: card,
        ),
      );
    } else {
      card = ClipRRect(borderRadius: BorderRadius.circular(borderRadius), child: card);
    }

    return card;
  }
}
