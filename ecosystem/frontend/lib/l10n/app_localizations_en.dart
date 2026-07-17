// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'My Ride';

  @override
  String get settings => 'Settings';

  @override
  String get appearance => 'Appearance';

  @override
  String get theme => 'Theme';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDark => 'Dark';

  @override
  String get themeSystem => 'System';

  @override
  String get language => 'Language';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageAfrikaans => 'Afrikaans';

  @override
  String get regionalSettings => 'Country & currency';

  @override
  String get regionalSettingsHint =>
      'Applies to fares, earnings, and admin reports across the app.';

  @override
  String get country => 'Country';

  @override
  String get currency => 'Currency';

  @override
  String get previewFare => 'Sample economy fare';

  @override
  String get settingsSaved => 'Settings saved';

  @override
  String get tabRider => 'Rider';

  @override
  String get tabDriver => 'Driver';

  @override
  String get tabAdmin => 'Admin';

  @override
  String get economy => 'Economy';

  @override
  String get comfort => 'Comfort';

  @override
  String get premium => 'Premium';

  @override
  String get whereTo => 'Where to?';

  @override
  String get confirmRide => 'Confirm My Ride';

  @override
  String get totalRevenueToday => 'Total Revenue (Today)';

  @override
  String get activeTrips => 'Active Trips';

  @override
  String get availableDrivers => 'Available Drivers';

  @override
  String get avgTripRating => 'Avg. Trip Rating';

  @override
  String get analyticsOverview => 'Analytics Overview';

  @override
  String get liveDataUpdates => 'Live data · updates every 2s';

  @override
  String get recentTrips => 'Recent Trips';

  @override
  String get todayEarnings => 'Today\'s Earnings';

  @override
  String get tripFares => 'Trip Fares';

  @override
  String get tips => 'Tips';

  @override
  String get adminConsole => 'Admin Console';

  @override
  String get retentionAnalytics => 'Retention & revenue analytics';

  @override
  String get adminOnlyRegional =>
      'Only admins can change the operating country and currency.';
}
