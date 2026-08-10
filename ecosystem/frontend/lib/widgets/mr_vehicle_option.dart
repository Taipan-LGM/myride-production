import 'package:flutter/material.dart';
import '../theme/mr_tokens.dart';

class MrVehicleOption extends StatelessWidget {
  const MrVehicleOption({
    super.key,
    required this.name,
    required this.fareRange,
    required this.icon,
    this.selected = false,
    this.onTap,
  });

  final String name;
  final String fareRange;
  final IconData icon;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: '$name, $fareRange',
      child: Material(
        color: selected ? MrColors.brandPrimaryLight : MrColors.surfaceCard,
        borderRadius: BorderRadius.circular(MrRadius.md),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(MrRadius.md),
          child: Container(
            width: 100,
            height: 88,
            padding: const EdgeInsets.all(MrSpacing.sm),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(MrRadius.md),
              border: Border.all(color: selected ? MrColors.brandPrimary : MrColors.borderDefault, width: selected ? 2 : 1),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 24, color: MrColors.textPrimary),
                const Spacer(),
                Text(name, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                Text(fareRange, style: TextStyle(fontSize: 11, color: selected ? MrColors.brandPrimary : MrColors.textSecondary)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
