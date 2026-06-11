import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../features/auth/presentation/sign_in_screen.dart';
import '../sync/sync_config.dart';
import 'app_shell.dart';

/// Bridges a stream (Supabase auth changes) to a Listenable so go_router
/// re-evaluates `redirect` whenever the user signs in/out.
class _StreamRefresh extends ChangeNotifier {
  _StreamRefresh(Stream<dynamic> stream) {
    _sub = stream.listen((_) => notifyListeners());
  }
  late final StreamSubscription<dynamic> _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}

/// The app router. When the cloud is configured, it gates everything behind
/// sign-in; in sample mode (not configured) it goes straight to the dashboard.
final routerProvider = Provider<GoRouter>((ref) {
  _StreamRefresh? refresh;
  if (syncConfigured) {
    refresh = _StreamRefresh(Supabase.instance.client.auth.onAuthStateChange);
    ref.onDispose(refresh.dispose);
  }

  return GoRouter(
    refreshListenable: refresh,
    initialLocation: '/',
    redirect: (context, state) {
      if (!syncConfigured) return null; // sample mode: no auth gate
      final signedIn = Supabase.instance.client.auth.currentSession != null;
      final atSignIn = state.matchedLocation == '/sign-in';
      if (!signedIn && !atSignIn) return '/sign-in';
      if (signedIn && atSignIn) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/', name: 'home', builder: (c, s) => const AppShell()),
      GoRoute(path: '/sign-in', name: 'signIn', builder: (c, s) => const SignInScreen()),
    ],
  );
});
