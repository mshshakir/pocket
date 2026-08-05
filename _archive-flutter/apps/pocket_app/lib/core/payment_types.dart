/// Payment-type vocabulary shared by the transaction dialog. Mirrors the legacy
/// `PaymentTypeService`: a fixed set of built-ins plus any user-defined types.
///
/// Custom types are derived from values already present on the user's
/// transactions rather than a separate profile column — so they persist and
/// sync for free (transactions already sync), with no extra schema or
/// upload-queue surface.
abstract final class PaymentTypes {
  static const List<String> builtIns = [
    'card',
    'cash',
    'bank-transfer',
    'cheque',
    'crypto',
    'other',
  ];

  static const Map<String, String> _labels = {
    'card': 'Card',
    'cash': 'Cash',
    'bank-transfer': 'Bank transfer',
    'cheque': 'Cheque',
    'crypto': 'Crypto',
    'other': 'Other',
    'transfer': 'Transfer',
    'adjustment': 'Adjustment',
  };

  /// Human label for a stored payment-type code.
  static String label(String type) =>
      _labels[type] ?? (type.isEmpty ? 'Other' : _titleCase(type));

  /// Built-ins followed by any custom types seen in [used] (transfer and
  /// blanks excluded, de-duplicated, original order preserved).
  static List<String> options(Iterable<String> used) {
    final out = <String>[...builtIns];
    for (final t in used) {
      if (t.isEmpty || t == 'transfer' || out.contains(t)) continue;
      out.add(t);
    }
    return out;
  }

  /// Normalises a free-typed custom type to the stored form (trimmed,
  /// lower-cased, spaces → hyphens) so "Bank Transfer" and "bank-transfer"
  /// converge.
  static String normalize(String raw) =>
      raw.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '-');

  static String _titleCase(String s) =>
      s.split('-').map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}').join(' ');
}
