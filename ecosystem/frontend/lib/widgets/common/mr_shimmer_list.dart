import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';
import 'package:my_ride/theme/mr_tokens.dart';

/// Shimmer placeholder rows for list loading states.
class MrShimmerList extends StatelessWidget {
  const MrShimmerList({super.key, this.itemCount = 6, this.itemHeight = 72});

  final int itemCount;
  final double itemHeight;

  @override
  Widget build(BuildContext context) {
    final base = Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade800 : Colors.grey.shade300;
    final highlight = Theme.of(context).brightness == Brightness.dark ? Colors.grey.shade700 : Colors.grey.shade100;
    return Shimmer.fromColors(
      baseColor: base,
      highlightColor: highlight,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: itemCount,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, __) => Container(
          height: itemHeight,
          decoration: BoxDecoration(color: MrColors.neutral100, borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
  }
}
