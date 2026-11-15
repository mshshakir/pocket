/**
 * LockView — shown instead of the book when it belongs to a Pocket account
 * but nobody is signed in (the sign-in lapsed on its own). Nothing is deleted:
 * signing in with the same account opens it again, unsynced entries included.
 * Signing in with another account sets this book aside (ParkedBooks) and
 * hands it back the next time its owner signs in here.
 *
 * Also renders the short "Opening your book…" state while the app checks
 * whether there is a session, so the book never flashes before the lock.
 */
export class LockView {
  /** @param {{opening?: boolean, online?: boolean}} [opts] */
  render({ opening = false, online = true } = {}) {
    if (opening) {
      return `
        <div class="lock-screen opening min-h-[60vh] grid place-items-center text-center px-6">
          <div>
            <div class="mx-auto w-12 h-12 rounded-2xl grid place-items-center bg-zinc-100 dark:bg-zinc-800 animate-pulse"><i data-lucide="wallet"></i></div>
            <div class="mt-4 text-sm text-zinc-500">Opening your book…</div>
          </div>
        </div>`;
    }
    return `
      <div class="lock-screen min-h-[70vh] grid place-items-center text-center px-6">
        <div class="max-w-sm">
          <div class="mx-auto w-14 h-14 rounded-2xl grid place-items-center bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"><i data-lucide="lock"></i></div>
          <h1 class="mt-5 text-2xl font-semibold tracking-tight">Your book is locked</h1>
          <p class="mt-2 text-sm text-zinc-500">Your sign-in has expired. Sign in with the same Google account to open it — everything on this phone is kept, including entries that haven’t synced yet.</p>
          ${online ? '' : '<p class="mt-3 text-sm text-amber-600">You’re offline. Connect to the internet to sign in.</p>'}
          <button class="btn btn-primary w-full justify-center mt-6 py-3 lock-signin" onclick="window.__app.openModal('auth',{})">
            <i data-lucide="log-in"></i> Sign in
          </button>
          <p class="mt-4 text-xs text-zinc-400">Signing in with a different account keeps this book aside for its owner.</p>
        </div>
      </div>`;
  }
}
