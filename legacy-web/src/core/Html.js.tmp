/**
 * Html — context-aware escaping helpers.
 *
 * The app renders by interpolating values into HTML template strings that are
 * assigned via innerHTML. Some of those values are untrusted (transaction
 * payees/notes/ids, category colours/icons, and — critically — records pulled
 * from OTHER users via family sharing). Escaping must therefore be applied per
 * sink, not just for text nodes:
 *
 *   - escape()  → text and quoted-attribute content
 *   - js()      → values interpolated inside an inline event-handler string
 *   - color()   → only a valid CSS hex colour passes; otherwise a safe default
 *   - icon()    → only a Lucide-style icon slug passes; otherwise a safe default
 *
 * Centralising this removes the three duplicated escape() copies that used to
 * live in BaseView, Navigation, and TransactionRowRenderer.
 */
export class Html {
  /**
   * Escape text / double-quoted attribute content.
   * @param {*} s
   * @returns {string}
   */
  static escape(s) {
    return (s ?? '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }

  /**
   * Escape a value that will sit inside a single-quoted JavaScript string in an
   * inline handler, e.g. onclick="fn('${Html.js(id)}')". Neutralises quote and
   * tag breakouts so a hostile id/string can't terminate the handler or inject
   * markup.
   * @param {*} s
   * @returns {string}
   */
  static js(s) {
    return (s ?? '')
      .toString()
      .replace(/\\/g, '\\\\')
      .replace(/'/g, '\\u0027')
      .replace(/"/g, '\\u0022')
      .replace(/</g, '\\u003C')
      .replace(/>/g, '\\u003E')
      .replace(/&/g, '\\u0026')
      .replace(/\r?\n/g, '');
  }

  /**
   * Validate a CSS hex colour; fall back to a neutral grey when invalid.
   * @param {*} c
   * @param {string} [fallback='#71717a']
   * @returns {string}
   */
  static color(c, fallback = '#71717a') {
    return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : fallback;
  }

  /**
   * Validate a Lucide icon slug (lowercase letters + hyphens); fall back safely.
   * @param {*} name
   * @param {string} [fallback='circle']
   * @returns {string}
   */
  static icon(name, fallback = 'circle') {
    return /^[a-z][a-z0-9-]*$/.test(name || '') ? name : fallback;
  }
}
