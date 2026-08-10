/// Operating countries with ISO codes and USD conversion rates (approximate).
class CountryOption {
  const CountryOption({
    required this.code,
    required this.nameEn,
    required this.nameAf,
    required this.currencyCode,
    required this.currencySymbol,
    required this.usdRate,
  });

  final String code;
  final String nameEn;
  final String nameAf;
  final String currencyCode;
  final String currencySymbol;
  final double usdRate;

  String nameForLocale(String languageCode) => languageCode == 'af' ? nameAf : nameEn;
}

abstract final class CountryCurrencyCatalog {
  static const CountryOption defaultCountry = southAfrica;

  static const CountryOption southAfrica = CountryOption(
    code: 'ZA',
    nameEn: 'South Africa',
    nameAf: 'Suid-Afrika',
    currencyCode: 'ZAR',
    currencySymbol: 'R',
    usdRate: 18.50,
  );

  static const CountryOption unitedStates = CountryOption(
    code: 'US',
    nameEn: 'United States',
    nameAf: 'Verenigde State',
    currencyCode: 'USD',
    currencySymbol: '\$',
    usdRate: 1.0,
  );

  static const CountryOption unitedKingdom = CountryOption(
    code: 'GB',
    nameEn: 'United Kingdom',
    nameAf: 'Verenigde Koninkryk',
    currencyCode: 'GBP',
    currencySymbol: '£',
    usdRate: 0.79,
  );

  static const CountryOption namibia = CountryOption(
    code: 'NA',
    nameEn: 'Namibia',
    nameAf: 'Namibië',
    currencyCode: 'NAD',
    currencySymbol: 'N\$',
    usdRate: 18.20,
  );

  static const CountryOption botswana = CountryOption(
    code: 'BW',
    nameEn: 'Botswana',
    nameAf: 'Botswana',
    currencyCode: 'BWP',
    currencySymbol: 'P',
    usdRate: 13.60,
  );

  static const CountryOption kenya = CountryOption(
    code: 'KE',
    nameEn: 'Kenya',
    nameAf: 'Kenia',
    currencyCode: 'KES',
    currencySymbol: 'KSh',
    usdRate: 129.0,
  );

  static const CountryOption nigeria = CountryOption(
    code: 'NG',
    nameEn: 'Nigeria',
    nameAf: 'Nigerië',
    currencyCode: 'NGN',
    currencySymbol: '₦',
    usdRate: 1550.0,
  );

  static const List<CountryOption> all = [
    southAfrica,
    unitedStates,
    unitedKingdom,
    namibia,
    botswana,
    kenya,
    nigeria,
  ];

  static CountryOption byCode(String code) {
    return all.firstWhere((c) => c.code == code, orElse: () => defaultCountry);
  }
}
