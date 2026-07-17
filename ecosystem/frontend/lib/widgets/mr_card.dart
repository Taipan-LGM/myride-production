import 'package:flutter/material.dart';
import '../theme/mr_tokens.dart';

class MrCard extends StatelessWidget {
  const MrCard({
    super.key,
    required this.child,
    this.title,
    this.subtitle,
    this.padding = const EdgeInsets.all(MrSpacing.md),
    this.elevated = false,
  });

  final Widget child;
  final String? title;
  final String? subtitle;
  final EdgeInsetsGeometry padding;
  final bool elevated;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        color: MrColors.surfaceCard,
        borderRadius: BorderRadius.circular(MrRadius.md),
        border: Border.all(color: MrColors.borderDefault),
        boxShadow: elevated
            ? [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 8, offset: const Offset(0, 2))]
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (title != null) ...[
            Text(title!, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: MrColors.textPrimary)),
            if (subtitle != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(subtitle!, style: const TextStyle(fontSize: 13, color: MrColors.textSecondary)),
              ),
            const SizedBox(height: MrSpacing.sm),
          ],
          child,
        ],
      ),
    );
  }
}
