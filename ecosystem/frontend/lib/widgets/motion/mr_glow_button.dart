import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:my_ride/theme/mr_tokens.dart';

/// Primary CTA — 48px height, 12px radius, Electric Mint bg, Midnight Navy text.
class MrGlowButton extends StatefulWidget {
  const MrGlowButton({
    super.key,
    required this.label,
    this.onPressed,
    this.padding,
    this.fontSize = 16,
    this.fullWidth = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final EdgeInsets? padding;
  final double fontSize;
  final bool fullWidth;

  @override
  State<MrGlowButton> createState() => _MrGlowButtonState();
}

class _MrGlowButtonState extends State<MrGlowButton> with SingleTickerProviderStateMixin {
  AnimationController? _ctrl;
  Animation<double>? _scale;
  Animation<double>? _glow;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduced = MrMotion.reduced(context);
    if (reduced) {
      _ctrl?.dispose();
      _ctrl = null;
    } else if (_ctrl == null) {
      _ctrl = AnimationController(vsync: this, duration: MrMotion.breathe)..repeat(reverse: true);
      _scale = Tween<double>(begin: 1, end: 1.02).animate(CurvedAnimation(parent: _ctrl!, curve: MrMotion.standard));
      _glow = Tween<double>(begin: 0.25, end: 0.45).animate(CurvedAnimation(parent: _ctrl!, curve: MrMotion.standard));
    }
  }

  @override
  void dispose() {
    _ctrl?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduced = MrMotion.reduced(context);
    final glowAlpha = reduced ? 0.3 : (_glow?.value ?? 0.3);
    final scale = reduced ? 1.0 : (_scale?.value ?? 1.0);

    Widget button = DecoratedBox(
      decoration: BoxDecoration(
        gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [MrColors.secondary, MrColors.cyan]),
        borderRadius: BorderRadius.circular(MrRadius.button),
        boxShadow: [
          BoxShadow(color: MrColors.secondary.withValues(alpha: glowAlpha), blurRadius: 16, offset: const Offset(0, 4)),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: widget.onPressed,
          borderRadius: BorderRadius.circular(MrRadius.button),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: MrSpacing.buttonHeight, minWidth: MrSpacing.minTouchTarget),
            child: Padding(
              padding: widget.padding ?? const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              child: Center(
                child: Text(
                  widget.label,
                  style: GoogleFonts.inter(color: MrColors.textOnSecondary, fontWeight: FontWeight.w700, fontSize: widget.fontSize),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    if (_ctrl != null && !reduced) {
      button = AnimatedBuilder(
        animation: _ctrl!,
        builder: (_, child) => Transform.scale(scale: scale, child: child),
        child: button,
      );
    }

    if (widget.fullWidth) {
      button = SizedBox(width: double.infinity, child: button);
    }
    return button;
  }
}
