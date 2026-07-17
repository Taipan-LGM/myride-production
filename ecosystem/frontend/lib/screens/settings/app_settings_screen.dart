import 'package:flutter/material.dart';
import 'package:my_ride/config/country_currency.dart';
import 'package:my_ride/l10n/app_localizations.dart';
import 'package:my_ride/models/ride_models.dart';
import 'package:my_ride/services/app_settings_service.dart';
import 'package:my_ride/theme/mr_tokens.dart';
import 'package:my_ride/theme/mr_text.dart';

/// Shared appearance controls (theme + language) for all users.
class AppSettingsScreen extends StatelessWidget {
  const AppSettingsScreen({super.key, this.showRegional = false});

  final bool showRegional;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final settings = AppSettingsService.instance;

    return AnimatedBuilder(
      animation: settings,
      builder: (context, _) {
        return Scaffold(
          appBar: AppBar(title: Text(l10n.settings)),
          body: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(l10n.appearance, style: MrText.jakarta(size: 13, weight: FontWeight.w700, color: MrColors.textSecondary)),
              const SizedBox(height: 8),
              _SettingsCard(
                children: [
                  _ThemeSegmented(
                    value: settings.themeMode,
                    onChanged: (mode) => settings.setThemeMode(mode),
                  ),
                  const Divider(height: 24),
                  _LanguageTiles(
                    locale: settings.locale,
                    onChanged: settings.setLocale,
                  ),
                ],
              ),
              if (showRegional) ...[
                const SizedBox(height: 24),
                Text(l10n.regionalSettings, style: MrText.jakarta(size: 13, weight: FontWeight.w700, color: MrColors.textSecondary)),
                const SizedBox(height: 4),
                Text(l10n.regionalSettingsHint, style: MrText.sans(size: 12, color: MrColors.textSecondary)),
                const SizedBox(height: 8),
                _SettingsCard(children: [RegionalSettingsFields(country: settings.country)]),
              ] else ...[
                const SizedBox(height: 16),
                Text(l10n.adminOnlyRegional, style: MrText.sans(size: 12, color: MrColors.textSecondary)),
                const SizedBox(height: 8),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text('${settings.country.nameForLocale(settings.locale.languageCode)} (${settings.currencyCode})'),
                  subtitle: Text(l10n.previewFare + ': ${settings.formatFromUsd(RideTier.economy.baseFare)}'),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

/// Admin-only country & currency picker (also embedded in admin console).
class RegionalSettingsFields extends StatelessWidget {
  const RegionalSettingsFields({super.key, required this.country});

  final CountryOption country;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final settings = AppSettingsService.instance;
    final lang = settings.locale.languageCode;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownButtonFormField<String>(
          value: country.code,
          decoration: InputDecoration(labelText: l10n.country, border: const OutlineInputBorder()),
          items: CountryCurrencyCatalog.all
              .map((c) => DropdownMenuItem(value: c.code, child: Text('${c.nameForLocale(lang)} (${c.currencyCode})')))
              .toList(),
          onChanged: (code) {
            if (code != null) settings.setCountry(CountryCurrencyCatalog.byCode(code));
          },
        ),
        const SizedBox(height: 16),
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(l10n.currency, style: MrText.jakarta(weight: FontWeight.w600)),
          subtitle: Text('${country.currencyCode} · ${country.currencySymbol}', style: MrText.sans(size: 13, color: MrColors.textSecondary)),
        ),
        const SizedBox(height: 8),
        DecoratedBox(
          decoration: BoxDecoration(
            color: MrColors.secondary.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Expanded(child: Text(l10n.previewFare, style: MrText.sans(size: 13, color: MrColors.textSecondary))),
                Text(
                  settings.formatFromUsd(RideTier.economy.baseFare),
                  style: MrText.mono(size: 18, weight: FontWeight.w800, color: MrColors.primary),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class AdminSettingsPanel extends StatelessWidget {
  const AdminSettingsPanel({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final settings = AppSettingsService.instance;

    return AnimatedBuilder(
      animation: settings,
      builder: (context, _) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.settings, style: MrText.jakarta(size: 16, weight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(l10n.regionalSettingsHint, style: MrText.sans(size: 12, color: MrColors.textSecondary)),
            const SizedBox(height: 16),
            RegionalSettingsFields(country: settings.country),
            const SizedBox(height: 24),
            Text(l10n.appearance, style: MrText.jakarta(size: 14, weight: FontWeight.w700)),
            const SizedBox(height: 8),
            _SettingsCard(
              children: [
                _ThemeSegmented(value: settings.themeMode, onChanged: settings.setThemeMode),
                const Divider(height: 24),
                _LanguageTiles(locale: settings.locale, onChanged: settings.setLocale),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _SettingsCard extends StatelessWidget {
  const _SettingsCard({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
      ),
    );
  }
}

class _ThemeSegmented extends StatelessWidget {
  const _ThemeSegmented({required this.value, required this.onChanged});

  final ThemeMode value;
  final ValueChanged<ThemeMode> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.theme, style: MrText.jakarta(weight: FontWeight.w600)),
        const SizedBox(height: 10),
        SegmentedButton<ThemeMode>(
          segments: [
            ButtonSegment(value: ThemeMode.light, label: Text(l10n.themeLight), icon: const Icon(Icons.light_mode_outlined)),
            ButtonSegment(value: ThemeMode.dark, label: Text(l10n.themeDark), icon: const Icon(Icons.dark_mode_outlined)),
            ButtonSegment(value: ThemeMode.system, label: Text(l10n.themeSystem), icon: const Icon(Icons.settings_brightness_outlined)),
          ],
          selected: {value},
          onSelectionChanged: (s) => onChanged(s.first),
        ),
      ],
    );
  }
}

class _LanguageTiles extends StatelessWidget {
  const _LanguageTiles({required this.locale, required this.onChanged});

  final Locale locale;
  final ValueChanged<Locale> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.language, style: MrText.jakarta(weight: FontWeight.w600)),
        const SizedBox(height: 8),
        RadioListTile<Locale>(
          value: const Locale('en'),
          groupValue: locale,
          onChanged: (v) => v != null ? onChanged(v) : null,
          title: Text(l10n.languageEnglish),
          contentPadding: EdgeInsets.zero,
        ),
        RadioListTile<Locale>(
          value: const Locale('af'),
          groupValue: locale,
          onChanged: (v) => v != null ? onChanged(v) : null,
          title: Text(l10n.languageAfrikaans),
          contentPadding: EdgeInsets.zero,
        ),
      ],
    );
  }
}
