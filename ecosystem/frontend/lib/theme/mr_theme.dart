import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:my_ride/theme/mr_tokens.dart';

ThemeData myRideTheme() => _buildTheme(Brightness.light);

ThemeData myRideDarkTheme() => _buildTheme(Brightness.dark);

ThemeData _buildTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final base = GoogleFonts.interTextTheme(ThemeData(brightness: brightness).textTheme);
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: isDark ? const Color(0xFF061828) : MrColors.surfaceBackground,
    colorScheme: isDark
        ? const ColorScheme.dark(
            primary: MrColors.secondary,
            secondary: MrColors.secondary,
            tertiary: MrColors.accent,
            surface: Color(0xFF0F3152),
            onPrimary: MrColors.primary,
            onSecondary: MrColors.primary,
            onSurface: MrColors.textInverse,
          )
        : const ColorScheme.light(
            primary: MrColors.primary,
            secondary: MrColors.secondary,
            tertiary: MrColors.accent,
            surface: MrColors.surfaceCard,
            onPrimary: MrColors.textOnSecondary,
            onSecondary: MrColors.textOnSecondary,
            onSurface: MrColors.textPrimary,
          ),
    textTheme: base.copyWith(
      displayLarge: MrTextStyles.h1For(brightness),
      bodyLarge: MrTextStyles.bodyFor(brightness),
      bodyMedium: MrTextStyles.bodyFor(brightness),
      labelLarge: GoogleFonts.inter(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: isDark ? MrColors.primary : MrColors.textOnSecondary,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: isDark ? const Color(0xFF0A2540) : MrColors.primary,
      foregroundColor: MrColors.textInverse,
      elevation: 0,
      titleTextStyle: GoogleFonts.inter(fontSize: 18, fontWeight: FontWeight.w700, color: MrColors.textInverse),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        minimumSize: const Size(0, MrSpacing.buttonHeight),
        backgroundColor: MrColors.secondary,
        foregroundColor: MrColors.textOnSecondary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MrRadius.button)),
        elevation: 0,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, MrSpacing.buttonHeight),
        foregroundColor: isDark ? MrColors.secondary : MrColors.primary,
        side: BorderSide(color: isDark ? MrColors.secondary : MrColors.primary, width: 2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MrRadius.button)),
      ),
    ),
    cardTheme: CardThemeData(
      color: isDark ? const Color(0xFF0F3152) : MrColors.surfaceCard,
      elevation: 0,
      shadowColor: const Color(0x140A2540),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(MrRadius.lg)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: isDark ? const Color(0xFF0A2540) : MrColors.primary,
      indicatorColor: MrColors.secondary.withValues(alpha: 0.25),
    ),
  );
}

abstract final class MrTextStyles {
  static TextStyle h1For(Brightness brightness) => GoogleFonts.inter(
        fontSize: 32,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.5,
        height: 1.25,
        color: brightness == Brightness.dark ? MrColors.textInverse : MrColors.textPrimary,
      );

  static TextStyle bodyFor(Brightness brightness) => GoogleFonts.inter(
        fontSize: 16,
        fontWeight: FontWeight.w400,
        height: 1.5,
        color: brightness == Brightness.dark ? MrColors.textInverse : MrColors.textPrimary,
      );

  static TextStyle get h1 => h1For(Brightness.light);
  static TextStyle get body => bodyFor(Brightness.light);
}

/// Legacy alias
ThemeData myRideRiderTheme() => myRideTheme();
ThemeData myRideDriverTheme() => myRideTheme();




