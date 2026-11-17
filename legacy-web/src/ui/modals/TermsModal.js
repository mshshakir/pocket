/**
 * TermsModal — asks someone already signed in to agree to Pocket's Terms and
 * Privacy Policy (migration 0061): for accounts made before agreeing was
 * asked, or after the Terms change.
 */
export class TermsModal {
  #saving = false;
  #error = '';
  #changed = false;

  /** @param {{changed?: boolean}} [o]  changed: they agreed to an earlier version */
  open(o = {}) {
    this.#changed = !!o.changed;
    this.#saving = false;
    this.#error = '';
  }

  set saving(on) { this.#saving = !!on; }
  set error(msg) { this.#error = String(msg || ''); }

  render() {
    return `
      <div class="p-5 terms-modal" style="max-width:420px">
        <span class="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 grid place-items-center mb-3"><i data-lucide="file-check" style="width:20px;height:20px"></i></span>
        <h3 class="text-lg font-semibold mb-1">${this.#changed ? 'Our Terms have changed' : 'Pocket\'s Terms and Privacy Policy'}</h3>
        <p class="text-sm text-zinc-500 leading-relaxed mb-4">${this.#changed
          ? 'Please take a moment to read the updated Terms and Privacy Policy.'
          : 'They explain what Pocket does with your data and how payments and refunds work.'}
          To keep using Pocket, please agree to them.</p>
        <div class="flex gap-3 text-sm mb-4">
          <a href="terms.html" target="_blank" class="underline">Terms and Conditions</a>
          <a href="privacy.html" target="_blank" class="underline">Privacy Policy</a>
        </div>
        ${this.#error ? `<div class="text-sm text-rose-600 mb-3 terms-error">${this.#error.replace(/[<>&]/g, '')}</div>` : ''}
        <button class="btn btn-primary w-full justify-center terms-agree" ${this.#saving ? 'disabled' : ''} onclick="window.__app.agreeToTerms()">${this.#saving ? 'Saving…' : 'I agree, continue'}</button>
      </div>`;
  }
}
