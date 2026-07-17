import 'package:flutter/material.dart';
import '../theme/mr_tokens.dart';

enum MrBottomSheetDetent { peek, half, full }

class MrBottomSheet extends StatelessWidget {
  const MrBottomSheet({
    super.key,
    this.title,
    this.detent = MrBottomSheetDetent.half,
    required this.child,
    this.footer,
  });

  final String? title;
  final MrBottomSheetDetent detent;
  final Widget child;
  final Widget? footer;

  double _heightFactor(BuildContext context) {
    return switch (detent) {
      MrBottomSheetDetent.peek => 0.4,
      MrBottomSheetDetent.half => 0.6,
      MrBottomSheetDetent.full => 0.9,
    };
  }

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.sizeOf(context).height * _heightFactor(context);

    return Container(
      height: height,
      decoration: const BoxDecoration(
        color: MrColors.surfaceCard,
        borderRadius: BorderRadius.vertical(top: Radius.circular(MrRadius.xl)),
        boxShadow: [BoxShadow(color: Color(0x260F172A), blurRadius: 24, offset: Offset(0, -4))],
      ),
      child: Column(
        children: [
          const SizedBox(height: MrSpacing.sm),
          Container(width: 40, height: 4, decoration: BoxDecoration(color: MrColors.borderDefault, borderRadius: BorderRadius.circular(2))),
          if (title != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(MrSpacing.md, MrSpacing.md, MrSpacing.md, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(title!, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              ),
            ),
          Expanded(child: Padding(padding: const EdgeInsets.all(MrSpacing.md), child: child)),
          if (footer != null)
            Padding(
              padding: const EdgeInsets.all(MrSpacing.md),
              child: footer,
            ),
        ],
      ),
    );
  }
}
