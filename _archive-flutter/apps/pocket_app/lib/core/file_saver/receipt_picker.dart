/// Platform-aware receipt image/PDF picker. Import THIS file, never the impls.
library;

export 'receipt_picker_io.dart' if (dart.library.html) 'receipt_picker_web.dart';
export 'receipt_picker_types.dart';
