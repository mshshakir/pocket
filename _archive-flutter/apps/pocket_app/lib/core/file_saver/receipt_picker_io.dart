import 'package:file_picker/file_picker.dart';

import 'receipt_picker_types.dart';

/// Mobile/desktop receipt picking via the file_picker plugin.
Future<PickedReceipt?> pickReceiptFile() async {
  final result = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'],
    withData: true,
  );
  final file = result?.files.single;
  final bytes = file?.bytes;
  if (file == null || bytes == null) return null;

  final ext = (file.extension ?? '').toLowerCase();
  final mime = switch (ext) {
    'png' => 'image/png',
    'webp' => 'image/webp',
    'heic' => 'image/heic',
    'pdf' => 'application/pdf',
    _ => 'image/jpeg',
  };
  return PickedReceipt(bytes: bytes, mimeType: mime);
}
