/// Remembered payee → category association (legacy `merchant_categories`).
/// Lets the transaction dialog pre-select the category for a known payee.
library;

class MerchantCategory {
  /// Normalised payee key (see [MerchantMemory.normalize]).
  final String merchant;
  final String categoryId;
  const MerchantCategory({required this.merchant, required this.categoryId});
}

/// Pure lookup over the remembered merchant→category mappings. Side-effect
/// free: building it from a snapshot and querying never touches the database.
class MerchantMemory {
  final Map<String, String> _byMerchant;

  MerchantMemory(List<MerchantCategory> entries)
      : _byMerchant = {for (final e in entries) e.merchant: e.categoryId};

  /// Canonical key for a payee — trimmed and lower-cased so "Starbucks" and
  /// "  starbucks " converge to one memory.
  static String normalize(String payee) => payee.trim().toLowerCase();

  /// The remembered category id for [payee], or null if none/blank.
  String? categoryFor(String payee) {
    final key = normalize(payee);
    return key.isEmpty ? null : _byMerchant[key];
  }
}
