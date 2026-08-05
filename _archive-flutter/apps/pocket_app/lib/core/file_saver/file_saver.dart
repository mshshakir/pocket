/// Platform-aware "save a text file": browser download on web, documents
/// folder elsewhere. Import THIS file, never the impls.
library;

export 'file_saver_io.dart' if (dart.library.html) 'file_saver_web.dart';
