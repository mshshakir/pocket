/**
 * VoiceOverlay — full-screen feedback for voice entry.
 *
 * Two visual states:
 *   1. "listening"  — a row of bars that rise and fall with the live mic level
 *                     (fed by VoiceRecorder.getLevel()), a running timer, and
 *                     Stop / Cancel controls, so the user can SEE they are heard.
 *   2. "processing" — bars fade to a pulsing ring while Gemini transcribes.
 *
 * It owns its own DOM (appended to <body>) and its own animation loop, so the
 * app's re-renders never disturb it. The caller wires two callbacks:
 *   onStop()   — user finished speaking; caller should stop + transcribe
 *   onCancel() — user abandoned; caller should discard the recording
 *
 * OOP notes: all DOM refs and the rAF handle are private; the public surface is
 * open(), setProcessing(), close(), and the onStop/onCancel callback setters.
 */
export class VoiceOverlay {
  #el = null;
  #barsEl = null;
  #timerEl = null;
  #titleEl = null;
  #subEl = null;
  #stopBtn = null;
  #ring = null;
  #raf = 0;
  #startTs = 0;
  #getLevel = () => 0;
  onStop = () => {};
  onCancel = () => {};

  static #BAR_COUNT = 13;
  static #styleInjected = false;

  /** Inject the keyframes/spinner CSS once per page. */
  static #injectStyle() {
    if (VoiceOverlay.#styleInjected) return;
    VoiceOverlay.#styleInjected = true;
    const s = document.createElement('style');
    s.textContent = `
      @keyframes pv-fade-in { from { opacity: 0 } to { opacity: 1 } }
      @keyframes pv-pop { from { transform: scale(.94); opacity: 0 } to { transform: scale(1); opacity: 1 } }
      @keyframes pv-spin { to { transform: rotate(360deg) } }
      @keyframes pv-dot { 0%,80%,100% { opacity:.25 } 40% { opacity:1 } }
      .pv-ov { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center;
               justify-content: center; background: rgba(0,0,0,.62); backdrop-filter: blur(6px);
               -webkit-backdrop-filter: blur(6px); animation: pv-fade-in .16s ease-out; }
      .pv-card { width: min(88vw, 340px); background: #18181b; border: 1px solid #27272a;
                 border-radius: 22px; padding: 26px 22px 22px; text-align: center; color: #fafafa;
                 box-shadow: 0 24px 60px rgba(0,0,0,.5); animation: pv-pop .18s ease-out; position: relative; }
      .pv-x { position: absolute; top: 12px; right: 14px; width: 30px; height: 30px; border: none;
              background: transparent; color: #a1a1aa; font-size: 22px; line-height: 1; cursor: pointer;
              border-radius: 8px; }
      .pv-x:hover { background: #27272a; color: #fafafa; }
      .pv-title { font-size: 17px; font-weight: 650; letter-spacing: .2px; }
      .pv-sub { font-size: 12.5px; color: #a1a1aa; margin-top: 4px; min-height: 17px; }
      .pv-bars { display: flex; align-items: center; justify-content: center; gap: 4px;
                 height: 84px; margin: 20px 0 14px; }
      .pv-bar { width: 6px; height: 8px; border-radius: 4px;
                background: linear-gradient(#34d399, #10b981); transition: height .07s linear; }
      .pv-timer { font-variant-numeric: tabular-nums; font-size: 13px; color: #d4d4d8; letter-spacing: .5px; }
      .pv-stop { margin-top: 16px; width: 100%; padding: 12px; border: none; border-radius: 14px;
                 background: #10b981; color: #052e22; font-weight: 700; font-size: 15px; cursor: pointer; }
      .pv-stop:hover { background: #34d399; }
      .pv-proc { height: 84px; margin: 20px 0 14px; display: flex; align-items: center; justify-content: center; }
      .pv-ring { width: 48px; height: 48px; border-radius: 50%; border: 4px solid #27272a;
                 border-top-color: #10b981; animation: pv-spin .8s linear infinite; }
      .pv-dots span { animation: pv-dot 1.2s infinite both; }
      .pv-dots span:nth-child(2) { animation-delay: .2s }
      .pv-dots span:nth-child(3) { animation-delay: .4s }
    `;
    document.head.appendChild(s);
  }

  /** Build and show the overlay in the "listening" state. */
  open(getLevel) {
    VoiceOverlay.#injectStyle();
    this.#getLevel = typeof getLevel === 'function' ? getLevel : () => 0;

    const bars = Array.from({ length: VoiceOverlay.#BAR_COUNT })
      .map(() => '<span class="pv-bar"></span>').join('');

    this.#el = document.createElement('div');
    this.#el.className = 'pv-ov';
    this.#el.innerHTML = `
      <div class="pv-card" role="dialog" aria-label="Voice entry">
        <button class="pv-x" aria-label="Cancel">&times;</button>
        <div class="pv-title">Listening…</div>
        <div class="pv-sub">Say the transaction, then tap Stop</div>
        <div class="pv-bars">${bars}</div>
        <div class="pv-proc" style="display:none"><div class="pv-ring"></div></div>
        <div class="pv-timer">0:00</div>
        <button class="pv-stop">■ Stop &amp; read</button>
      </div>`;

    this.#barsEl  = this.#el.querySelector('.pv-bars');
    this.#timerEl = this.#el.querySelector('.pv-timer');
    this.#titleEl = this.#el.querySelector('.pv-title');
    this.#subEl   = this.#el.querySelector('.pv-sub');
    this.#stopBtn = this.#el.querySelector('.pv-stop');
    this.#ring    = this.#el.querySelector('.pv-proc');

    this.#stopBtn.addEventListener('click', () => this.onStop());
    this.#el.querySelector('.pv-x').addEventListener('click', () => this.onCancel());
    // Backdrop click cancels; card click does not bubble to it.
    this.#el.addEventListener('click', (e) => { if (e.target === this.#el) this.onCancel(); });
    this.#el.querySelector('.pv-card').addEventListener('click', (e) => e.stopPropagation());

    document.body.appendChild(this.#el);
    this.#startTs = Date.now();
    this.#startMeter();
  }

  /** Drive the bars from the live level + a travelling wave, and tick the timer. */
  #startMeter() {
    const bars = this.#barsEl ? Array.from(this.#barsEl.children) : [];
    const n = bars.length;
    const tick = () => {
      const level = this.#getLevel();          // 0..1
      const now = Date.now();
      for (let i = 0; i < n; i++) {
        // taller toward the centre; a moving sine makes it feel alive even when quiet
        const centre = 1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2); // 0..1
        const wave = 0.5 + 0.5 * Math.sin(now / 130 + i * 0.7);       // 0..1
        const h = 6 + 6 * wave + level * 60 * (0.35 + 0.65 * centre) * (0.5 + 0.5 * wave);
        bars[i].style.height = h.toFixed(1) + 'px';
      }
      const secs = Math.floor((now - this.#startTs) / 1000);
      if (this.#timerEl) this.#timerEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  /** Switch to the "processing / transcribing" state. */
  setProcessing() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    if (!this.#el) return;
    if (this.#barsEl)  this.#barsEl.style.display = 'none';
    if (this.#ring)    this.#ring.style.display = 'flex';
    if (this.#stopBtn) this.#stopBtn.style.display = 'none';
    if (this.#timerEl) this.#timerEl.style.display = 'none';
    if (this.#titleEl) this.#titleEl.textContent = 'Transcribing…';
    if (this.#subEl)   this.#subEl.innerHTML = 'Reading your transaction<span class="pv-dots"><span>.</span><span>.</span><span>.</span></span>';
    const x = this.#el.querySelector('.pv-x');
    if (x) x.style.display = 'none';   // no cancel once the clip is on its way
  }

  /** Tear down: stop the loop and remove the DOM. Safe to call repeatedly. */
  close() {
    if (this.#raf) { cancelAnimationFrame(this.#raf); this.#raf = 0; }
    if (this.#el && this.#el.parentNode) this.#el.parentNode.removeChild(this.#el);
    this.#el = null;
  }
}
