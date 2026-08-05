import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:pocket_domain/domain.dart';

/// What a scan prefills into the transaction dialog. Amounts are MAJOR units
/// (the dialog's text fields hold majors and convert at save).
class ReceiptPrefill {
  final double amount;
  final String currency;
  final String payee;
  final String note;
  final DateTime date;
  final String? categoryId; // single-category receipts
  final List<ReceiptSplitPrefill> splits; // multi-category receipts

  const ReceiptPrefill({
    required this.amount,
    required this.currency,
    required this.payee,
    required this.note,
    required this.date,
    this.categoryId,
    this.splits = const [],
  });
}

class ReceiptSplitPrefill {
  final String? categoryId;
  final double amount;
  const ReceiptSplitPrefill({required this.categoryId, required this.amount});
}

/// Thrown with a human-readable message; `noApiKey` is the sentinel the UI
/// turns into "add your key in Settings".
class ReceiptScanException implements Exception {
  static const String noApiKey = 'NO_API_KEY';
  final String message;
  const ReceiptScanException(this.message);
  @override
  String toString() => message;
}

/// Gemini receipt scanning — port of legacy `ReceiptScanService`:
///  * prompt injects REAL category ids so the model copies them verbatim
///    (no fuzzy name matching);
///  * image part FIRST, then the text prompt; temperature 0.1;
///  * response sanitised: first JSON object extracted (handles fences/noise),
///    every category id validated against the real set, date validated as
///    ISO, total falls back to the item sum.
class ReceiptScanService {
  // gemini-2.0-flash shut down June 2026; 2.5-flash-lite is the lowest-cost
  // current vision model (kept in sync with legacy).
  static const String model = 'gemini-2.5-flash-lite';

  final String apiKey;
  final http.Client _client;

  ReceiptScanService(this.apiKey, {http.Client? client})
      : _client = client ?? http.Client();

  Future<ReceiptPrefill> scan({
    required Uint8List bytes,
    required String mimeType,
    required List<CategoryNode> categories,
    required String defaultCurrency,
  }) async {
    if (apiKey.trim().isEmpty) {
      throw const ReceiptScanException(ReceiptScanException.noApiKey);
    }
    final today = DateTime.now();
    final todayIso = _iso(today);
    final prompt = _buildPrompt(categories, defaultCurrency, todayIso);

    final uri = Uri.parse(
        'https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent'
        '?key=${Uri.encodeQueryComponent(apiKey.trim())}');

    http.Response res;
    try {
      res = await _client.post(uri,
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'contents': [
              {
                'parts': [
                  // Image FIRST — per Google's multimodal examples.
                  {
                    'inline_data': {
                      'mime_type': mimeType,
                      'data': base64Encode(bytes),
                    }
                  },
                  {'text': prompt},
                ],
              }
            ],
            'generationConfig': {
              'temperature': 0.1,
              'maxOutputTokens': 1024,
            },
          }));
    } catch (_) {
      throw const ReceiptScanException(
          'Network error — check your connection and try again.');
    }

    if (res.statusCode != 200) {
      var msg = 'API error ${res.statusCode}';
      try {
        final err = jsonDecode(res.body) as Map<String, dynamic>;
        msg = (err['error']?['message'] as String?) ?? msg;
      } catch (_) {}
      throw ReceiptScanException(msg);
    }

    final body = jsonDecode(res.body) as Map<String, dynamic>;
    var raw = '';
    final candidates = body['candidates'];
    if (candidates is List && candidates.isNotEmpty) {
      final content = (candidates.first as Map?)?['content'];
      final parts = (content as Map?)?['parts'];
      if (parts is List) {
        raw = parts
            .map((p) => (p as Map?)?['text'] as String? ?? '')
            .join()
            .trim();
      }
    }

    final match = RegExp(r'\{[\s\S]*\}').firstMatch(raw);
    if (match == null) {
      throw const ReceiptScanException(
          'No JSON found in the AI response — the model may have refused the request.');
    }
    Map<String, dynamic> receipt;
    try {
      receipt = jsonDecode(match.group(0)!) as Map<String, dynamic>;
    } catch (_) {
      throw const ReceiptScanException(
          'Could not parse the AI response. Please try again.');
    }

    return _buildPrefill(receipt, categories, defaultCurrency, today);
  }

  // ── private ──────────────────────────────────────────────────────────

  String _buildPrompt(
      List<CategoryNode> cats, String defaultCurrency, String today) {
    final byId = {for (final c in cats) c.id: c};
    final catLines = cats.map((c) {
      if (c.parentId != null) {
        final parent = byId[c.parentId];
        return '  ID="${c.id}"  →  ${parent != null ? '${parent.name} > ' : ''}${c.name}  [${c.type}]';
      }
      return 'ID="${c.id}"  →  ${c.name}  [${c.type}]';
    }).join('\n');

    CategoryNode? fallback;
    for (final c in cats) {
      if (c.type == 'expense' && c.parentId == null) {
        fallback = c;
        break;
      }
    }
    fallback ??= cats.isNotEmpty ? cats.first : null;
    final fallbackId = fallback?.id ?? '';
    final fallbackName = fallback?.name ?? 'General';

    return '''
You are a receipt parser. Analyze the attached receipt and return ONLY a single valid JSON object. No markdown, no code fences, no explanation — just the raw JSON.

REQUIRED JSON SHAPE:
{
  "merchant": "store or merchant name",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "currency": "$defaultCurrency",
  "note": "one-line description of the purchase",
  "items": [
    { "description": "item label", "qty": "1x", "amount": 0.00, "categoryId": "EXACT_ID_FROM_LIST" }
  ]
}

CATEGORY ID LIST — you MUST set categoryId to one of these exact ID strings. Copy the ID character-for-character. Do NOT invent IDs, do NOT use the category name as the ID:
$catLines

FALLBACK: if an item does not match any category well, use ID="$fallbackId" ($fallbackName).

RULES:
1. Each item must have a categoryId from the list above — no exceptions.
2. Group line items sharing the same best-fit category into one, summing their amounts.
3. If the whole receipt is one category, return a single item with the full total.
4. "total" must equal the sum of all item amounts.
5. Date → YYYY-MM-DD. Use $today if the date is not legible on the receipt.
6. Currency → detect from any symbol/code on the receipt; if absent use "$defaultCurrency". Always return an ISO 4217 code.
7. "qty" → full unit detail exactly as printed (count, weight, volume, size, pack). Use "1x" only if no unit info is shown.''';
  }

  ReceiptPrefill _buildPrefill(Map<String, dynamic> receipt,
      List<CategoryNode> cats, String defaultCurrency, DateTime today) {
    final validIds = {for (final c in cats) c.id};
    final currency =
        ((receipt['currency'] as String?) ?? defaultCurrency).toUpperCase();

    var rawItems = (receipt['items'] is List)
        ? (receipt['items'] as List).whereType<Map>().toList()
        : const <Map>[];
    if (rawItems.isEmpty) {
      rawItems = [
        {
          'description': receipt['note'] ?? 'Receipt',
          'amount': receipt['total'] ?? 0,
          'categoryId': '',
        }
      ];
    }

    double numOf(Object? v) =>
        v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

    final items = [
      for (final item in rawItems)
        (
          description: '${item['description'] ?? 'Item'}',
          qty: '${item['qty'] ?? '1x'}',
          amount: numOf(item['amount']),
          categoryId: validIds.contains(item['categoryId'])
              ? item['categoryId'] as String
              : null,
        ),
    ];

    final itemSum = items.fold<double>(0, (s, i) => s + i.amount);
    final total = numOf(receipt['total']) > 0 ? numOf(receipt['total']) : itemSum;

    final note = items
        .map((i) =>
            '${i.description}: ${i.qty} · $currency ${i.amount.toStringAsFixed(2)}')
        .join('\n');

    DateTime date = today;
    final rawDate = receipt['date'] as String?;
    if (rawDate != null && RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(rawDate)) {
      final p = rawDate.split('-');
      date = DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
    }

    return ReceiptPrefill(
      amount: total,
      currency: currency,
      payee: (receipt['merchant'] as String?) ?? '',
      note: note.isNotEmpty
          ? note
          : ((receipt['note'] as String?) ?? 'Scanned from receipt'),
      date: date,
      categoryId: items.length == 1 ? items.first.categoryId : null,
      splits: items.length > 1
          ? [
              for (final i in items)
                ReceiptSplitPrefill(categoryId: i.categoryId, amount: i.amount),
            ]
          : const [],
    );
  }

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}
