/**
 * ThemeService — Manages light/dark/system theme preferences.
 */
export class ThemeService {
  #store;

  constructor(store) { this.#store = store; }

  apply() {
    const mode = this.#store.getState().user?.theme || 'system';
    const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme:dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }

  toggle() {
    const cur = this.#store.getState().user?.theme || 'system';
    const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
    this.set(next);
    return next;
  }

  set(mode) {
    const state = this.#store.getState();
    if (!state.user) return mode;
    // Go through setState() so the change persists AND emits 'state:changed'.
    // Direct mutation + persist() bypassed the EventBus, so the UI never
    // reacted to theme changes (#15) — and toggle() (which calls set) shared
    // the same gap (#20).
    this.#store.setState((s) => {
      s.user = { ...s.user, theme: mode };
      return { user: s.user };
    });
    this.apply();
    return mode;
  }
}
