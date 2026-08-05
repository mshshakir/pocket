import 'package:flutter/material.dart' show DateTimeRange;
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The date range currently selected on the Transactions screen. Shared so CSV
/// export can offer a "current range" matching what the user is viewing —
/// legacy reused a single `#reportRange` across the list and the exporter.
final transactionsDateRangeProvider =
    StateProvider<DateTimeRange?>((ref) => null);
