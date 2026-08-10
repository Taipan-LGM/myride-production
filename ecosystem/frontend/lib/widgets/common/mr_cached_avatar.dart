import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:my_ride/theme/mr_tokens.dart';

/// Cached circular avatar for driver/rider photos.
class MrCachedAvatar extends StatelessWidget {
  const MrCachedAvatar({
    super.key,
    this.imageUrl,
    this.name,
    this.radius = 26,
  });

  final String? imageUrl;
  final String? name;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final initials = (name ?? '?').substring(0, 1).toUpperCase();
    if (imageUrl == null || imageUrl!.isEmpty) {
      return CircleAvatar(
        radius: radius,
        backgroundColor: MrColors.secondary,
        child: Text(initials, style: TextStyle(color: MrColors.primary, fontWeight: FontWeight.w700, fontSize: radius * 0.7)),
      );
    }
    return Semantics(
      label: name ?? 'Profile photo',
      child: CircleAvatar(
        radius: radius,
        backgroundColor: MrColors.neutral100,
        child: ClipOval(
          child: CachedNetworkImage(
            imageUrl: imageUrl!,
            width: radius * 2,
            height: radius * 2,
            fit: BoxFit.cover,
            placeholder: (_, __) => const CircularProgressIndicator(strokeWidth: 2),
            errorWidget: (_, __, ___) => Text(initials),
          ),
        ),
      ),
    );
  }
}
