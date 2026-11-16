/**
 * InstallButton — the homepage's install buttons (the icon in the header and
 * "Install the app" under the headline).
 *
 * Shown only when Pocket can be installed and isn't yet: the browser has
 * offered (it stops offering once the app is installed), or this is an
 * iPhone / iPad. A tap opens the browser's install window; on iPhone it
 * shows the two steps to do it by hand.
 */
import { PwaService } from '../core/PwaService.js';

export class InstallButton {
  #buttons;
  #help;
  #pwa;

  /**
   * @param {Iterable<HTMLElement|null>} buttons
   * @param {HTMLElement|null} help   where the by-hand steps are shown
   * @param {PwaService} [pwa]
   */
  constructor(buttons, help, pwa = null) {
    this.#buttons = [...buttons].filter(Boolean);
    this.#help = help;
    this.#pwa = pwa || new PwaService({ win: window, onChange: () => this.#draw() });
  }

  start() {
    this.#pwa.start();
    for (const b of this.#buttons) b.addEventListener('click', () => this.#tap());
    this.#draw();
    return this;
  }

  async #tap() {
    const outcome = await this.#pwa.install();
    if (outcome === 'unavailable' && this.#help) {
      this.#help.textContent = `To install: ${this.#pwa.manualSteps}`;
      this.#help.hidden = false;
    }
    this.#draw();
  }

  #draw() {
    const show = this.#pwa.installable;
    for (const b of this.#buttons) b.hidden = !show;
    if (!show && this.#help) this.#help.hidden = true;
  }
}
