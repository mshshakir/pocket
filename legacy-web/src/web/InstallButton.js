/**
 * InstallButton — the homepage's "Install the app" button.
 *
 * When the browser has offered to install Pocket, a tap opens its install
 * window. Otherwise (iPhone, or a browser that makes no offer) a tap shows
 * the two steps to do it by hand. Hidden once Pocket is running as an
 * installed app.
 */
import { PwaService } from '../core/PwaService.js';

export class InstallButton {
  #button;
  #help;
  #pwa;

  /**
   * @param {HTMLElement|null} button
   * @param {HTMLElement|null} help   where the by-hand steps are shown
   * @param {PwaService} [pwa]
   */
  constructor(button, help, pwa = null) {
    this.#button = button;
    this.#help = help;
    this.#pwa = pwa || new PwaService({ win: window, onChange: () => this.#draw() });
  }

  start() {
    this.#pwa.start();
    if (!this.#button) return this;
    this.#button.addEventListener('click', () => this.#tap());
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
    if (!this.#button) return;
    this.#button.hidden = this.#pwa.installed;
    if (this.#pwa.installed && this.#help) this.#help.hidden = true;
  }
}
