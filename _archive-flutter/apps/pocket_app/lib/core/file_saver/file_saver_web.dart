// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter
import 'dart:convert';
import 'dart:html' as html;

/// Triggers a browser download of [text] as [filename].
/// Returns null (no local path on web).
Future<String?> saveTextFile(String filename, String text) async {
  final blob = html.Blob([utf8.encode(text)], 'text/csv;charset=utf-8');
  final url = html.Url.createObjectUrlFromBlob(blob);
  final anchor = html.AnchorElement(href: url)..download = filename;
  anchor.click();
  html.Url.revokeObjectUrl(url);
  return null;
}
