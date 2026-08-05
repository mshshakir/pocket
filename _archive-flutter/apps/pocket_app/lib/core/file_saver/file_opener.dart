/// Platform-aware "pick a text file": browser picker on web, null elsewhere
/// (mobile needs a picker plugin — pending). Import THIS file, never the impls.
library;

export 'file_opener_io.dart' if (dart.library.html) 'file_opener_web.dart';
