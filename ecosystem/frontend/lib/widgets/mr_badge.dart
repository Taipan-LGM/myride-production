import 'package:flutter/material.dart';
import '../theme/mr_tokens.dart';

enum MrBadgeVariant { success, warning, error, neutral, primary, version }

class MrBadge extends StatelessWidget {
  const MrBadge({
    super.key,
    required this.label,
    this.variant = MrBadgeVariant.neutral,
    this.icon,
    this.version,
  });

  final String label;
  final MrBadgeVariant variant;
  final IconData? icon;
  final String? version;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (variant) {
      MrBadgeVariant.success => (const Color(0xFFD1FAE5), const Color(0xFF059669)),
      MrBadgeVariant.warning => (const Color(0xFFFEF3C7), const Color(0xFFD97706)),
      MrBadgeVariant.error => (const Color(0xFFFEE2E2), const Color(0xFFDC2626)),
      MrBadgeVariant.neutral => (const Color(0xFFF1F5F9), MrColors.textSecondary),
      MrBadgeVariant.primary => (MrColors.primary, Colors.white),
      MrBadgeVariant.version => (MrColors.secondary.withValues(alpha: 0.15), MrColors.secondary),
    };

    return Container(
      height: 22,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(9999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 12, color: fg), const SizedBox(width: 4)],
          Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: fg)),
        ],
      ),
    );
  }
}

/// Version badge widget for displaying app/backend version.
/// Usage: VersionBadge(version: '0.3.1')
class VersionBadge extends StatelessWidget {
  const VersionBadge({
    super.key,
    required this.version,
    this.padding = const EdgeInsets.only(right: 16),
  });

  final String version;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: MrBadge(
        label: 'v$version',
        variant: MrBadgeVariant.version,
      ),
    );
  }
}