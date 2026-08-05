// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:async';
import 'dart:html' as html;

/// Opens the browser file picker and returns the chosen file's text,
/// or null when the user cancels.
///
/// Order matters: subscribe to the reader's events BEFORE starting the read,
/// and listen to onLoadEnd (fires on success AND failure) so a fast read can
/// never complete before we're listening — an unobserved completion returned
/// an empty string and made imports report "no importable rows".
Future<String?> pickTextFile() async {
  final input = html.FileUploadInputElement()..accept = '.csv,text/csv';
  final picked = input.onChange.first; // subscribe first
  input.click();
  await picked;

  final files = input.files;
  if (files == null || files.isEmpty) return null;

  final reader = html.FileReader();
  final done = reader.onLoadEnd.first; // subscribe BEFORE readAsText
  reader.readAsText(files.first);
  await done;

  if (reader.error != null) {
    throw Exception('Could not read file: ${reader.error}');
  }
  final result = reader.result;
  return result is String ? result : null;
}
