import 'package:flutter/material.dart';

/// My Ride v2.1 — Midnight Navy / Electric Mint / Coral Burst (WCAG 2.1 AA)
abstract final class MrColors {
  // Brand tokens
  static const Color primary = Color(0xFF0A2540);
  static const Color secondary = Color(0xFF00D4AA);
  static const Color accent = Color(0xFFFF6B35);

  static const Color neutral100 = Color(0xFFF6F9FC);
  static const Color neutral900 = Color(0xFF1A1A1A);

  static const Color navy = primary;
  static const Color navyMid = Color(0xFF0F3152);
  static const Color electric = secondary;
  static const Color cyan = Color(0xFF00E5C8);
  static const Color mint = secondary;
  static const Color mintDark = Color(0xFF00A884);

  static const Color surfaceBackground = neutral100;
  static const Color surfaceCard = Color(0xFFFFFFFF);
  static const Color mapDark = primary;
  static const Color mapRoad = Color(0xFF153A5C);
  static const Color mapLight = Color(0xFFE8F4F8);
  static const Color mapRoadLight = Color(0xFFCCE5F0);
  static const Color mapBuilding = Color(0xFFD0E8F2);
  static const Color showcaseBg = Color(0xFF061828);

  static const Color textPrimary = neutral900;
  static const Color textSecondary = Color(0xFF5A6B82);
  static const Color textInverse = neutral100;
  static const Color textOnSecondary = primary;

  static const Color borderLight = Color(0xFFE2E8F0);
  static const Color iconBg = Color(0xFFE8F8F4);

  static const LinearGradient ctaGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [secondary, Color(0xFF00E5C8)],
  );

  static const LinearGradient heroGradient = LinearGradient(
    begin: Alignment(-0.5, -1),
    end: Alignment(0.5, 1),
    colors: [primary, navyMid, primary],
  );

  static const LinearGradient sidebarGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [primary, navyMid],
    stops: [0.0, 1.0],
  );

  static const LinearGradient driverScreenGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [primary, navyMid, mapDark],
    stops: [0.0, 0.55, 1.0],
  );

  // Legacy aliases
  static const Color brandPrimary = secondary;
  static const Color brandPrimaryDark = primary;
  static const Color brandPrimaryLight = iconBg;
  static const Color brandPrimaryMuted = Color(0xFF99F0DC);
  static const Color surfaceDriverDark = primary;
  static const Color surfaceDriverPanel = navyMid;
  static const Color textTertiary = Color(0xFF94A3B8);
  static const Color textOnBrand = textOnSecondary;
  static const Color borderDefault = borderLight;
  static const Color borderFocus = secondary;
  static const Color success = secondary;
  static const Color warning = Color(0xFFFFB020);
  static const Color error = Color(0xFFFF4757);
  static const Color info = secondary;
}

/// 4px base grid: 4, 8, 12, 16, 24, 32, 48, 64
abstract final class MrSpacing {
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
  static const double xxxl = 64;

  static const double buttonHeight = 48;
  static const double minTouchTarget = 44;
  static const double inputHeight = 48;
}

abstract final class MrRadius {
  static const double sm = 8;
  static const double md = 12;
  static const double button = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double pill = 28;
  static const double phone = 48;
}

abstract final class MrElevation {
  static const List<BoxShadow> card = [
    BoxShadow(color: Color(0x140A2540), offset: Offset(0, 4), blurRadius: 12),
  ];
}

abstract final class MrMotion {
  static const Duration breathe = Duration(milliseconds: 2400);
  static const Duration slideUp = Duration(milliseconds: 500);
  static const Duration routeDraw = Duration(milliseconds: 3000);
  static const Duration carMove = Duration(milliseconds: 6000);
  static const Duration etaPulse = Duration(milliseconds: 2000);
  static const Duration progressFill = Duration(milliseconds: 8000);
  static const Duration earningsTick = Duration(milliseconds: 2200);
  static const Duration adminKpi = Duration(milliseconds: 2500);
  static const Curve standard = Curves.easeInOut;
  static const Curve spring = Curves.elasticOut;

  /// Respects `MediaQuery.disableAnimations` / prefers-reduced-motion.
  static bool reduced(BuildContext context) => MediaQuery.of(context).disableAnimations;
}
