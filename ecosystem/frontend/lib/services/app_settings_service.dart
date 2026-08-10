import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:my_ride/config/country_currency.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Global app preferences: theme, locale, and admin country/currency.
class AppSettingsService extends ChangeNotifier {
  AppSettingsService._();
  static final AppSettingsService instance = AppSettingsService._();

  static const _themeKey = 'theme_mode';
  static const _localeKey = 'locale_code';
  static const _countryKey = 'country_code';

  SharedPreferences? _prefs;
  bool _ready = false;

  ThemeMode _themeMode = ThemeMode.system;
  Locale _locale = const Locale('en');
  CountryOption _country = CountryCurrencyCatalog.defaultCountry;

  bool get isReady => _ready;
  ThemeMode get themeMode => _themeMode;
  Locale get locale => _locale;
  CountryOption get country => _country;
  String get currencyCode => _country.currencyCode;
  String get currencySymbol => _country.currencySymbol;

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
    final themeRaw = _prefs!.getString(_themeKey);
    _themeMode = switch (themeRaw) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      'system' => ThemeMode.system,
      _ => ThemeMode.system,
    };
    final localeCode = _prefs!.getString(_localeKey) ?? 'en';
    _locale = Locale(localeCode);
    final countryCode = _prefs!.getString(_countryKey) ?? CountryCurrencyCatalog.defaultCountry.code;
    _country = CountryCurrencyCatalog.byCode(countryCode);
    _ready = true;
    notifyListeners();
  }

  Future<void> _ensurePrefs() async {
    _prefs ??= await SharedPreferences.getInstance();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    await _ensurePrefs();
    if (_themeMode == mode) return;
    _themeMode = mode;
    final stored = switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    };
    await _prefs!.setString(_themeKey, stored);
    notifyListeners();
  }

  Future<void> setLocale(Locale value) async {
    await _ensurePrefs();
    if (_locale == value) return;
    _locale = value;
    await _prefs!.setString(_localeKey, value.languageCode);
    notifyListeners();
  }

  Future<void> setCountry(CountryOption value) async {
    await _ensurePrefs();
    if (_country.code == value.code) return;
    _country = value;
    await _prefs!.setString(_countryKey, value.code);
    notifyListeners();
  }

  double usdToLocal(double usd) => usd * _country.usdRate;

  String formatFromUsd(double usd) => formatLocal(usdToLocal(usd));

  String formatLocal(double amount) {
    final localeTag = _locale.languageCode == 'af' ? 'af_ZA' : 'en_${_country.code}';
    try {
      return NumberFormat.currency(
        locale: localeTag,
        symbol: _country.currencySymbol,
        decimalDigits: _country.usdRate >= 100 ? 0 : 2,
      ).format(amount);
    } catch (_) {
      return '${_country.currencySymbol}${amount.toStringAsFixed(2)}';
    }
  }

  String formatCompactFromUsd(double usd) {
    final local = usdToLocal(usd);
    if (local >= 1000) {
      return '${_country.currencySymbol}${(local / 1000).toStringAsFixed(0)}K';
    }
    return formatLocal(local);
  }
}
