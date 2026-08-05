import 'dart:convert';

import 'package:file_picker/file_picker.dart';

/// Mobile/desktop CSV picking via the file_picker plugin.
/// Returns the file's text, or null when the user cancels.
Future<String?> pickTextFile() async {
  final result = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: ['csv', 'txt'],
    withData: true,
  );
  final bytes = result?.files.single.bytes;
  if (bytes == null) return null;
  return utf8.decode(bytes, allowMalformed: true);
}
