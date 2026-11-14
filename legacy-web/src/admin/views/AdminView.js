/**
 * AdminView — one tab of the dashboard. A view loads its data, renders HTML,
 * and handles the buttons and forms inside it (data-action / data-form).
 */
export class AdminView {
  /** @type {import('../AdminApi.js').AdminApi} */ api;
  /** @type {{toast: (msg: string) => void, refresh: () => Promise<void>}} */ host;

  constructor(api, host) {
    this.api = api;
    this.host = host;
  }

  /** The tab's name in the menu. */
  get title() { throw new Error('title not implemented'); }

  /** Loads (or reloads) what the tab shows. */
  async load() {}

  /** @returns {string} */
  html() { throw new Error('html not implemented'); }

  /**
   * A button with data-action was pressed (or a form with data-form sent).
   * @param {string} action
   * @param {HTMLElement} el      the element carrying data-action / the form
   * @param {FormData|null} form  the form's fields, for data-form
   * @returns {Promise<boolean>}  true when the tab should be redrawn
   */
  async act(action, el, form) { return false; } // eslint-disable-line no-unused-vars

  /** Reads a form field as trimmed text. */
  static text(form, name) { return String(form?.get(name) ?? '').trim(); }
}
