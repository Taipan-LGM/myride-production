import 'package:flutter/material.dart';
import 'package:my_ride/theme/mr_tokens.dart';

class MrPhoneFrame extends StatelessWidget {
  const MrPhoneFrame({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 390,
      height: 844,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: MrColors.navy,
        borderRadius: BorderRadius.circular(MrRadius.phone),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.5), blurRadius: 80, offset: const Offset(0, 40))],
        border: Border.all(color: Colors.white.withValues(alpha: 0.08), width: 2),
      ),
      child: ClipRRect(borderRadius: BorderRadius.circular(38), child: child),
    );
  }
}
