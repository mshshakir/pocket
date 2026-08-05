// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:async';
import 'dart:html' as html;
import 'dart:typed_data';

import 'receipt_picker_types.dart';

/// Browser picker for a receipt image/PDF. Subscribe-before-read throughout
/// (same race class as the CSV opener fix).
Future<PickedReceipt?> pickReceiptFile() async {
  final input = html.FileUploadInputElement()
    ..accept = 'image/*,.pdf,application/pdf';
  final picked = input.onChange.first;
  input.click();
  await picked;

  final files = input.files;
  if (files == null || files.isEmpty) return null;
  final file = files.first;

  final reader = html.FileReader();
  final done = reader.onLoadEnd.first;
  reader.readAsArrayBuffer(file);
  await done;
  if (reader.error != null) {
    throw Exception('Could not read file: ${reader.error}');
  }
  final result = reader.result;
  if (result is! ByteBuffer && result is! Uint8List) return null;
  final bytes =
      result is ByteBuffer ? result.asUint8List() : result as Uint8List;
  return PickedReceipt(
      bytes: bytes,
      mimeType: file.type.isEmpty ? 'image/jpeg' : file.type);
}
