import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Email/password sign-in (and sign-up) via Supabase. On success the auth state
/// changes and the router redirects to the dashboard automatically.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _info;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// Basic field validation; returns false (and shows a message) if invalid.
  bool _valid() {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter an email and a password.');
      return false;
    }
    if (_password.text.length < 6) {
      setState(() => _error = 'Password must be at least 6 characters.');
      return false;
    }
    return true;
  }

  Future<void> _run(
    Future<void> Function() action, {
    bool requireCredentials = true,
  }) async {
    if (requireCredentials && !_valid()) return;
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await action();
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = Supabase.instance.client.auth;

    return Scaffold(
      appBar: AppBar(title: const Text('Pocket Budget')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(24),
            children: [
              Text('Sign in',
                  style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 16),
              TextField(
                controller: _email,
                decoration: const InputDecoration(
                    labelText: 'Email', border: OutlineInputBorder()),
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                enableSuggestions: false,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _password,
                decoration: const InputDecoration(
                    labelText: 'Password', border: OutlineInputBorder()),
                obscureText: true,
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!,
                    style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              if (_info != null) ...[
                const SizedBox(height: 12),
                Text(_info!),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy
                    ? null
                    : () => _run(() => auth.signInWithPassword(
                          email: _email.text.trim(),
                          password: _password.text,
                        )),
                child: _busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Sign in'),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                          await auth.signUp(
                            email: _email.text.trim(),
                            password: _password.text,
                          );
                          if (mounted) {
                            setState(() => _info =
                                'Account created. If email confirmation is on, '
                                'check your inbox, then sign in.');
                          }
                        }),
                child: const Text('Create an account'),
              ),
              const SizedBox(height: 16),
              const Row(
                children: [
                  Expanded(child: Divider()),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 8),
                    child: Text('or'),
                  ),
                  Expanded(child: Divider()),
                ],
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _busy
                    ? null
                    : () => _run(
                          () => auth.signInWithOAuth(
                            OAuthProvider.google,
                            redirectTo: kIsWeb
                                ? null
                                : 'io.supabase.pocketbudget://login-callback',
                          ),
                          requireCredentials: false,
                        ),
                icon: const Icon(Icons.login),
                label: const Text('Continue with Google'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
