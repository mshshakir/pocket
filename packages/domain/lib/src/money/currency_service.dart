/// Thrown by [CurrencyService.convertStrict] when a currency has no FX rate.
class CurrencyException implements Exception {
  final String message;
  CurrencyException(this.message);
  @override
  String toString() => 'CurrencyException: $message';
}

/// All currency arithmetic in one place — a faithful Dart port of the JS
/// `CurrencyService`. Pure: rates are injected (units per 1 USD), no globals,
/// no I/O.
///
/// Amounts are integer **minor units** (e.g. cents). `rates[code]` is how many
/// units of `code` equal 1 USD (e.g. `{'USD': 1, 'INR': 83}`).
class CurrencyService {
  final Map<String, double> rates;

  /// ISO 4217 currencies with 0 decimal places.
  static const Set<String> zeroDecimal = {
    'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
    'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
  };

  /// ISO 4217 currencies with 3 decimal places.
  static const Set<String> threeDecimal = {
    'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
  };

  const CurrencyService(this.rates);

  int minorFactor(String currency) {
    if (zeroDecimal.contains(currency)) return 1;
    if (threeDecimal.contains(currency)) return 1000;
    return 100;
  }

  int minorDigits(String currency) {
    if (zeroDecimal.contains(currency)) return 0;
    if (threeDecimal.contains(currency)) return 3;
    return 2;
  }

  /// Human amount (e.g. 12.50) -> minor units (1250).
  int toMinor(num amount, String currency) =>
      (amount * minorFactor(currency)).round();

  /// Minor units (1250) -> human amount (12.50).
  double fromMinor(int minor, String currency) =>
      minor / minorFactor(currency);

  /// Strict conversion: **throws** [CurrencyException] when either currency is
  /// missing from the rate table. Use on the ledger/balance path, where the
  /// caller must distinguish "unconvertible" from a genuine zero.
  int convertStrict(int minor, String from, String to) {
    if (from == to) return minor;
    final fromRate = rates[from];
    final toRate = rates[to];
    if (fromRate == null || toRate == null) {
      throw CurrencyException('No FX rate for $from→$to');
    }
    final majorUsd = fromMinor(minor, from) / fromRate;
    final majorTo = majorUsd * toRate;
    return toMinor(majorTo, to);
  }

  /// Resilient conversion for display/aggregation: **never throws**. An unknown
  /// currency yields 0 (not the old, dangerous 1:1 passthrough), so a single
  /// corrupt/exotic currency can't silently inflate a home-currency total.
  int convert(int minor, String from, String to) {
    try {
      return convertStrict(minor, from, to);
    } on CurrencyException {
      return 0;
    }
  }
}
