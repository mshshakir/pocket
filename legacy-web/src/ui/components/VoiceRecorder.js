/**
 * VoiceRecorder — a thin, self-contained wrapper around the browser's
 * MediaRecorder API for capturing a short microphone clip.
 *
 * This is a UI-layer concern (the *capture* mechanism differs per platform —
 * MediaRecorder on web, expo-audio on mobile), while the *interpretation* of
 * the clip lives in the shared domain service (ReceiptScanService.parseVoice).
 * Keeping capture here preserves that separation.
 *
 * Lifecycle: start() → (user speaks) → stop() resolves with an audio Blob.
 * The instance is single-use per recording; create a fresh one each time or
 * call start() again after a completed stop().
 *
 * OOP notes:
 *  - All transient state (stream, recorder, chunks) is private.
 *  - Public surface: `recording` getter, `start()`, `stop()`, `cancel()`.
 */
export class VoiceRecorder {
  /** @type {MediaStream|null} */    #stream = null;
  /** @type {MediaRecorder|null} */  #rec    = null;
  /** @type {Blob[]} */              #chunks = [];
  /** @type {AudioContext|null} */   #ctx      = null;
  /** @type {AnalyserNode|null} */   #analyser = null;
  /** @type {Uint8Array|null} */     #timeData = null;

  /** True while actively capturing audio. */
  get recording() {
    return !!this.#rec && this.#rec.state === 'recording';
  }

  /** Pick a mime type the browser can actually record. */
  static #pickMime() {
    const MR = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
    if (!MR || !MR.isTypeSupported) return '';
    // Gemini accepts ogg/webm/mp4-aac; prefer the widely supported ones.
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
      if (MR.isTypeSupported(m)) return m;
    }
    return '';
  }

  /**
   * Request the microphone and begin recording.
   * @throws {Error} if the API is unavailable or permission is denied.
   */
  async start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Voice recording is not supported in this browser.');
    }
    this.#stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.#chunks = [];

    // Tap the stream with a Web Audio AnalyserNode so the UI can show a live
    // level meter. Purely for visual feedback — it is NOT connected to the
    // audio destination, so nothing is played back (no echo).
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this.#ctx = new AC();
        if (this.#ctx.state === 'suspended') { try { await this.#ctx.resume(); } catch (_) {} }
        this.#analyser = this.#ctx.createAnalyser();
        this.#analyser.fftSize = 512;
        this.#analyser.smoothingTimeConstant = 0.7;
        this.#ctx.createMediaStreamSource(this.#stream).connect(this.#analyser);
        this.#timeData = new Uint8Array(this.#analyser.fftSize);
      }
    } catch (_) { /* metering is best-effort; recording still works without it */ }

    const mimeType = VoiceRecorder.#pickMime();
    this.#rec = mimeType
      ? new MediaRecorder(this.#stream, { mimeType })
      : new MediaRecorder(this.#stream);
    this.#rec.ondataavailable = (e) => { if (e.data && e.data.size) this.#chunks.push(e.data); };
    this.#rec.start();
  }

  /**
   * Stop recording and resolve with the captured audio as a Blob.
   * Always releases the microphone.
   * @returns {Promise<Blob>}
   */
  stop() {
    return new Promise((resolve, reject) => {
      if (!this.#rec) { this.#cleanup(); return reject(new Error('Not recording')); }
      const rec = this.#rec;
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(this.#chunks, { type });
        this.#cleanup();
        resolve(blob);
      };
      try { rec.stop(); }
      catch (e) { this.#cleanup(); reject(e); }
    });
  }

  /**
   * Current microphone loudness as a normalised 0..1 value (RMS of the
   * time-domain waveform, amplified into a useful visual range). Returns 0
   * when metering is unavailable. Cheap enough to call every animation frame.
   * @returns {number}
   */
  getLevel() {
    if (!this.#analyser || !this.#timeData) return 0;
    this.#analyser.getByteTimeDomainData(this.#timeData);
    let sum = 0;
    for (let i = 0; i < this.#timeData.length; i++) {
      const v = (this.#timeData[i] - 128) / 128; // -1..1
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.#timeData.length); // 0..~1
    return Math.max(0, Math.min(1, rms * 3.2));         // amplify quiet speech
  }

  /** Abort recording and release the microphone without producing a Blob. */
  cancel() {
    try { if (this.#rec && this.#rec.state !== 'inactive') this.#rec.stop(); } catch (_) {}
    this.#cleanup();
  }

  /** Stop all media tracks and reset state. */
  #cleanup() {
    if (this.#stream) { try { this.#stream.getTracks().forEach((t) => t.stop()); } catch (_) {} }
    if (this.#ctx)    { try { this.#ctx.close(); } catch (_) {} }
    this.#stream = null;
    this.#rec = null;
    this.#ctx = null;
    this.#analyser = null;
    this.#timeData = null;
  }
}
