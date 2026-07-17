import 'package:flutter/material.dart';
import 'package:my_ride/theme/brand_assets.dart';

enum MrLogoVariant {
  /// Horizontal wordmark + tagline + Est. 1949
  wordmark,

  /// Compact variant (same art, typically smaller)
  mark,

  /// Wordmark + yellow taxi hero photo
  hero,
}

/// Official My Ride logo from [BrandAssets].
class MrLogo extends StatelessWidget {
  const MrLogo({
    super.key,
    this.variant = MrLogoVariant.wordmark,
    this.height = 72,
    this.maxWidth,
    this.fit = BoxFit.contain,
    this.heroTag,
    this.semanticLabel = 'My Ride logo',
  });

  /// Compact app-bar / icon-sized logo.
  const MrLogo.appBar({super.key, this.heroTag})
      : variant = MrLogoVariant.mark,
        height = 36,
        maxWidth = 140,
        fit = BoxFit.contain,
        semanticLabel = 'My Ride';

  /// Auth / landing hero (large wordmark).
  const MrLogo.auth({super.key, this.heroTag})
      : variant = MrLogoVariant.wordmark,
        height = 120,
        maxWidth = 320,
        fit = BoxFit.contain,
        semanticLabel = 'My Ride logo';

  final MrLogoVariant variant;
  final double height;
  final double? maxWidth;
  final BoxFit fit;
  final String? heroTag;
  final String semanticLabel;

  String get _asset => switch (variant) {
        MrLogoVariant.wordmark => BrandAssets.wordmark,
        MrLogoVariant.mark => BrandAssets.mark,
        MrLogoVariant.hero => BrandAssets.hero,
      };

  @override
  Widget build(BuildContext context) {
    Widget image = Image.asset(
      _asset,
      height: height,
      fit: fit,
      filterQuality: FilterQuality.high,
      semanticLabel: semanticLabel,
      errorBuilder: (_, __, ___) => Icon(
        Icons.local_taxi_rounded,
        size: height * 0.55,
        color: Theme.of(context).colorScheme.primary,
      ),
    );

    if (maxWidth != null) {
      image = ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth!),
        child: image,
      );
    }

    // Rounded logo edges across app bars, auth, and hero placements
    image = ClipRRect(
      borderRadius: BorderRadius.circular(height >= 80 ? 18 : 12),
      child: image,
    );

    if (heroTag != null) {
      return Hero(tag: heroTag!, child: image);
    }
    return image;
  }
}
