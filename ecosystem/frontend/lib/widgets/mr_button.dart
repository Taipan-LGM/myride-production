import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/mr_tokens.dart';

enum MrButtonVariant { primary, secondary, destructive, driverAccept }

enum MrButtonSize { lg, sm }

class MrButton extends StatelessWidget {
  const MrButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = MrButtonVariant.primary,
    this.size = MrButtonSize.lg,
    this.loading = false,
    this.fullWidth = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final MrButtonVariant variant;
  final MrButtonSize size;
  final bool loading;
  final bool fullWidth;

  @override
  Widget build(BuildContext context) {
    final height = size == MrButtonSize.lg ? MrSpacing.buttonHeight : 40.0;
    final enabled = onPressed != null && !loading;

    final (bg, fg, border, borderWidth) = switch (variant) {
      MrButtonVariant.primary => (MrColors.secondary, MrColors.textOnSecondary, null, 0.0),
      MrButtonVariant.secondary => (MrColors.surfaceCard, MrColors.primary, MrColors.primary, 2.0),
      MrButtonVariant.destructive => (MrColors.error, Colors.white, null, 0.0),
      MrButtonVariant.driverAccept => (MrColors.success, MrColors.textOnSecondary, null, 0.0),
    };

    return SizedBox(
      width: fullWidth ? double.infinity : null,
      height: height,
      child: ElevatedButton(
        onPressed: enabled ? onPressed : null,
        style: ElevatedButton.styleFrom(
          backgroundColor: bg,
          foregroundColor: fg,
          disabledBackgroundColor: bg.withValues(alpha: 0.4),
          elevation: 0,
          minimumSize: const Size(0, MrSpacing.minTouchTarget),
          side: border != null ? BorderSide(color: border, width: borderWidth) : null,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MrRadius.button)),
          textStyle: GoogleFonts.inter(fontWeight: FontWeight.w700),
        ),
        child: loading
            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : Text(label, style: TextStyle(fontSize: size == MrButtonSize.lg ? 16 : 14, fontWeight: FontWeight.w700)),
      ),
    );
  }
}
