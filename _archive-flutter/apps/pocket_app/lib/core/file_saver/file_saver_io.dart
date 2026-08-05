import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Saves [text] as [filename] in the app documents folder.
/// Returns the path (shown to the user).
Future<String?> saveTextFile(String filename, String text) async {
  final dir = await getApplicationDocumentsDirectory();
  final file = File('${dir.path}${Platform.pathSeparator}$filename');
  await file.writeAsString(text);
  return file.path;
}
