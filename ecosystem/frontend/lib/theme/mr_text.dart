import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:my_ride/theme/mr_tokens.dart';

/// Inter (sans) + Roboto Mono (metrics) — design system v2.1
abstract final class MrText {
  static TextStyle sans({
    double size = 16,
    FontWeight weight = FontWeight.w400,
    Color? color,
    double? height = 1.5,
    double letterSpacing = 0,
  }) {
    return GoogleFonts.inter(
      fontSize: size,
      fontWeight: weight,
      color: color ?? MrColors.textPrimary,
      height: height,
      letterSpacing: letterSpacing,
    );
  }

  static TextStyle mono({double size = 15, FontWeight weight = FontWeight.w500, Color? color}) {
    return GoogleFonts.robotoMono(
      fontSize: size,
      fontWeight: weight,
      color: color ?? MrColors.textPrimary,
    );
  }

  /// H1 — 32px / Bold / -0.5px tracking
  static TextStyle h1({Color? color}) => sans(
        size: 32,
        weight: FontWeight.w700,
        letterSpacing: -0.5,
        height: 1.25,
        color: color ?? MrColors.textPrimary,
      );

  /// Body — 16px / Regular / 1.5 line-height
  static TextStyle body({Color? color, FontWeight weight = FontWeight.w400}) => sans(
        size: 16,
        weight: weight,
        height: 1.5,
        color: color ?? MrColors.textPrimary,
      );

  /// Legacy alias — maps to Inter sans
  static TextStyle jakarta({double size = 15, FontWeight weight = FontWeight.w600, Color? color, double? height, double letterSpacing = 0}) =>
      sans(size: size, weight: weight, color: color, height: height, letterSpacing: letterSpacing);
}
