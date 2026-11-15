/**
 * FeedbackModal — send feedback or a feature idea to the Pocket team.
 * Messages land in the admin dashboard (Feedback tab); nothing from the
 * book is attached, only the text and the screen it was sent from.
 *
 * opts: { kind?: 'feedback'|'feature' }
 */
export class FeedbackModal {
  /** @type {() => boolean} */ #signedIn;

  /** @param {{signedIn: () => boolean}} deps */
  constructor({ signedIn }) {
    this.#signedIn = signedIn;
  }

  /** The textarea's hint for each kind. */
  static placeholder(kind) {
    return kind === 'feature'
      ? 'What would you like Pocket to do? What would it help you with?'
      : 'What’s working, what isn’t, or anything that confused you…';
  }

  render(opts = {}) {
    const kind  = opts.kind === 'feature' ? 'feature' : 'feedback';
    const close = `<button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>`;
    if (!this.#signedIn()) {
      return `
        <div class="p-5">
          <div class="flex items-center justify-between mb-3"><h3 class="text-lg font-semibold">Feedback &amp; ideas</h3>${close}</div>
          <p class="text-sm text-zinc-500 mb-4">Sign in to send feedback, so we know who to reply to.</p>
          <button class="btn btn-primary w-full justify-center" onclick="window.__app.closeModal(); window.__app.openModal('auth',{})"><i data-lucide="log-in"></i> Sign in</button>
        </div>`;
    }
    const kindBtn = (k, icon, label) => `
      <button type="button" data-feedback-kind="${k}" class="btn ${k === kind ? 'btn-primary' : 'btn-outline'} justify-center"
              onclick="window.__app.setFeedbackKind('${k}')"><i data-lucide="${icon}"></i> ${label}</button>`;
    return `
      <form onsubmit="window.__app.sendFeedback(event)" class="p-5 feedback-form">
        <div class="flex items-center justify-between mb-3"><h3 class="text-lg font-semibold">Feedback &amp; ideas</h3>${close}</div>
        <input type="hidden" name="kind" value="${kind}">
        <div class="grid grid-cols-2 gap-2 mb-3">
          ${kindBtn('feedback', 'message-circle', 'Feedback')}
          ${kindBtn('feature', 'lightbulb', 'Feature idea')}
        </div>
        <textarea class="textarea" name="message" rows="6" maxlength="2000" required autofocus
                  placeholder="${FeedbackModal.placeholder(kind)}"></textarea>
        <div class="text-xs text-zinc-500 mt-1 mb-4">Only your message and your email are sent — nothing from your book.</div>
        <div class="flex items-center gap-2">
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="send"></i> Send</button>
        </div>
      </form>`;
  }
}
