import 'package:intl/intl.dart';
import 'package:pocket_domain/domain.dart';

/// Formats minor units as a localized currency string (e.g. ₹43,177.42).
String formatMoney(CurrencyService fx, int minor, String currency) {
  final value = fx.fromMinor(minor, currency);
  try {
    return NumberFormat.simpleCurrency(
      name: currency,
      decimalDigits: fx.minorDigits(currency),
    ).format(value);
  } catch (_) {
    return '$currency ${value.toStringAsFixed(fx.minorDigits(currency))}';
  }
}
