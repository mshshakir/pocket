import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// Write path for merchant auto-categorisation: on save, remember which
/// category a payee was filed under so the next entry for the same payee can
/// be pre-filled. Mirrors the legacy `merchant_categories` upsert.
class MerchantMemoryController {
  final MerchantCategoryRepository _repo;
  MerchantMemoryController(this._repo);

  Future<void> remember({required String payee, String? categoryId}) async {
    final merchant = MerchantMemory.normalize(payee);
    if (merchant.isEmpty || categoryId == null || categoryId.isEmpty) return;
    await _repo.upsert(MerchantCategory(merchant: merchant, categoryId: categoryId));
  }
}

final merchantMemoryControllerProvider = Provider<MerchantMemoryController>(
  (ref) =>
      MerchantMemoryController(ref.watch(merchantCategoryRepositoryProvider)),
);
