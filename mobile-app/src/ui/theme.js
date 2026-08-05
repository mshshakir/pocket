/**
 * theme — the web app's zinc palette, now theme-aware (light / dark).
 *
 * `colors` is a LIVE object: screens import it by reference and read its keys
 * at render time. `applyTheme()` mutates those keys in place, so switching
 * theme + forcing one re-render (via the Store's EventBus) restyles the whole
 * app without every screen needing a context subscription.
 */
export const LIGHT = Object.freeze({
  bg:        '#fafafa',
  card:      '#ffffff',
  border:    '#e4e4e7',
  text:      '#09090b',
  subtle:    '#71717a',
  faint:     '#a1a1aa',
  primary:   '#09090b',
  primaryFg: '#fafafa',
  green:     '#10b981',
  red:       '#ef4444',
  rose:      '#f43f5e',
  amber:     '#f59e0b',
  indigo:    '#818cf8',
  muted:     '#f4f4f5',
});

export const DARK = Object.freeze({
  bg:        '#09090b',
  card:      '#18181b',
  border:    '#27272a',
  text:      '#fafafa',
  subtle:    '#a1a1aa',
  faint:     '#71717a',
  primary:   '#fafafa',
  primaryFg: '#09090b',
  green:     '#10b981',
  red:       '#f87171',
  rose:      '#fb7185',
  amber:     '#fbbf24',
  indigo:    '#818cf8',
  muted:     '#27272a',
});

// Live palette — starts light, mutated in place by applyTheme().
export const colors = { ...LIGHT };

let activeScheme = 'light';
export function activeThemeScheme() { return activeScheme; }

/**
 * Apply a theme.
 * @param {'light'|'dark'|'system'} mode
 * @param {'light'|'dark'} systemScheme  resolved OS scheme, used when mode==='system'
 */
export function applyTheme(mode, systemScheme = 'light') {
  const scheme = mode === 'system' ? (systemScheme || 'light') : mode;
  const palette = scheme === 'dark' ? DARK : LIGHT;
  Object.assign(colors, palette);
  activeScheme = scheme;
  return scheme;
}

export const radius = { card: 14, control: 10, pill: 999 };
