import 'dart:typed_data';

/// A picked receipt file: raw bytes + mime type for the Gemini API.
class PickedReceipt {
  final Uint8List bytes;
  final String mimeType;
  const PickedReceipt({required this.bytes, required this.mimeType});
}
