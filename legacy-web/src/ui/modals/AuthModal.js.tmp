/**
 * AuthModal — Google OAuth sign-in / cloud-sync gateway.
 * Renders a single "Continue with Google" button.
 */
import { Store } from '../../core/Store.js';

export class AuthModal {
  /** @type {Store} */ #store;

  constructor() {
    this.#store = Store.getInstance();
  }

  render() {
    const state  = this.#store.getState();
    const isSaaS = window.__app?.isManagedMode?.() ?? true;
    const hasUrl = !!state.user.supabaseUrl;

    return `
      <div class="p-5" style="min-width:320px">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-lg font-semibold">Cloud sync</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        ${(!isSaaS && !hasUrl) ? `
          <div class="card-muted p-4 mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            <strong>Setup needed:</strong> Add your Supabase project URL and anon key in
            <button class="underline"
                    onclick="window.__app.closeModal(); window.__app.openModal('settings',{})">
              Settings → Cloud sync
            </button>
            first.
          </div>
        ` : ''}

        <!-- Google OAuth — only sign-in method -->
        <button onclick="window.__app.signInWithGoogle()"
                class="btn btn-outline w-full justify-center gap-3 mb-5"
                style="height:44px;font-size:.95rem">
          <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.84l6.08-6.08C34.36 3.09 29.45 1 24 1 14.82 1 7.07 6.48 3.64 14.22l7.08 5.5C12.4 13.72 17.73 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.1 24.5c0-1.64-.15-3.22-.42-4.74H24v8.98h12.43c-.54 2.9-2.18 5.36-4.64 7.02l7.18 5.58C43.27 37.26 46.1 31.35 46.1 24.5z"/>
            <path fill="#FBBC05" d="M10.72 28.28A14.6 14.6 0 0 1 9.5 24c0-1.49.26-2.94.72-4.28l-7.08-5.5A23.94 23.94 0 0 0 .5 24c0 3.86.92 7.5 2.64 10.72l7.58-6.44z"/>
            <path fill="#34A853" d="M24 47c5.45 0 10.02-1.8 13.36-4.9l-7.18-5.58c-1.98 1.33-4.5 2.12-6.18 2.12-6.27 0-11.6-4.22-13.28-9.94l-7.58 6.44C7.07 41.52 14.82 47 24 47z"/>
          </svg>
          Continue with Google
        </button>

        <div class="text-xs text-zinc-400 text-center">
          ${isSaaS
            ? 'Your data is encrypted and privately stored. Only you can access it.'
            : 'Your data is end-to-end owned by you. Stored in your own Supabase project.'}
        </div>
      </div>`;
  }
}
