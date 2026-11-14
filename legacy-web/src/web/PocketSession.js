/**
 * PocketSession — sign-in and server calls for Pocket's standalone pages
 * (programme.html, admin.html). It uses the same Supabase project and the
 * same browser session as the app, so someone signed in to the app is
 * signed in here too.
 */
import { APP_SUPABASE_URL, APP_SUPABASE_KEY } from '../data/constants.js';

export class PocketSession {
  /** @type {any} */ #sb;

  /** @param {any} [factory]  window.supabase (replaceable in tests) */
  constructor(factory = globalThis.supabase) {
    if (!factory?.createClient) throw new Error('Supabase did not load. Check your connection and reload.');
    this.#sb = factory.createClient(APP_SUPABASE_URL, APP_SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }

  /** The signed-in user ({id, email, user_metadata}) or null. */
  async user() {
    const { data } = await this.#sb.auth.getSession();
    return data?.session?.user ?? null;
  }

  /** Calls back when someone signs in or out (e.g. returning from Google). */
  onChange(callback) {
    this.#sb.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
  }

  /** Google sign-in, coming back to this same page. */
  async signIn() {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await this.#sb.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    if (error) throw new Error(error.message);
  }

  async signOut() {
    await this.#sb.auth.signOut().catch(() => {});
  }

  /** A database function; throws an Error with the server's own sentence. */
  async rpc(name, args = {}) {
    const { data, error } = await this.#sb.rpc(name, args);
    if (error) throw new Error(PocketSession.#tidy(error.message));
    return data;
  }

  /** supabase.functions.invoke for the signed-in person (for PaymentService). */
  invoker() {
    return (name, opts) => this.#sb.functions.invoke(name, opts);
  }

  static #tidy(message = '') {
    return message.replace(/^.*?ERROR:\s*/i, '').trim() || 'Something went wrong. Please try again.';
  }
}
