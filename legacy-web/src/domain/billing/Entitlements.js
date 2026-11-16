/**
 * Entitlements — what the signed-in person's plan lets them do, as the server
 * reports it (pocket_entitlements(), migration 0018).
 *
 * The server is the authority: it enforces these rules on every save (phase
 * 2). This object only lets the app show the right thing — an upgrade prompt
 * instead of an error, a read-only banner while a plan is in its grace period.
 *
 * Access to a feature is one of:
 *   'write'  included and the plan is active
 *   'read'   included but the plan ended less than grace_days ago (read-only)
 *   'none'   not included, or the plan lapsed (Free)
 *
 * Free works fully on the device, with every export, so nothing here ever
 * blocks local use or exporting.
 *
 * AI (migration 0019): in your own book, your own unlimited flag or credits;
 * in a Family owner's shared space, the owner's unlimited flag, then their
 * pool, then your own credits.
 */
export class Entitlements {
  /** What AI costs until the server says otherwise (billing_settings, migration 0043). */
  static AI_COSTS = Object.freeze({ scan: 5, voice: 1, voiceSeconds: 30 });

  /**
   * Pocket Pro Group: the organiser ({role, size}) or a member ({role,
   * ownerName, ownerEmail}); null otherwise or when the answer is odd.
   */
  static #group(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = (v) => (typeof v === 'string' ? v.slice(0, 200) : '');
    if (raw.role === 'organiser') return { role: 'organiser', size: Number.isInteger(raw.size) && raw.size > 1 ? raw.size : 3 };
    if (raw.role === 'member') return { role: 'member', ownerName: text(raw.ownerName), ownerEmail: text(raw.ownerEmail) };
    return null;
  }

  /** The server's costs, each a whole number above zero, else the default. */
  static #costs(raw) {
    const pick = (k) => (Number.isInteger(raw?.[k]) && raw[k] > 0 ? raw[k] : Entitlements.AI_COSTS[k]);
    return { scan: pick('scan'), voice: pick('voice'), voiceSeconds: pick('voiceSeconds') };
  }

  static FEATURES = Object.freeze(['sync', 'telegram', 'sharing']);
  static STATES   = Object.freeze(['free', 'active', 'grace', 'lapsed']);
  static #LEVELS  = Object.freeze(['none', 'read', 'write']);

  #data;

  /** @param {object} data  the server's response, already validated by from() */
  constructor(data) {
    this.#data = Object.freeze(data);
  }

  /** The plan of someone not signed in, or before the server has answered. */
  static free() {
    return new Entitlements({
      plan: 'free', planName: 'Free', paidPlan: null, term: null, source: null,
      state: 'free', endsAt: null, graceUntil: null, autoRenew: false,
      access: { sync: 'none', telegram: 'none', sharing: 'none' },
      seats: 1, seatsUsed: 1, coveredBy: [], aiCredits: 0, aiUnlimited: false, trialAvailable: true,
      paymentsOpen: false,
      backup: false,
      group: null,
      aiCosts: { ...Entitlements.AI_COSTS },
    });
  }

  /**
   * Builds from pocket_entitlements() output. Anything missing or unknown
   * falls back to the Free answer, never to more access.
   * @param {object|null|undefined} raw
   */
  static from(raw) {
    const base = Entitlements.free().toJSON();
    if (!raw || typeof raw !== 'object') return new Entitlements(base);
    const level = (v) => (Entitlements.#LEVELS.includes(v) ? v : 'none');
    const access = {};
    for (const f of Entitlements.FEATURES) access[f] = level(raw.access?.[f]);
    const whole = (v, d) => (Number.isInteger(v) && v >= 0 ? v : d);
    return new Entitlements({
      plan:      typeof raw.plan === 'string' ? raw.plan : base.plan,
      planName:  typeof raw.planName === 'string' ? raw.planName : base.planName,
      paidPlan:  raw.paidPlan ?? null,
      term:      raw.term ?? null,
      source:    raw.source ?? null,
      state:     Entitlements.STATES.includes(raw.state) ? raw.state : 'free',
      endsAt:    raw.endsAt ?? null,
      graceUntil: raw.graceUntil ?? null,
      autoRenew: raw.autoRenew === true,
      access,
      seats:     whole(raw.seats, 1),
      seatsUsed: whole(raw.seatsUsed, 1),
      coveredBy: Array.isArray(raw.coveredBy)
        ? raw.coveredBy
            .filter((c) => c && typeof c.ownerId === 'string')
            .map((c) => Object.freeze({
              ownerId: c.ownerId, ownerEmail: c.ownerEmail ?? '', plan: c.plan ?? '', access: level(c.access),
              aiCredits: Number.isInteger(c.aiCredits) ? c.aiCredits : 0, aiUnlimited: c.aiUnlimited === true,
            }))
        : [],
      aiCredits: Number.isInteger(raw.aiCredits) ? raw.aiCredits : 0,
      aiUnlimited: raw.aiUnlimited === true,
      trialAvailable: raw.trialAvailable !== false,
      paymentsOpen: raw.paymentsOpen === true,
      backup: raw.backup === true,
      group: Entitlements.#group(raw.group),
      aiCosts: Entitlements.#costs(raw.aiCosts),
    });
  }

  get plan()           { return this.#data.plan; }
  get planName()       { return this.#data.planName; }
  get state()          { return this.#data.state; }
  get term()           { return this.#data.term; }
  get source()         { return this.#data.source; }
  get endsAt()         { return this.#data.endsAt ? new Date(this.#data.endsAt) : null; }
  get graceUntil()     { return this.#data.graceUntil ? new Date(this.#data.graceUntil) : null; }
  get seats()          { return this.#data.seats; }
  get seatsUsed()      { return this.#data.seatsUsed; }
  get seatsLeft()      { return Math.max(0, this.#data.seats - this.#data.seatsUsed); }
  /** Own credits (for a Family owner, also the pool for their shared space). */
  get aiCredits()      { return this.#data.aiCredits; }
  get aiUnlimited()    { return this.#data.aiUnlimited; }
  get trialAvailable() { return this.#data.trialAvailable; }
  /** Online payment is switched on (billing_settings.payments_enabled). */
  get paymentsOpen()   { return this.#data.paymentsOpen; }
  /** Pocket Pro Group: {role: 'organiser', size} or {role: 'member', ownerName, ownerEmail}, else null. */
  get group()          { return this.#data.group ? { ...this.#data.group } : null; }

  /** Scheduled and automatic Google Drive backups: the add-on was bought, or a paid plan includes it. */
  get backup()         { return this.#data.backup; }
  /** Credits a scan costs, and a voice entry per `voiceSeconds` of recording. @returns {{scan: number, voice: number, voiceSeconds: number}} */
  get aiCosts()        { return { ...this.#data.aiCosts }; }

  /** e.g. "A scan uses 5 credits; a voice entry uses 1 for every 30 seconds." */
  get aiCostLine() {
    const c = this.#data.aiCosts;
    const n = (x) => `${x} credit${x === 1 ? '' : 's'}`;
    return `A scan uses ${n(c.scan)}; a voice entry uses ${c.voice} for every ${c.voiceSeconds} seconds.`;
  }
  get isLifetime()     { return this.#data.term === 'lifetime' && this.#data.state === 'active'; }
  /** The plan ended recently: its features still show, but nothing can change. */
  get isReadOnly()     { return this.#data.state === 'grace'; }
  get isPaid()         { return this.#data.plan !== 'free'; }

  /** @param {'sync'|'telegram'|'sharing'} feature @returns {'write'|'read'|'none'} */
  access(feature) {
    if (!Entitlements.FEATURES.includes(feature)) throw new Error(`Unknown feature: ${feature}`);
    return this.#data.access[feature];
  }

  /** May use the feature fully (add, edit, delete). */
  can(feature) { return this.access(feature) === 'write'; }

  /** May at least see what the feature holds. */
  canSee(feature) { return this.access(feature) !== 'none'; }

  /**
   * Access to another person's shared accounts through their Family plan.
   * @param {string} ownerId
   * @returns {'write'|'read'|'none'}
   */
  sharedAccess(ownerId) {
    return this.#data.coveredBy.find((c) => c.ownerId === ownerId)?.access ?? 'none';
  }

  /** @returns {{ownerId: string, ownerEmail: string, plan: string, access: string, aiCredits: number, aiUnlimited: boolean}[]} */
  get coveredBy() { return [...this.#data.coveredBy]; }

  /**
   * Who would pay for one AI use, mirroring pocket_ai_spend on the server.
   * @param {string|null} [sharedOwnerId]  the owner, when working in their shared space
   * @returns {'unlimited'|'family'|'own'|null}  null: no credits (or no access to that space)
   */
  aiPayer(sharedOwnerId = null) {
    if (sharedOwnerId) {
      const c = this.#data.coveredBy.find((x) => x.ownerId === sharedOwnerId);
      if (!c || c.access !== 'write') return null;
      if (c.aiUnlimited || this.#data.aiUnlimited) return 'unlimited';
      if (c.aiCredits >= 1) return 'family';
      return this.#data.aiCredits >= 1 ? 'own' : null;
    }
    if (this.#data.aiUnlimited) return 'unlimited';
    return this.#data.aiCredits >= 1 ? 'own' : null;
  }

  /** Whether one more AI use is paid for, in your own book or in an owner's shared space. */
  canUseAi(sharedOwnerId = null) { return this.aiPayer(sharedOwnerId) !== null; }

  /** A plain copy (the data is plain JSON, so a JSON round-trip copies it fully). */
  toJSON() {
    return JSON.parse(JSON.stringify(this.#data));
  }
}
