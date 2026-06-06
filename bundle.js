var _PocketApp = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/app.js
  var app_exports = {};
  __export(app_exports, {
    Application: () => Application
  });

  // src/core/EventBus.js
  var EventBus = class _EventBus {
    /** @type {EventBus|null} */
    static #instance = null;
    /** @type {Map<string, Set<Function>>} */
    #handlers = /* @__PURE__ */ new Map();
    constructor() {
      if (_EventBus.#instance) {
        throw new Error("EventBus is a singleton \u2014 use EventBus.getInstance()");
      }
    }
    /** @returns {EventBus} */
    static getInstance() {
      if (!_EventBus.#instance) {
        _EventBus.#instance = new _EventBus();
      }
      return _EventBus.#instance;
    }
    /**
     * Subscribe to an event.
     * @param {string} event
     * @param {Function} handler
     * @returns {() => void} unsubscribe function
     */
    on(event, handler) {
      if (!this.#handlers.has(event)) {
        this.#handlers.set(event, /* @__PURE__ */ new Set());
      }
      this.#handlers.get(event).add(handler);
      return () => this.off(event, handler);
    }
    /**
     * Subscribe to an event exactly once; auto-removes after first fire.
     * @param {string} event
     * @param {Function} handler
     */
    once(event, handler) {
      const wrapper = (data) => {
        handler(data);
        this.off(event, wrapper);
      };
      this.on(event, wrapper);
    }
    /**
     * Remove a specific handler.
     * @param {string} event
     * @param {Function} handler
     */
    off(event, handler) {
      this.#handlers.get(event)?.delete(handler);
    }
    /**
     * Broadcast an event to all subscribers.
     * @param {string} event
     * @param {*} [data]
     */
    emit(event, data) {
      const handlers = this.#handlers.get(event);
      if (!handlers) return;
      for (const fn of [...handlers]) {
        try {
          fn(data);
        } catch (err) {
          console.error(`[EventBus] Error in handler for "${event}":`, err);
        }
      }
    }
    /** Remove all handlers (useful for testing). */
    clear() {
      this.#handlers.clear();
    }
  };

  // src/core/Repository.js
  var Repository = class _Repository {
    static #STORAGE_KEY = "pocket.v1";
    static #BACKUP_KEY = "pocket.v1.corrupt";
    /** True if the last load() hit corrupt data (so callers can warn the user). */
    lastLoadCorrupted = false;
    /**
     * Persist the entire application state snapshot.
     * @param {object} state
     */
    save(state) {
      try {
        localStorage.setItem(_Repository.#STORAGE_KEY, JSON.stringify(state));
        return true;
      } catch (err) {
        console.error("[Repository] Failed to save state:", err);
        return false;
      }
    }
    /**
     * Load persisted state or return null when nothing has been saved yet.
     * @returns {object|null}
     */
    load() {
      this.lastLoadCorrupted = false;
      const raw = localStorage.getItem(_Repository.#STORAGE_KEY);
      if (raw == null) return null;
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.error("[Repository] Corrupt persisted state \u2014 backed up to", _Repository.#BACKUP_KEY, err);
        try {
          localStorage.setItem(_Repository.#BACKUP_KEY, raw);
        } catch (_) {
        }
        this.lastLoadCorrupted = true;
        return null;
      }
    }
    /**
     * Wipe all persisted data (logout / reset).
     */
    clear() {
      localStorage.removeItem(_Repository.#STORAGE_KEY);
    }
  };

  // src/core/Store.js
  var Store = class _Store {
    /** @type {Store|null} */
    static #instance = null;
    /** @type {object} */
    #state;
    /** @type {Repository} */
    #repository;
    /** @type {EventBus} */
    #bus;
    /** Guards against repeating the storage-failure toast on every save. */
    #saveWarned = false;
    /**
     * Optional hook run immediately before every persist. Used to recompute
     * derived data (account balances) so the stored/emitted state is always a
     * pure function of the ledger. Injected by the Application root to avoid the
     * core layer depending on a domain service.
     * @type {(() => void)|null}
     */
    #derive = null;
    /** Monotonic revision counter, bumped on every persist (cache-key friendly). */
    #revision = 0;
    constructor() {
      if (_Store.#instance) {
        throw new Error("Store is a singleton \u2014 use Store.getInstance()");
      }
      this.#repository = new Repository();
      this.#bus = EventBus.getInstance();
    }
    /**
     * Register the derive hook (e.g. () => accountService.recompute()).
     * @param {() => void} fn
     */
    setDeriveHook(fn) {
      this.#derive = fn;
    }
    /** @returns {number} current state revision */
    get revision() {
      return this.#revision;
    }
    /** @returns {boolean} true if the last load() encountered corrupt data */
    get repositoryCorrupted() {
      return !!this.#repository.lastLoadCorrupted;
    }
    /** @returns {Store} */
    static getInstance() {
      if (!_Store.#instance) {
        _Store.#instance = new _Store();
      }
      return _Store.#instance;
    }
    // ── Initialisation ──────────────────────────────────────────────────
    /**
     * Boot the store: load persisted state or fall back to the seed factory.
     * @param {Function} seedFactory - () => object  called when no persisted data exists
     * @param {Function} migrateDefaults - (state) => void  back-fills new fields
     */
    init(seedFactory, migrateDefaults = () => {
    }) {
      const persisted = this.#repository.load();
      this.#state = persisted ?? seedFactory();
      migrateDefaults(this.#state);
      return this;
    }
    // ── State access ────────────────────────────────────────────────────
    /**
     * Return a reference to the current state.
     * Callers should treat this as read-only; all mutations go through setState().
     * @returns {object}
     */
    getState() {
      return this.#state;
    }
    /**
     * Apply a mutation to state, persist it, and notify subscribers.
     *
     * Accepts either a plain partial object (shallow-merged) or an updater
     * function that receives the current state and returns a partial update.
     *
     * @param {object|Function} updaterOrPartial
     * @param {object} [options]
     * @param {boolean} [options.silent=false] - skip event emission (batch mode)
     */
    setState(updaterOrPartial, { silent = false } = {}) {
      const patch = typeof updaterOrPartial === "function" ? updaterOrPartial(this.#state) : updaterOrPartial;
      Object.assign(this.#state, patch);
      this.#persistState();
      if (!silent) {
        this.#bus.emit("state:changed", this.#state);
      }
    }
    /**
     * Replace the entire state (used by cloud sync after a remote pull).
     * Runs the supplied migration FIRST so a cloud snapshot from an older schema
     * is brought current before any view or service touches it.
     *
     * The replacement is applied IN PLACE (keys cleared, then copied) so the state
     * object's identity is preserved. Async callers that captured a getState()
     * reference before an await (e.g. SyncService.#pullMemberContributions) keep
     * pointing at the live object, instead of silently mutating an orphaned
     * snapshot whose writes never persist.
     * @param {object} newState
     * @param {(state: object) => void} [migrate]  schema back-fill
     */
    replaceState(newState, migrate = () => {
    }) {
      migrate(newState);
      for (const k of Object.keys(this.#state)) {
        if (!(k in newState)) delete this.#state[k];
      }
      Object.assign(this.#state, newState);
      this.#persistState();
      this.#bus.emit("state:changed", this.#state);
    }
    /**
     * Force-save the current state (e.g. after cloud sync has applied in-place
     * mutations to nested arrays without going through setState).
     */
    persist() {
      this.#persistState();
    }
    /**
     * Persist + notify (useful after bulk in-place mutations like CSV import).
     */
    flush() {
      this.#persistState();
      this.#bus.emit("state:changed", this.#state);
    }
    /**
     * Reset to seed data (hard reset / sign-out wipe).
     * @param {Function} seedFactory
     * @param {Function} migrateDefaults
     */
    reset(seedFactory, migrateDefaults) {
      this.#repository.clear();
      this.#state = seedFactory();
      migrateDefaults(this.#state);
      this.#persistState();
      this.#bus.emit("state:changed", this.#state);
    }
    /**
     * Persist via the Repository and surface a one-time warning if the write
     * fails (e.g. localStorage quota exceeded), so a silent save failure can't go
     * unnoticed and let a later cloud push overwrite good data with stale state (I6).
     * @returns {boolean} success
     */
    #persistState() {
      try {
        this.#derive?.();
      } catch (e) {
        console.error("[Store] derive hook failed:", e);
      }
      this.#revision++;
      const ok = this.#repository.save(this.#state);
      if (!ok && !this.#saveWarned) {
        this.#saveWarned = true;
        this.#bus.emit("toast", { message: "Could not save locally \u2014 device storage may be full" });
      } else if (ok) {
        this.#saveWarned = false;
      }
      return ok;
    }
  };

  // src/core/Router.js
  var Router = class _Router {
    /** @type {Router|null} */
    static #instance = null;
    /** @type {string} */
    #current = "dashboard";
    /** @type {string[]} */
    #stack = [];
    /** @type {EventBus} */
    #bus;
    constructor() {
      if (_Router.#instance) {
        throw new Error("Router is a singleton \u2014 use Router.getInstance()");
      }
      this.#bus = EventBus.getInstance();
    }
    /** @returns {Router} */
    static getInstance() {
      if (!_Router.#instance) {
        _Router.#instance = new _Router();
      }
      return _Router.#instance;
    }
    // ── Accessors ───────────────────────────────────────────────────────
    /** @returns {string} */
    get current() {
      return this.#current;
    }
    /** @returns {boolean} */
    get canGoBack() {
      return this.#stack.length > 0;
    }
    // ── Navigation ──────────────────────────────────────────────────────
    /**
     * Navigate to a new route.
     * @param {string} route - route id (e.g. 'dashboard', 'transactions')
     * @param {object} [params={}] - arbitrary params forwarded to the view
     * @param {object} [options]
     * @param {boolean} [options.pushStack=false] - push current route to back-stack
     */
    navigate(route, params = {}, { pushStack = false } = {}) {
      if (pushStack && this.#current !== route) {
        this.#stack.push(this.#current);
      }
      this.#current = route;
      this.#bus.emit("route:changed", { route, params });
    }
    /**
     * Navigate back to the previous stacked route.
     * Falls back to 'dashboard' when the stack is empty.
     */
    back() {
      const prev = this.#stack.pop() ?? "dashboard";
      this.#current = prev;
      this.#bus.emit("route:changed", { route: prev, params: {} });
    }
    /**
     * Clear the back-stack (e.g. when navigating from the main nav bar).
     */
    clearStack() {
      this.#stack = [];
    }
  };

  // src/data/constants.js
  var FX = Object.freeze({
    // Majors
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 149.5,
    CHF: 0.88,
    // North America
    CAD: 1.36,
    MXN: 17.2,
    // Oceania
    AUD: 1.51,
    NZD: 1.64,
    FJD: 2.25,
    PGK: 3.9,
    TOP: 2.36,
    WST: 2.74,
    XPF: 109,
    // Greater China & East Asia
    CNY: 7.23,
    HKD: 7.81,
    TWD: 31.5,
    KRW: 1330,
    MOP: 8.05,
    MNT: 3400,
    // SE Asia
    SGD: 1.34,
    THB: 35.5,
    MYR: 4.65,
    IDR: 15700,
    PHP: 56.5,
    VND: 24800,
    BND: 1.34,
    KHR: 4100,
    LAK: 21800,
    MMK: 2100,
    // South Asia
    INR: 83.12,
    PKR: 278,
    BDT: 110,
    LKR: 305,
    NPR: 133,
    AFN: 70,
    // Central Asia
    KZT: 480,
    UZS: 12700,
    KGS: 87,
    TJS: 10.6,
    TMT: 3.5,
    // Europe (non-EUR)
    SEK: 10.45,
    NOK: 10.65,
    DKK: 6.85,
    ISK: 137,
    PLN: 4.02,
    CZK: 22.7,
    HUF: 360,
    RON: 4.55,
    BGN: 1.8,
    RSD: 108,
    MKD: 56.8,
    ALL: 93,
    BAM: 1.8,
    MDL: 17.7,
    UAH: 39,
    RUB: 92,
    BYN: 3.27,
    GEL: 2.65,
    AMD: 392,
    AZN: 1.7,
    TRY: 32.5,
    // Middle East
    AED: 3.673,
    SAR: 3.75,
    QAR: 3.64,
    BHD: 0.376,
    KWD: 0.308,
    OMR: 0.385,
    JOD: 0.709,
    ILS: 3.65,
    EGP: 48.5,
    LBP: 89500,
    IRR: 42e3,
    IQD: 1310,
    YER: 250,
    SYP: 13e3,
    // Africa
    ZAR: 18.65,
    KES: 130,
    NGN: 1500,
    GHS: 14.8,
    MAD: 9.95,
    TND: 3.12,
    DZD: 134,
    ETB: 116,
    UGX: 3760,
    TZS: 2520,
    RWF: 1350,
    ZMW: 26.5,
    MWK: 1735,
    BWP: 13.65,
    MUR: 46.3,
    NAD: 18.65,
    XOF: 605,
    XAF: 605,
    LYD: 4.85,
    SDG: 600,
    // Latin America & Caribbean
    BRL: 5.05,
    ARS: 980,
    CLP: 935,
    COP: 4150,
    PEN: 3.78,
    UYU: 39.5,
    PYG: 7400,
    BOB: 6.91,
    VES: 36,
    DOP: 58.5,
    GTQ: 7.78,
    HNL: 24.7,
    JMD: 156,
    TTD: 6.77,
    BBD: 2,
    BSD: 1,
    BMD: 1,
    NIO: 36.8,
    PAB: 1,
    HTG: 132,
    CRC: 510,
    GYD: 209
  });
  var CURRENCIES = Object.freeze(Object.keys(FX).sort());
  var ZERO_DECIMAL = Object.freeze(/* @__PURE__ */ new Set([
    "JPY",
    "KRW",
    "VND",
    "CLP",
    "PYG",
    "ISK",
    "RWF",
    "UGX",
    "XAF",
    "XOF",
    "XPF"
  ]));
  var THREE_DECIMAL = Object.freeze(/* @__PURE__ */ new Set([
    "BHD",
    "IQD",
    "JOD",
    "KWD",
    "LYD",
    "OMR",
    "TND"
  ]));
  var HIJRI_MONTHS_LONG = Object.freeze([
    "Moharram al-Haraam",
    "Safar al-Muzaffar",
    "Rabi al-Awwal",
    "Rabi al-Aakhar",
    "Jumada al-Ula",
    "Jumada al-Ukhra",
    "Rajab al-Asab",
    "Shabaan al-Karim",
    "Ramadaan al-Moazzam",
    "Shawwal al-Mukarram",
    "Zilqadah al-Haraam",
    "Zilhaj al-Haraam"
  ]);
  var HIJRI_MONTHS_SHORT = Object.freeze([
    "Moharram",
    "Safar",
    "Rabi I",
    "Rabi II",
    "Jumada I",
    "Jumada II",
    "Rajab",
    "Shabaan",
    "Ramadaan",
    "Shawwal",
    "Zilqadah",
    "Zilhaj"
  ]);
  var HIJRI_KABISA_REM = Object.freeze([2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29]);
  var HIJRI_DAYS_IN_YEAR = Object.freeze([30, 59, 89, 118, 148, 177, 207, 236, 266, 295, 325]);
  var HIJRI_DAYS_IN_30 = Object.freeze([
    354,
    708,
    1063,
    1417,
    1771,
    2126,
    2480,
    2834,
    3189,
    3543,
    3898,
    4252,
    4606,
    4961,
    5315,
    5669,
    6024,
    6378,
    6732,
    7087,
    7441,
    7796,
    8150,
    8504,
    8859,
    9213,
    9567,
    9922,
    10276,
    10631
  ]);
  var MIQAATS = Object.freeze({
    "0-1": [{ "t": "Hijri New Year", "p": 1 }, { "t": "Urus Mawlai Abdullah Saheb", "p": 3 }],
    "0-2": [{ "t": "Urus Mawlai Raj Bin Mawlai Hasan Saheb", "p": 3 }, { "t": "Urus Syedi Khanji Fir Saheb", "p": 3 }, { "t": "Urus Syedi Shaikh Pir Jamaluddin", "p": 3 }],
    "0-6": [{ "t": "Urus Syedi Mohammed Bin Qazikhan", "p": 3 }],
    "0-7": [{ "t": "Urus Syedna Ismail Badruddin (AQ)", "p": 1 }],
    "0-10": [{ "t": "Yawme Ashura", "p": 1 }, { "t": "Shahadat Imam Hussain (SA)", "p": 1 }, { "t": "Urus Syedna Zoeb Bin Musa (AQ)", "p": 1 }, { "t": "Urus Mawlai Ahmed Saheb", "p": 3 }],
    "0-11": [{ "t": "Suyum Imam Hussain (SA)", "p": 1 }],
    "0-14": [{ "t": "Urus Mawlai Lukmanji Mulla Alibhai Saheb", "p": 3 }],
    "0-15": [{ "t": "Urus Mawlai Nuruddin Saheb", "p": 3 }],
    "0-16": [{ "t": "Urus Syedna Hatim bin Syedna Ibrahim (AQ)", "p": 1 }],
    "0-17": [{ "t": "Shahadat Imam Ali Zainulabedin (SA)", "p": 1 }, { "t": "Urus Syedna Ibrahim Vajihuddin (AQ)", "p": 1 }, { "t": "Urus Mulla Mohammedali bin Syedi Najam Khan", "p": 3 }, { "t": "Urus Mawlai Masud bin Sulaiman", "p": 3 }, { "t": "Urus Seven Shahid Sahebo", "p": 3 }],
    "0-18": [{ "t": "Urus Shahid Gani Pir Ibne Dawoodji", "p": 3 }],
    "0-23": [{ "t": "Urus Syedi Hasan Fir Saheb Shahid", "p": 2 }, { "t": "Urus Noor Bibi Umme Syedna Yusuf Najmuddin", "p": 3 }, { "t": "Urus Fatema Bibi Ukhte Syedna Yusuf Najmuddin", "p": 3 }],
    "0-24": [{ "t": "Urus Syedi Dada Sulemanji", "p": 3 }],
    "0-27": [{ "t": "Urus Syedi Fakhruddin Shahid (AQ)", "p": 2 }],
    "0-28": [{ "t": "Urus Syedi Musaji bin Taj", "p": 3 }],
    "0-29": [{ "t": "Urus Mawlai Hasan Bin Mawlai Adam", "p": 3 }],
    "1-1": [{ "t": "Urus Syedna Ali Bin Syedna Hussain (AQ)", "p": 1 }],
    "1-3": [{ "t": "Urus Syedna Ali Shamsuddin Bin Syedna Abdullah (AQ)", "p": 1 }],
    "1-4": [{ "t": "Urus Syedna Abdul Tayyib Zakiyuddin (AQ)", "p": 1 }],
    "1-6": [{ "t": "Urus Syedi Abdeali Imaduddin", "p": 3 }],
    "1-8": [{ "t": "Urus Syedna Khattab Bin Hasan Hamdani (AQ)", "p": 1 }],
    "1-9": [{ "t": "Urus Syedi Tayyib bs Zainuddin", "p": 3 }],
    "1-12": [{ "t": "Urus Syedna Ahmed Hamiduddin Kirmani (RA)", "p": 1 }],
    "1-13": [{ "t": "Urus Mawlai Adam bin Sulaimanji", "p": 3 }],
    "1-14": [{ "t": "Urus Kaka Akela - Kaki Akeli", "p": 3 }, { "t": "Urus Mawlai Noorbhai Saheb", "p": 3 }],
    "1-15": [{ "t": "Urus Syedi Hamza Bhaisaheb", "p": 3 }],
    "1-17": [{ "t": "Urus Mawlai Shaikh Saheb bin Sulaimanji", "p": 3 }, { "t": "Urus Syedi Shaikh Ibrahim", "p": 3 }, { "t": "Urus Shaikh AbdulHusain Shahid", "p": 3 }],
    "1-20": [{ "t": "Chelum Imam Hussain (SA)", "p": 1 }],
    "1-22": [{ "t": "Urus Syedna Hussain bin Syedna Ali (AQ)", "p": 1 }],
    "1-27": [{ "t": "Urus Syedna Mohammed Izziuddin (AQ)", "p": 1 }],
    "1-28": [{ "t": "Shahadat Imam Hassan (SA)", "p": 1 }],
    "1-29": [{ "t": "Urus Syedi Hasan Zakiyuddin", "p": 3 }],
    "2-1": [{ "t": "Urus Syedi Shaikh Adam Safiyuddin", "p": 3 }, { "t": "Urus Syedi Jamaluddin bin Shaikh Adam", "p": 3 }],
    "2-2": [{ "t": "Urus Syedna Abdul Tayyib Zakiyuddin bin Syedna Dawood bin Qutbub Shah (AQ)", "p": 1 }],
    "2-4": [{ "t": "Urus Syedi Habibullah bin Mulla Adamji", "p": 3 }],
    "2-7": [{ "t": "Urus Syedi Shaikh Dawood Bhai Mulla Mehmoodji", "p": 3 }, { "t": "Urus Syedi Abdeali Mohyiddin", "p": 3 }],
    "2-10": [{ "t": "Urus Syedna Abdullah Badruddin (AQ)", "p": 1 }],
    "2-12": [{ "t": "Eid Milad un-Nabi (SA)", "p": 1 }, { "t": "Urus Ummul Mumineen Amatullah Aaisaheba (QR)", "p": 2 }, { "t": "Ayyam al-Ta'abudaat", "p": 1 }],
    "2-14": [{ "t": "Urus Syedi Miaji Mulla Taj Saheb", "p": 3 }],
    "2-16": [{ "t": "Urus Syedna Mohammed Burhanuddin (AQ)", "p": 1 }],
    "2-22": [{ "t": "Urus Syedna Ali bin Hanzala (AQ)", "p": 1 }, { "t": "Urus Mawlai Dawood bin Raj Saheb", "p": 3 }],
    "2-23": [{ "t": "Urus Mawlai Raj Saheb", "p": 3 }, { "t": "Urus Syedi Qazi Khan bin Ameen Shah", "p": 3 }],
    "2-25": [{ "t": "Urus Syedna Ali Shamsuddin bin Mawlai Hasan (AQ)", "p": 1 }],
    "2-28": [{ "t": "Urus Mohammad bin Hasan Saheb", "p": 3 }],
    "3-4": [{ "t": "Milad Imam uz-Zaman (SA)", "p": 1 }],
    "3-5": [{ "t": "Urus Mia Saheb Maati Bhai Mulla Noor Bhai", "p": 3 }, { "t": "Urus Mia Saheb Tayebji Shaikh Shams Khan", "p": 3 }],
    "3-8": [{ "t": "Urus Mawlai Raj bin Mulla Adam Saheb", "p": 3 }],
    "3-10": [{ "t": "Urus Syedi AbdulRasul Shahid", "p": 3 }],
    "3-14": [{ "t": "Urus Syedi Ismailji Shahid bin Abde Musa", "p": 3 }],
    "3-16": [{ "t": "Urus Syedna Jalal Shamsuddin (AQ) bin Hasan", "p": 1 }],
    "3-20": [{ "t": "Milad Dai al-Muqaddas, Syedna Mohammed Burhanuddin (AQ)", "p": 1 }, { "t": "Ayyam al-Ta'abudaat", "p": 1 }],
    "3-22": [{ "t": "Urus Syedna Musa Kalimuddin (AQ)", "p": 1 }, { "t": "Urus Syedi Mulla Habibullah bin Shaikh Sultanali", "p": 3 }],
    "3-27": [{ "t": "Urus Syedna Dawood Burhanuddin bin Ajab Shah (AQ)", "p": 1 }],
    "3-28": [{ "t": "Urus Kakaji Mulla Isa Bhai", "p": 3 }],
    "4-1": [{ "t": "Urus Syedna Ahmed Al Mukaraam", "p": 3 }],
    "4-3": [{ "t": "Urus Syedi Qazi Khan bin Ali", "p": 3 }],
    "4-8": [{ "t": "Urus Syedi Mulla Wahid Bhaisaheb bin Mulla Ibrahimji", "p": 3 }],
    "4-10": [{ "t": "Shahadat Maulatena Fatema tuz Zahra (SA)", "p": 1 }],
    "4-11": [{ "t": "Urus Mawlai Nooruddin Saheb", "p": 3 }],
    "4-15": [{ "t": "Urus Mawlai Dawood bin Qazi Ahmed", "p": 3 }],
    "4-17": [{ "t": "Urus Syedi Dawood Bhaisaheb Shihabuddin", "p": 3 }],
    "4-21": [{ "t": "Urus Seth Chanda bhai ibne Karim Bhai", "p": 3 }],
    "4-23": [{ "t": "Urus Mulla Jaferji Jiwaji", "p": 3 }],
    "4-29": [{ "t": "Urus Syedi Jivanji bin Shaikh Dawood Bhaisaheb", "p": 3 }],
    "5-8": [{ "t": "Urus Syedi Luqmaanji bin Mulla Habibullah", "p": 3 }],
    "5-12": [{ "t": "Urus Mulla Tayyib Bawa bin Mulla Ibrahimji", "p": 3 }],
    "5-14": [{ "t": "Urus Ganje Shohoda", "p": 3 }],
    "5-15": [{ "t": "Urus Syedna Dawood Burhanuddin (AQ) bin Qutub Shah", "p": 1 }, { "t": "Urus Mawlai Ali bhai Shahid", "p": 3 }],
    "5-18": [{ "t": "Urus Syedna Yusuf Najmuddin (AQ)", "p": 1 }, { "t": "Urus Mawlai Adam ibne Dawood", "p": 3 }, { "t": "Urus Moulai Burhanuddin Ibne Khoj Khan", "p": 3 }],
    "5-23": [{ "t": "Urus Syedna Ismail Badruddin (AQ) bin Mawlai Raj", "p": 1 }],
    "5-27": [{ "t": "Urus Syedna Qutub Khan Qutbuddin Shahid (AQ)", "p": 1 }, { "t": "Urus Syedna Lamak bin Malik (RA)", "p": 1 }],
    "5-28": [{ "t": "Urus Syedna Ahmed bin Mubarak (AQ)", "p": 1 }, { "t": "Urus Syedna Yahya bin Syedna Lamak (AQ)", "p": 1 }],
    "5-29": [{ "t": "Urus Syedna Mohammed Badruddin (AQ)", "p": 1 }, { "t": "Rajab al-Asab Pehli raat", "p": 1 }, { "t": "Urus Syedna Qadi Numan bin Mohammed (AQ)", "p": 1 }, { "t": "Urus Ajab Busaheba Binte Syedna Qutubuddin Shahid (AQ)", "p": 3 }],
    "6-1": [{ "t": "Rajab al-Asab Pehli taarik", "p": 1 }],
    "6-2": [{ "t": "Urus Mawlai Raj bin Dawood", "p": 3 }, { "t": "Urus Bhaiji Bhai Ibne Qazi Bhai", "p": 3 }],
    "6-4": [{ "t": "Urus Syedna Noor Mohammed Nooruddin (AQ)", "p": 1 }, { "t": "Urus Syedi Hasanji Badshah", "p": 3 }],
    "6-7": [{ "t": "Urus Syedna Shaikh Adam Safiyuddin (AQ)", "p": 1 }],
    "6-8": [{ "t": "Urus Syedi Saifuddin Saheb", "p": 3 }],
    "6-12": [{ "t": "Urus Syedi Najam Khan bin Syedna Fir Khan Shujahuddin AQ", "p": 3 }],
    "6-13": [{ "t": "Milad Amir ul-Mumineen (SA)", "p": 1 }, { "t": "Ayyam ul-Beez", "p": 1 }],
    "6-14": [{ "t": "Ayyam ul-Beez", "p": 1 }, { "t": "Urus Syedna Abdul Mutalib Najmuddin (AQ)", "p": 1 }, { "t": "Urus Mawlai Yaqub Saheb", "p": 3 }],
    "6-15": [{ "t": "Ayyam ul-Beez", "p": 1 }, { "t": "Salaat uz-Zawaal", "p": 1 }],
    "6-17": [{ "t": "Ayyam al-Barakaat ul-Khuldiyah", "p": 1 }],
    "6-18": [{ "t": "Urus Syedna Ali Shamsuddin (AQ)", "p": 1 }, { "t": "Ayyam al-Barakaat ul-Khuldiyah", "p": 1 }],
    "6-19": [{ "t": "Urus Syedna Taher Saifuddin (AQ)", "p": 1 }, { "t": "Ayyam al-Barakaat ul-Khuldiyah", "p": 1 }],
    "6-24": [{ "t": "Urus Syedi Qamruddin Bhaisaheb bin Syedna Haibatullah Al Muaid (AQ)", "p": 3 }],
    "6-26": [{ "t": "Shab-e-Meraaj", "p": 1 }, { "t": "Urus Syedna Abdulqadir Najmuddin (AQ)", "p": 1 }],
    "6-27": [{ "t": "Yawm-al-Maba'th", "p": 1 }, { "t": "Urus Syedi Miasaheb Alibhai bin Peeriji", "p": 3 }],
    "6-29": [{ "t": "Urus Syedi Luqmaanji bin Syedi Dawood bhai", "p": 3 }],
    "7-1": [{ "t": "Urus Syedna Hebatullah Muayyadfiddin (AQ)", "p": 1 }],
    "7-14": [{ "t": "Shab-e-Baraat", "p": 1 }],
    "7-15": [{ "t": "Urus Syedna Hasan Badruddin (AQ)", "p": 1 }],
    "7-16": [{ "t": "Urus Syedna Ibrahim bin Husain (AQ)", "p": 1 }],
    "7-19": [{ "t": "Urus Syedi Saleh Bhaisaheb Saifuddin", "p": 3 }],
    "7-22": [{ "t": "Urus Moulatena Hurratul Maleka (RA)", "p": 1 }, { "t": "Urus Syedi Shaikhfir bin Dawood Shahid", "p": 3 }],
    "7-25": [{ "t": "Urus Syedi Shams Khan bin Syedi Yusufji", "p": 3 }],
    "7-29": [{ "t": "Ramadaan al-Moazzan Pehli raat", "p": 1 }, { "t": "Urus Syedna Ali bin Mawla Mohammed al-Walid (AQ)", "p": 1 }, { "t": "Urus Syedi Jiwanji bin Shaikh Dawoodbhai", "p": 3 }],
    "8-1": [{ "t": "Urus Shaikh Dawood Bhaisaheb", "p": 3 }],
    "8-2": [{ "t": "Urus Syedi Wali Bhaisaheb bin Syedi Habibullah", "p": 3 }],
    "8-4": [{ "t": "Urus Syedi Tayyib Bhaisaheb Zainuddin (AQ)", "p": 3 }],
    "8-8": [{ "t": "Urus Syedi Fazal Bhaisaheb Qutubuddin bin Syedna Abdullah (AQ)", "p": 3 }],
    "8-9": [{ "t": "Urus Syedna Abdullah Fakhruddin (AQ)", "p": 1 }],
    "8-16": [{ "t": "Lailat al-Fahdil", "p": 1 }, { "t": "Urus Syedi Hebatullah Jamaluddin", "p": 3 }],
    "8-18": [{ "t": "Lailat al-Fahdil", "p": 1 }],
    "8-19": [{ "t": "Shahadat Amir ul-Mumineen (SA)", "p": 1 }, { "t": "Urus Syedna Mohammed Ezzuddin (AQ)", "p": 1 }],
    "8-20": [{ "t": "Lailat al-Fahdil", "p": 1 }],
    "8-21": [{ "t": "Wafaat Amir ul-Mumineen (SA)", "p": 1 }],
    "8-22": [{ "t": "Lailat al-Qadr", "p": 1 }],
    "8-23": [{ "t": "Milad Dai az-Zamaan, Syedna Mufaddal Saifuddin (TUS)", "p": 1 }],
    "8-29": [{ "t": "Lailat al-Thala'theen", "p": 1 }],
    "8-30": [{ "t": "Lailat ul-Eid-ul-Fitr", "p": 1 }],
    "9-1": [{ "t": "Yawm al-Eid-ul-Fitr", "p": 1 }],
    "9-3": [{ "t": "Urus Shehzadi Sakina Bhensaheba", "p": 2 }],
    "9-4": [{ "t": "Urus Syedi Yusufji", "p": 3 }, { "t": "Urus Syedi Taiyebji Shahid", "p": 3 }],
    "9-5": [{ "t": "Urus Syedi Abdul Qadir Hakimuddin (AQ)", "p": 1 }],
    "9-6": [{ "t": "Urus Syedna Hasan Badruddin (AQ)", "p": 1 }],
    "9-7": [{ "t": "Urus Syedna Mohammed bin Taher (AQ)", "p": 1 }],
    "9-8": [{ "t": "Urus Syedna Abbas bin Syedna Mohammed (AQ)", "p": 1 }],
    "9-9": [{ "t": "Urus Syedna Qasim Khan Zainuddin (AQ)", "p": 1 }],
    "9-10": [{ "t": "Urus Syedna Ibrahim bin Syedna Husain (AQ)", "p": 1 }, { "t": "Urus Syedna Husain Husamuddin (AQ)", "p": 1 }, { "t": "Urus Syedna Hebatullah Muayyadfiddin Shirazi (AQ)", "p": 3 }],
    "9-13": [{ "t": "Urus Syedi Aminji bin Jalal", "p": 3 }],
    "9-24": [{ "t": "Urus Shaikh Qutub Bhai bin Sulaimanji", "p": 3 }],
    "9-27": [{ "t": "Urus Syedi Abdul Qadir Hakimuddin (AQ)", "p": 1 }, { "t": "Urus Mia Saheb Abdeali Waliullah", "p": 3 }],
    "9-29": [{ "t": "Urus Syedi Bawa Mulla Khan Saheb", "p": 3 }, { "t": "Urus Syedi Qasim Khan bin Hamza Bhai", "p": 3 }, { "t": "Urus Mulla Salehbhai Ibne Najamkhan", "p": 3 }],
    "10-9": [{ "t": "Urus Syedna Fir Khan Shujahuddin (AQ)", "p": 1 }],
    "10-11": [{ "t": "Urus Syedna Ali bin Mohammed Sulayhi (RA)", "p": 1 }, { "t": "Urus Syedi Hasan bin Nuh Bharuji", "p": 3 }],
    "10-12": [{ "t": "Urus Syedna Abdul Tayyib Zakiyuddin (AQ)", "p": 1 }, { "t": "Urus Syedna Abdeali Saifuddin (AQ)", "p": 1 }],
    "10-13": [{ "t": "Urus Syedna Ali bin Syedna Husain (AQ)", "p": 1 }],
    "10-15": [{ "t": "Urus Syedna Tayyib Zainuddin (AQ)", "p": 1 }, { "t": "Urus Bai Saheba Raani Baisaheba (RA)", "p": 3 }],
    "10-19": [{ "t": "Urus Syedna Idris Imaduddin (AQ)", "p": 1 }],
    "10-21": [{ "t": "Urus Syedna Ali Shamsuddin (AQ)", "p": 1 }],
    "10-22": [{ "t": "Urus Syedi Shaikh Sadiq Ali Saheb", "p": 3 }],
    "10-25": [{ "t": "Urus Syedna Ali Shamsuddin bin Syedna Hatim (AQ)", "p": 1 }],
    "10-27": [{ "t": "Zikra Milad", "p": 1 }, { "t": "Urus Syedi Yusuf Khan bin Syedi Shams Khan", "p": 3 }],
    "11-1": [{ "t": "Urus Syedna Mohammed bin Syedna Hatim (AQ)", "p": 1 }],
    "11-6": [{ "t": "Urus Syedi Khoj bin Malak", "p": 3 }],
    "11-9": [{ "t": "Yawm ul-Arafa", "p": 1 }, { "t": "Lailat al-Eid-al-Adha", "p": 1 }],
    "11-10": [{ "t": "Yawm al-Eid-al-Adha", "p": 1 }],
    "11-11": [{ "t": "Takbira", "p": 1 }],
    "11-12": [{ "t": "Takbira", "p": 1 }],
    "11-13": [{ "t": "Urus Mawlai Feroz bin Ismail", "p": 3 }, { "t": "Takbira", "p": 1 }],
    "11-16": [{ "t": "Urus Syedna Yusuf Najmuddin bin Sulaiman (AQ)", "p": 1 }, { "t": "Urus Syedi Ishaq Bhaishaeb Jamaluddin (AQ)", "p": 3 }],
    "11-18": [{ "t": "Yawm al-Eid-e-Gadhir-e-Khum", "p": 1 }],
    "11-27": [{ "t": "Urus Syedna Abdul Husain Husamuddin (AQ)", "p": 1 }, { "t": "Urus Syedna Mohammed Burhanuddin (AQ)", "p": 1 }],
    "11-29": [{ "t": "Urus Ghanj Shohada", "p": 3 }]
  });
  var ACCOUNT_TYPES = Object.freeze([
    { id: "cash", label: "Cash", icon: "wallet" },
    { id: "bank", label: "Bank", icon: "landmark" },
    { id: "card", label: "Credit Card", icon: "credit-card" },
    { id: "savings", label: "Savings", icon: "landmark" },
    { id: "invest", label: "Investment", icon: "trending-up" }
  ]);
  var DEFAULT_CATEGORIES = Object.freeze([
    { name: "Food & Drink", icon: "utensils", color: "#f97316", type: "expense" },
    { name: "Transport", icon: "car", color: "#3b82f6", type: "expense" },
    { name: "Shopping", icon: "shopping-bag", color: "#ec4899", type: "expense" },
    { name: "Health", icon: "heart-pulse", color: "#ef4444", type: "expense" },
    { name: "Housing", icon: "home", color: "#a16207", type: "expense" },
    { name: "Entertainment", icon: "film", color: "#8b5cf6", type: "expense" },
    { name: "Bills", icon: "receipt", color: "#0891b2", type: "expense" },
    { name: "Education", icon: "graduation-cap", color: "#10b981", type: "expense" },
    { name: "Salary", icon: "banknote", color: "#22c55e", type: "income" },
    { name: "Freelance", icon: "briefcase", color: "#14b8a6", type: "income" },
    { name: "Savings", icon: "landmark", color: "#06b6d4", type: "income" },
    { name: "Transfer", icon: "arrow-right-left", color: "#737373", type: "transfer" }
  ]);
  var NAV_ITEMS = Object.freeze([
    { id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
    { id: "transactions", label: "Transactions", icon: "arrow-left-right" },
    { id: "accounts", label: "Accounts", icon: "wallet" },
    { id: "budgets", label: "Budgets", icon: "target" },
    { id: "debts", label: "Debts", icon: "hand-coins" },
    { id: "calendar", label: "Regular Purchases", icon: "shopping-basket" },
    { id: "categories", label: "Categories", icon: "tags" },
    { id: "reports", label: "Reports", icon: "pie-chart" },
    { id: "family", label: "Family", icon: "users" }
  ]);
  var MOBILE_TABS = Object.freeze([
    { id: "dashboard", label: "Home", icon: "home" },
    { id: "transactions", label: "Activity", icon: "list" },
    { id: "__add", label: "Add", icon: "plus-circle" },
    { id: "calendar", label: "Purchases", icon: "shopping-basket" },
    { id: "__more", label: "More", icon: "menu" }
  ]);
  var TX_SORT_OPTIONS = Object.freeze([
    ["date-desc", "Newest first"],
    ["date-asc", "Oldest first"],
    ["amount-desc", "Highest amount"],
    ["amount-asc", "Lowest amount"],
    ["payee-asc", "Payee A\u2192Z"],
    ["payee-desc", "Payee Z\u2192A"]
  ]);
  var MEMBER_COLORS = Object.freeze([
    "#8b5cf6",
    "#ec4899",
    "#f97316",
    "#10b981",
    "#3b82f6",
    "#ef4444",
    "#14b8a6",
    "#f59e0b"
  ]);
  var FAMILY_ACCESS_LEVELS = Object.freeze([
    { id: "view", label: "View only", desc: "Can see transactions & balances", color: "#3b82f6", icon: "eye" },
    { id: "add", label: "Can add", desc: "View + add new transactions", color: "#10b981", icon: "plus-circle" },
    { id: "edit", label: "Can edit", desc: "View, add & edit (not delete)", color: "#f59e0b", icon: "pencil" },
    { id: "full", label: "Full access", desc: "View, add, edit & delete transactions", color: "#ef4444", icon: "shield-check" }
  ]);
  var ACCOUNT_TYPE_ICONS = Object.freeze({
    cash: "wallet",
    bank: "landmark",
    card: "credit-card",
    savings: "landmark",
    invest: "trending-up"
  });
  var APP_SUPABASE_URL = "https://nvsfxdnnakzfzsrsfftp.supabase.co";
  var APP_SUPABASE_KEY = "sb_publishable_dBQ3d82_7ktA5tEi2ZAJYg_xqHAAlCn";

  // src/domain/services/IdGenerator.js
  var IdGenerator = class {
    /**
     * Generate a prefixed pseudo-random ID.
     * @param {string} [prefix='id']
     * @returns {string}  e.g. "tx_x4k2j9a3b"
     */
    static generate(prefix = "id") {
      const cryptoObj = typeof globalThis !== "undefined" && globalThis.crypto || null;
      if (cryptoObj?.randomUUID) {
        return `${prefix}_${cryptoObj.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      }
      return prefix + "_" + Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-4);
    }
  };

  // src/domain/services/DateService.js
  var DateService = class {
    /**
     * Format a Date as a local 'YYYY-MM-DD' string. Pass-through for strings.
     * @param {Date|string} d
     * @returns {string}
     */
    static toIso(d) {
      if (!(d instanceof Date)) return d;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    /**
     * Today's local date as 'YYYY-MM-DD'.
     * @returns {string}
     */
    static todayIso() {
      return this.toIso(/* @__PURE__ */ new Date());
    }
  };

  // src/data/seed.js
  var SeedFactory = class {
    /**
     * Build and return a complete initial state object.
     * @returns {object}
     */
    static create() {
      const uid = (prefix) => IdGenerator.generate(prefix);
      const cats = DEFAULT_CATEGORIES.map((c) => ({
        id: uid("cat"),
        parentId: null,
        budgetLimit: null,
        ...c
      }));
      const catBy = (name) => cats.find((c) => c.name === name).id;
      const accounts = [
        { id: uid("acc"), name: "Main Checking", type: "bank", currency: "USD", balance: 25e4, color: "#0ea5e9", icon: "landmark", archived: false },
        { id: uid("acc"), name: "Cash Wallet", type: "cash", currency: "USD", balance: 15e3, color: "#22c55e", icon: "wallet", archived: false },
        { id: uid("acc"), name: "Visa Platinum", type: "card", currency: "USD", balance: -42e3, color: "#a855f7", icon: "credit-card", archived: false },
        { id: uid("acc"), name: "High-Yield Save", type: "savings", currency: "USD", balance: 124e4, color: "#14b8a6", icon: "landmark", archived: false }
      ];
      const today = /* @__PURE__ */ new Date();
      const daysAgo = (n) => {
        const d = new Date(today);
        d.setDate(d.getDate() - n);
        return DateService.toIso(d);
      };
      const expenseSamples = [
        ["Whole Foods Market", "Food & Drink", 4732, ""],
        ["Starbucks", "Food & Drink", 587, "Latte + croissant"],
        ["Uber", "Transport", 1825, "Ride to airport"],
        ["Shell", "Transport", 4210, "Gas fill-up"],
        ["Netflix", "Entertainment", 1599, "Monthly subscription"],
        ["Spotify", "Entertainment", 999, ""],
        ["Amazon", "Shopping", 6745, "USB-C cables"],
        ["Walgreens", "Health", 1234, "Vitamins"],
        ["Trader Joe's", "Food & Drink", 5921, "Weekly groceries"],
        ["Chipotle", "Food & Drink", 1525, ""],
        ["Electric Co.", "Bills", 8230, "May power bill"],
        ["Internet Provider", "Bills", 7500, ""],
        ["Cinema", "Entertainment", 2800, "Movie + popcorn"],
        ["Bookstore", "Shopping", 2700, "Two paperbacks"],
        ["Rent Payment", "Housing", 18e4, "May rent"],
        ["Pharmacy", "Health", 1899, ""],
        ["Coffee Bar", "Food & Drink", 475, ""],
        ["Lyft", "Transport", 1145, ""],
        ["Coursera", "Education", 4900, "Course renewal"],
        ["H&M", "Shopping", 3299, "T-shirts"]
      ];
      const transactions = expenseSamples.map((s, i) => ({
        id: uid("tx"),
        accountId: accounts[i % 3].id,
        categoryId: catBy(s[1]),
        amount: s[2],
        currency: "USD",
        exchangeRate: 1,
        refAmount: s[2],
        payee: s[0],
        note: s[3],
        date: daysAgo(Math.floor(Math.random() * 45)),
        paymentType: "card",
        recordState: "cleared",
        type: "expense",
        transferPairId: null,
        tags: []
      }));
      ["Salary", "Freelance"].forEach((cat, i) => {
        transactions.push({
          id: uid("tx"),
          accountId: accounts[0].id,
          categoryId: catBy(cat),
          amount: cat === "Salary" ? 58e4 : 12e4,
          currency: "USD",
          exchangeRate: 1,
          refAmount: cat === "Salary" ? 58e4 : 12e4,
          payee: cat === "Salary" ? "Acme Corp" : "Side project",
          note: cat === "Salary" ? "Monthly payroll" : "Design contract",
          date: daysAgo(i * 15 + 3),
          paymentType: "transfer",
          recordState: "cleared",
          type: "income",
          transferPairId: null,
          tags: []
        });
      });
      const budgets = [
        { id: uid("bg"), categoryId: catBy("Food & Drink"), amount: 6e4, currency: "USD", period: "gregorian", rollover: false },
        { id: uid("bg"), categoryId: catBy("Transport"), amount: 2e4, currency: "USD", period: "gregorian", rollover: false },
        { id: uid("bg"), categoryId: catBy("Shopping"), amount: 25e3, currency: "USD", period: "gregorian", rollover: false },
        { id: uid("bg"), categoryId: catBy("Entertainment"), amount: 1e4, currency: "USD", period: "gregorian", rollover: false }
      ];
      return {
        user: {
          homeCurrency: "USD",
          defaultCurrency: "USD",
          theme: "system",
          showHijri: true,
          calendarMode: "both",
          dateFormat: "auto",
          geminiApiKey: "",
          supabaseUrl: "",
          supabaseKey: "",
          customPaymentTypes: [],
          collapsedAccountGroups: [],
          collapsedCategories: []
        },
        accounts,
        categories: cats,
        transactions,
        budgets,
        merchantCategories: {},
        debts: [],
        regularItems: [],
        accountGroups: [],
        family: []
      };
    }
  };

  // src/domain/services/LedgerMath.js
  var LedgerMath = class _LedgerMath {
    /**
     * Sign multiplier for a non-transfer transaction type.
     * @param {string} type
     * @returns {number} -1 | 0 | 1
     */
    static #sign(type) {
      if (type === "expense") return -1;
      if (type === "income") return 1;
      return 0;
    }
    /**
     * Break a transaction into the signed contributions it makes to each account,
     * expressed in the transaction's own currency (minor units).
     *
     * @param {object} tx
     * @returns {{ accountId: string, currency: string, minor: number }[]}
     */
    static contributions(tx) {
      if (!tx) return [];
      if (tx.type === "transfer") {
        const s = tx.transferDir === "out" ? -1 : tx.transferDir === "in" ? 1 : 0;
        return [{
          accountId: tx.accountId,
          currency: tx.currency,
          minor: s * Number(tx.amount || 0),
          // Rate-frozen impact in the account's currency (see stampAccountAmounts).
          acctMinor: Number.isFinite(tx.acctMinor) ? s * Number(tx.acctMinor) : void 0
        }];
      }
      const sign = _LedgerMath.#sign(tx.type);
      if (sign === 0) return [];
      if (Array.isArray(tx.splits) && tx.splits.length) {
        return tx.splits.map((sp) => ({
          accountId: sp.accountId || tx.accountId,
          currency: tx.currency,
          minor: sign * Number(sp.amount || 0),
          acctMinor: Number.isFinite(sp.acctMinor) ? sign * Number(sp.acctMinor) : void 0
        }));
      }
      return [{
        accountId: tx.accountId,
        currency: tx.currency,
        minor: sign * Number(tx.amount || 0),
        acctMinor: Number.isFinite(tx.acctMinor) ? sign * Number(tx.acctMinor) : void 0
      }];
    }
    /**
     * The amount a single contribution posts to an account, expressed in the
     * account's currency. Prefers the rate-frozen `acctMinor` captured at posting
     * time; only falls back to a LIVE FX conversion for legacy rows that never
     * froze one. If that live conversion is impossible (unknown currency), the
     * contribution is dropped with a warning rather than silently corrupting the
     * running total with an unconverted 1:1 figure.
     * @param {{currency:string, minor:number, acctMinor?:number}} c
     * @param {string} accountCurrency
     * @param {import('./CurrencyService.js').CurrencyService} fx
     * @returns {number} signed minor units in the account's currency
     */
    static #postedAmount(c, accountCurrency, fx) {
      if (Number.isFinite(c.acctMinor)) return c.acctMinor;
      const m = Number.isFinite(c.minor) ? c.minor : 0;
      try {
        return fx.convertStrict(m, c.currency, accountCurrency);
      } catch (e) {
        console.warn(`[LedgerMath] dropping unconvertible contribution ${c.currency}\u2192${accountCurrency}:`, e?.message || e);
        return 0;
      }
    }
    /**
     * Freeze each transaction's effect on its target account(s) into that
     * account's currency at the CURRENT rate — but only for rows not already
     * frozen. Once stamped, a row's contribution to a balance no longer drifts
     * when the live FX table refreshes; a transaction's historical impact is
     * immutable, exactly like a real bank ledger.
     *
     * Invoked from AccountService.recompute() (the single persist-time derive
     * choke point), so a freshly-created row freezes at creation time and a
     * legacy row freezes once on first load.
     *
     * @param {object[]} transactions
     * @param {object[]} accounts
     * @param {import('./CurrencyService.js').CurrencyService} fx
     */
    static stampAccountAmounts(transactions, accounts, fx) {
      if (!Array.isArray(transactions) || !Array.isArray(accounts)) return;
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const freeze = (rawMinor, fromCcy, acc) => {
        try {
          return fx.convertStrict(Number(rawMinor || 0), fromCcy, acc.currency);
        } catch {
          return void 0;
        }
      };
      for (const tx of transactions) {
        if (!tx) continue;
        if (tx.type === "transfer") {
          if (!Number.isFinite(tx.acctMinor)) {
            const acc = byId.get(tx.accountId);
            if (acc) {
              const v = freeze(tx.amount, tx.currency, acc);
              if (v !== void 0) tx.acctMinor = v;
            }
          }
          continue;
        }
        if (_LedgerMath.#sign(tx.type) === 0) continue;
        if (Array.isArray(tx.splits) && tx.splits.length) {
          for (const sp of tx.splits) {
            if (Number.isFinite(sp.acctMinor)) continue;
            const acc = byId.get(sp.accountId || tx.accountId);
            if (acc) {
              const v = freeze(sp.amount, tx.currency, acc);
              if (v !== void 0) sp.acctMinor = v;
            }
          }
        } else if (!Number.isFinite(tx.acctMinor)) {
          const acc = byId.get(tx.accountId);
          if (acc) {
            const v = freeze(tx.amount, tx.currency, acc);
            if (v !== void 0) tx.acctMinor = v;
          }
        }
      }
    }
    /**
     * The signed delta a single transaction applies to one specific account,
     * converted into that account's currency.
     *
     * @param {object} tx
     * @param {object} account            { id, currency }
     * @param {import('./CurrencyService.js').CurrencyService} fx
     * @returns {number} signed minor units in the account's currency
     */
    static accountDelta(tx, account, fx) {
      if (!account) return 0;
      let delta = 0;
      for (const c of _LedgerMath.contributions(tx)) {
        if (c.accountId !== account.id) continue;
        delta += _LedgerMath.#postedAmount(c, account.currency, fx);
      }
      return delta;
    }
    /**
     * Sum the impact of a transaction list on a single account (its currency).
     * @param {object} account
     * @param {object[]} transactions
     * @param {import('./CurrencyService.js').CurrencyService} fx
     * @returns {number} minor units (rounded)
     */
    static ledgerSum(account, transactions, fx) {
      let sum = 0;
      for (const t of transactions) sum += _LedgerMath.accountDelta(t, account, fx);
      return Math.round(sum);
    }
    /**
     * Compute derived balances for every account in one pass:
     *   balance = openingBalance + Σ ledger impact (converted per account).
     *
     * Returns a Map(accountId → balance minor) so callers can read or write the
     * cached `balance` field as they see fit.
     *
     * @param {object[]} accounts      each may carry openingBalance (defaults 0)
     * @param {object[]} transactions
     * @param {import('./CurrencyService.js').CurrencyService} fx
     * @returns {Map<string, number>}
     */
    static balances(accounts, transactions, fx) {
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const totals = new Map(accounts.map((a) => [a.id, 0]));
      for (const t of transactions) {
        for (const c of _LedgerMath.contributions(t)) {
          const acc = byId.get(c.accountId);
          if (!acc) continue;
          totals.set(acc.id, totals.get(acc.id) + _LedgerMath.#postedAmount(c, acc.currency, fx));
        }
      }
      const out = /* @__PURE__ */ new Map();
      for (const a of accounts) {
        const opening = Number(a.openingBalance ?? 0) || 0;
        out.set(a.id, Math.round(opening + (totals.get(a.id) || 0)));
      }
      return out;
    }
  };

  // src/domain/services/FxRates.js
  var RATES = { ...FX };

  // src/domain/services/CurrencyService.js
  var CurrencyService = class _CurrencyService {
    /**
     * Process-wide label cache. Static (not per-instance) because the app creates
     * many CurrencyService instances; a per-instance `_labelMap` rebuilt the same
     * Intl.DisplayNames table for each one and was never shared.
     * @type {Record<string, string>|null}
     */
    static #labelMap = null;
    // ── Minor-unit helpers ──────────────────────────────────────────────
    /** @param {string} currency @returns {number} */
    minorFactor(currency) {
      if (ZERO_DECIMAL.has(currency)) return 1;
      if (THREE_DECIMAL.has(currency)) return 1e3;
      return 100;
    }
    /** @param {string} currency @returns {number} decimal digits */
    minorDigits(currency) {
      if (ZERO_DECIMAL.has(currency)) return 0;
      if (THREE_DECIMAL.has(currency)) return 3;
      return 2;
    }
    /**
     * Convert a human-entered amount (e.g. 12.50) to minor units (1250).
     * @param {number|string} amount
     * @param {string} currency
     * @returns {number} integer minor units
     */
    toMinor(amount, currency) {
      return Math.round(Number(amount) * this.minorFactor(currency));
    }
    /**
     * Convert minor units (1250) back to a human amount (12.50).
     * @param {number} minor
     * @param {string} currency
     * @returns {number}
     */
    fromMinor(minor, currency) {
      return Number(minor) / this.minorFactor(currency);
    }
    // ── FX conversion ───────────────────────────────────────────────────
    /**
     * Strict conversion: throws when either currency has no FX rate. Use this on
     * the ledger/balance path, where the caller MUST be able to tell an
     * unconvertible row apart from a genuine zero (e.g. to skip freezing it and
     * retry later) rather than silently folding a wrong number into a balance.
     * @param {number} minor
     * @param {string} from
     * @param {string} to
     * @returns {number} amount in minor units of `to`
     * @throws {Error} when `from` or `to` is not in the rate table
     */
    convertStrict(minor, from, to) {
      if (from === to) return minor;
      const fromRate = RATES[from];
      const toRate = RATES[to];
      if (!fromRate || !toRate) {
        throw new Error(`No FX rate for ${from}\u2192${to}`);
      }
      const majorUSD = this.fromMinor(minor, from) / fromRate;
      const majorTo = majorUSD * toRate;
      return this.toMinor(majorTo, to);
    }
    /**
     * Resilient conversion for display/aggregation. Delegates to convertStrict but
     * NEVER throws: an unknown currency yields 0 (with a warning) instead of the
     * old, dangerous 1:1 passthrough, so a single corrupt/exotic currency can no
     * longer silently inflate a home-currency total by treating, say, 1000 JPY as
     * 1000 USD.
     * @param {number} minor   - amount in minor units of `from`
     * @param {string} from
     * @param {string} to
     * @returns {number} amount in minor units of `to` (0 if unconvertible)
     */
    convert(minor, from, to) {
      try {
        return this.convertStrict(minor, from, to);
      } catch (e) {
        console.warn(`[CurrencyService] ${e.message}; counting as 0 to avoid a wrong total`);
        return 0;
      }
    }
    /**
     * Return the auto-computed FX rate between two currencies.
     * (to-per-from expressed as a floating point multiplier)
     * @param {string} from
     * @param {string} to
     * @returns {number}
     */
    autoRate(from, to) {
      if (from === to) return 1;
      return (RATES[to] ?? 1) / (RATES[from] ?? 1);
    }
    // ── Formatting ──────────────────────────────────────────────────────
    /**
     * Format a minor-unit amount as a locale-aware currency string.
     * @param {number} minor
     * @param {string} currency
     * @param {object} [opts]
     * @returns {string}
     */
    formatMoney(minor, currency, opts = {}) {
      const value = this.fromMinor(minor, currency);
      const digits = this.minorDigits(currency);
      try {
        return new Intl.NumberFormat(void 0, {
          style: "currency",
          currency,
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
          ...opts
        }).format(value);
      } catch {
        const sign = value < 0 ? "-" : "";
        return `${sign}${currency} ${Math.abs(value).toFixed(digits)}`;
      }
    }
    /**
     * Human-readable currency label.
     * @param {string} code  e.g. 'USD'
     * @returns {string}  e.g. 'USD — US Dollar'
     */
    label(code) {
      try {
        const dn = new Intl.DisplayNames(["en"], { type: "currency" });
        const name = dn.of(code);
        return name ? `${code} \u2014 ${name}` : code;
      } catch {
        return code;
      }
    }
    /**
     * Pre-built label map for all supported currencies (built once, cached).
     * @returns {Record<string, string>}
     */
    get labelMap() {
      if (!_CurrencyService.#labelMap) {
        const map = {};
        try {
          const dn = new Intl.DisplayNames(["en"], { type: "currency" });
          CURRENCIES.forEach((c) => {
            map[c] = dn.of(c) || c;
          });
        } catch {
          CURRENCIES.forEach((c) => {
            map[c] = c;
          });
        }
        _CurrencyService.#labelMap = map;
      }
      return _CurrencyService.#labelMap;
    }
    /** All supported currency codes, sorted. @returns {string[]} */
    get allCodes() {
      return CURRENCIES;
    }
  };

  // src/data/StateMigrator.js
  var StateMigrator = class {
    /**
     * Mutate `state` in place, back-filling any missing fields. Safe to run
     * repeatedly.
     * @param {object} state
     * @param {CurrencyService} [fx]
     * @returns {object} the same state object
     */
    static migrate(state, fx = new CurrencyService()) {
      if (!state || typeof state !== "object") return state;
      state.user = Object.assign({
        homeCurrency: "USD",
        defaultCurrency: "USD",
        theme: "system",
        showHijri: true,
        calendarMode: "both",
        dateFormat: "auto",
        geminiApiKey: "",
        supabaseUrl: "",
        supabaseKey: "",
        hijriOffset: 0,
        customPaymentTypes: [],
        collapsedAccountGroups: [],
        collapsedCategories: []
      }, state.user || {});
      if (typeof state.user.hijriOffset !== "number") state.user.hijriOffset = 0;
      if (!state.user.defaultCurrency) state.user.defaultCurrency = state.user.homeCurrency;
      if (!Array.isArray(state.accounts)) state.accounts = [];
      if (!Array.isArray(state.transactions)) state.transactions = [];
      if (!Array.isArray(state.categories)) state.categories = [];
      if (!Array.isArray(state.budgets)) state.budgets = [];
      if (!Array.isArray(state.debts)) state.debts = [];
      if (!Array.isArray(state.regularItems)) state.regularItems = [];
      if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
      if (!Array.isArray(state.family)) state.family = [];
      if (!state.merchantCategories || typeof state.merchantCategories !== "object") {
        state.merchantCategories = {};
      }
      for (const acc of state.accounts) {
        if (acc.openingBalance === void 0 || acc.openingBalance === null) {
          const stored = Number(acc.balance);
          const ledger = LedgerMath.ledgerSum(acc, state.transactions, fx);
          acc.openingBalance = Number.isFinite(stored) ? Math.round(stored - ledger) : 0;
        }
      }
      return state;
    }
  };

  // src/domain/services/HijriCalendarService.js
  var HijriCalendarService = class {
    /** @type {Store} */
    #store;
    constructor() {
      this.#store = Store.getInstance();
    }
    /**
     * The user-configured day offset (−7 … +7).
     * Positive = add days to the calculated date.
     * Negative = subtract days.
     * @returns {number}
     */
    get offset() {
      return this.#store.getState()?.user?.hijriOffset ?? 0;
    }
    // ── Julian / Gregorian helpers ──────────────────────────────────────
    /** @param {Date} d @returns {boolean} */
    #isJulian(d) {
      if (d.getFullYear() < 1582) return true;
      if (d.getFullYear() === 1582) {
        if (d.getMonth() < 9) return true;
        if (d.getMonth() === 9 && d.getDate() < 5) return true;
      }
      return false;
    }
    /**
     * Convert a JS Date to Astronomical Julian Day Number.
     * @param {Date} d
     * @returns {number}
     */
    #gregorianToAJD(d) {
      let y = d.getFullYear();
      let m = d.getMonth() + 1;
      const day = d.getDate() + d.getHours() / 24 + d.getMinutes() / 1440 + d.getSeconds() / 86400 + d.getMilliseconds() / 864e5;
      if (m < 3) {
        y--;
        m += 12;
      }
      const a = Math.floor(y / 100);
      const b = this.#isJulian(d) ? 0 : 2 - a + Math.floor(a / 4);
      return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
    }
    /** @param {number} ajd @returns {{ year, month, day }} */
    #ajdToHijri(ajd) {
      let i = 0;
      let left = Math.floor(ajd - 19480835e-1);
      const y30 = Math.floor(left / 10631);
      left -= y30 * 10631;
      while (left > HIJRI_DAYS_IN_30[i]) i++;
      const year = Math.round(y30 * 30 + i);
      if (i > 0) left -= HIJRI_DAYS_IN_30[i - 1];
      i = 0;
      while (left > HIJRI_DAYS_IN_YEAR[i]) i++;
      const month = Math.round(i);
      const day = i > 0 ? Math.round(left - HIJRI_DAYS_IN_YEAR[i - 1]) : Math.round(left);
      return { year, month, day };
    }
    /** @param {number} year @returns {boolean} */
    #isKabisa(year) {
      return HIJRI_KABISA_REM.includes(year % 30);
    }
    /** @param {number} year @param {number} month @returns {number} */
    daysInMonth(year, month) {
      return month === 11 && this.#isKabisa(year) || month % 2 === 0 ? 30 : 29;
    }
    // ── Hijri → AJD → Gregorian ─────────────────────────────────────────
    /** @param {number} year @param {number} month @param {number} day @returns {number} AJD */
    #hijriToAJD(year, month, day) {
      const y30 = Math.floor(year / 30);
      let ajd = 19480835e-1 + y30 * 10631;
      const doy = month === 0 ? day : HIJRI_DAYS_IN_YEAR[month - 1] + day;
      ajd += doy;
      if (year % 30 !== 0) ajd += HIJRI_DAYS_IN_30[year - y30 * 30 - 1];
      return ajd;
    }
    /** @param {number} ajd @returns {Date} */
    #ajdToGregorian(ajd) {
      const z = Math.floor(ajd + 0.5);
      const f = ajd + 0.5 - z;
      let a;
      if (z < 2299161) {
        a = z;
      } else {
        const alpha = Math.floor((z - 186721625e-2) / 36524.25);
        a = z + 1 + alpha - Math.floor(alpha / 4);
      }
      const b = a + 1524;
      const c = Math.floor((b - 122.1) / 365.25);
      const d = Math.floor(365.25 * c);
      const e = Math.floor((b - d) / 30.6001);
      let day = b - d - Math.floor(30.6001 * e) + f;
      day = Math.floor(day);
      const month = e < 14 ? e - 2 : e - 14;
      const year = month < 2 ? c - 4715 : c - 4716;
      return new Date(year, month, day, 12, 0, 0);
    }
    // ── Public API ──────────────────────────────────────────────────────
    /**
     * Convert a Gregorian date to Hijri.
     * @param {Date|string} input  JS Date or ISO 'YYYY-MM-DD' string
     * @returns {{ year: number, month: number, day: number }}
     */
    toHijri(input) {
      const d = typeof input === "string" ? /* @__PURE__ */ new Date(input + "T12:00:00") : input;
      const offset = this.offset;
      const shifted = offset !== 0 ? new Date(d.getTime() + offset * 864e5) : d;
      return this.#ajdToHijri(this.#gregorianToAJD(shifted));
    }
    /**
     * Convert a Gregorian date to Hijri WITHOUT applying the user's offset.
     * Used exclusively for back-filling hijriDate on transactions that were
     * created before the offset system existed, where offset was implicitly 0.
     * @param {Date|string} input
     * @returns {{ year: number, month: number, day: number }}
     */
    toHijriRaw(input) {
      const d = typeof input === "string" ? /* @__PURE__ */ new Date(input + "T12:00:00") : input;
      return this.#ajdToHijri(this.#gregorianToAJD(d));
    }
    /**
     * Convert a Hijri date to Gregorian.
     * @param {number} year
     * @param {number} month  0-based
     * @param {number} day
     * @returns {Date}
     */
    toGregorian(year, month, day) {
      return this.#ajdToGregorian(this.#hijriToAJD(year, month, day));
    }
    /**
     * Format a Hijri date as a human-readable string.
     * @param {Date|string|{year,month,day}} input
     * @param {object} [opts]
     * @param {boolean} [opts.long=false]
     * @param {boolean} [opts.withYear=true]
     * @param {boolean} [opts.ah=false]  append "AH" vs "H"
     * @returns {string}
     */
    format(input, { long = false, withYear = true, ah = false } = {}) {
      const h = input && typeof input === "object" && "year" in input ? input : this.toHijri(input);
      const monthNames = long ? HIJRI_MONTHS_LONG : HIJRI_MONTHS_SHORT;
      const suffix = withYear ? ` ${h.year}${ah ? " AH" : "H"}` : "";
      return `${h.day} ${monthNames[h.month]}${suffix}`;
    }
    // ── Miqaat helpers ──────────────────────────────────────────────────
    /**
     * Return miqaats for a given Hijri date.
     * @param {{ month: number, day: number }} h
     * @returns {Array<{t: string, p: number}>}
     */
    miqaatsFor(h) {
      if (!h) return [];
      return MIQAATS[`${h.month}-${h.day}`] || [];
    }
    /**
     * Return miqaats for a Gregorian date.
     * @param {Date|string} gregorian
     * @returns {Array<{t: string, p: number}>}
     */
    miqaatsForGregorian(gregorian) {
      return this.miqaatsFor(this.toHijri(gregorian));
    }
    /**
     * Return the highest-priority miqaat in a list.
     * @param {Array<{t: string, p: number}>} list
     * @returns {{t: string, p: number}|null}
     */
    topMiqaat(list) {
      if (!list?.length) return null;
      return list.slice().sort((a, b) => a.p - b.p)[0];
    }
    get monthsLong() {
      return HIJRI_MONTHS_LONG;
    }
    get monthsShort() {
      return HIJRI_MONTHS_SHORT;
    }
  };

  // src/domain/services/AccountService.js
  var AccountService = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    /**
     * @param {object} [deps]
     * @param {Store} [deps.store]
     * @param {CurrencyService} [deps.fx]
     */
    constructor({ store = Store.getInstance(), fx = new CurrencyService() } = {}) {
      this.#store = store;
      this.#fx = fx;
    }
    // ── Queries ─────────────────────────────────────────────────────────
    /** @param {string} id @returns {object|undefined} */
    find(id) {
      return this.#store.getState().accounts.find((a) => a.id === id);
    }
    /** @returns {object[]} all non-archived accounts */
    active() {
      return this.#store.getState().accounts.filter((a) => !a.archived);
    }
    /**
     * Total balance of all non-archived accounts in the user's home currency.
     * Reads the derived `balance` cache (kept fresh by recompute()), so this is
     * O(accounts), not O(accounts × transactions).
     * @returns {number} minor units
     */
    totalBalanceInHome() {
      const state = this.#store.getState();
      return state.accounts.filter((a) => !a.archived).reduce((sum, a) => sum + this.#fx.convert(a.balance ?? 0, a.currency, state.user.homeCurrency), 0);
    }
    // ── Derived balance ──────────────────────────────────────────────────
    /**
     * On-demand derived balance for a single account.
     * @param {object} account
     * @returns {number} minor units in the account's currency
     */
    balanceOf(account) {
      if (!account) return 0;
      const opening = Number(account.openingBalance ?? 0) || 0;
      return Math.round(opening + LedgerMath.ledgerSum(account, this.#store.getState().transactions, this.#fx));
    }
    /**
     * Recompute and write the derived `balance` cache for every account in a
     * single pass. Invoked by the Store on every persist; safe to call anytime.
     */
    recompute() {
      const state = this.#store.getState();
      if (!Array.isArray(state.accounts) || !Array.isArray(state.transactions)) return;
      LedgerMath.stampAccountAmounts(state.transactions, state.accounts, this.#fx);
      const balances = LedgerMath.balances(state.accounts, state.transactions, this.#fx);
      for (const a of state.accounts) a.balance = balances.get(a.id) ?? 0;
    }
    /**
     * Ledger impact of a transaction list on one account (its currency).
     * Retained for callers (e.g. reconcile); delegates to LedgerMath.
     * @param {object} account
     * @param {object[]} transactions
     * @returns {number} minor units
     */
    ledgerSum(account, transactions) {
      return LedgerMath.ledgerSum(account, transactions, this.#fx);
    }
    // ── Mutations ────────────────────────────────────────────────────────
    /**
     * Create a new account. Opening balances are recorded by the caller as a
     * ledger transaction, so openingBalance defaults to 0.
     * @param {object} data
     * @returns {object}
     */
    create(data) {
      const account = {
        id: IdGenerator.generate("acc"),
        name: data.name,
        type: data.type || "bank",
        currency: data.currency || "USD",
        openingBalance: Number(data.openingBalance ?? 0) || 0,
        balance: Number(data.openingBalance ?? 0) || 0,
        color: data.color || "#0ea5e9",
        icon: data.icon || "landmark",
        archived: false,
        groupId: data.groupId || null
      };
      this.#store.getState().accounts.push(account);
      this.#store.flush();
      return account;
    }
    /** @param {string} id @param {object} changes @returns {object|null} */
    update(id, changes) {
      const account = this.find(id);
      if (!account) return null;
      const currencyChanged = "currency" in changes && changes.currency !== account.currency;
      Object.assign(account, changes);
      if (currencyChanged) {
        for (const t of this.#store.getState().transactions) {
          if (t.accountId === id) delete t.acctMinor;
          if (Array.isArray(t.splits)) {
            for (const sp of t.splits) if ((sp.accountId || t.accountId) === id) delete sp.acctMinor;
          }
        }
      }
      this.#store.flush();
      return account;
    }
    /** @param {string} id @param {boolean} [archived=true] */
    archive(id, archived = true) {
      this.update(id, { archived });
    }
    /**
     * Delete an account: remove fully-owned transactions, strip dangling split
     * legs from shared ones, then drop the account. Balances of surviving
     * accounts (transfer counter-legs, multi-account splits) self-correct because
     * the Store recomputes them from the remaining ledger on persist.
     * @param {string} id
     */
    delete(id) {
      const state = this.#store.getState();
      state.transactions = state.transactions.filter(
        (t) => t.accountId !== id || Array.isArray(t.splits) && t.splits.some((s) => (s.accountId || t.accountId) !== id)
      ).map(
        (t) => Array.isArray(t.splits) ? { ...t, splits: t.splits.filter((s) => (s.accountId || t.accountId) !== id) } : t
      );
      state.accounts = state.accounts.filter((a) => a.id !== id);
      this.#store.flush();
    }
  };

  // src/domain/services/CategoryService.js
  var CategoryService = class {
    /** @type {Store} */
    #store;
    constructor() {
      this.#store = Store.getInstance();
    }
    // ── Queries ─────────────────────────────────────────────────────────
    /**
     * Find a category by ID.
     * Accepts an optional override list (used when rendering shared accounts).
     * @param {string} id
     * @param {object[]} [list]
     * @returns {object|undefined}
     */
    find(id, list) {
      const cats = list ?? this.#store.getState().categories;
      return cats.find((c) => c.id === id);
    }
    /**
     * Full hierarchical name for a category.
     * e.g. "Food & Drink / Dining out"
     * @param {string} id
     * @param {object[]} [list]
     * @returns {string}
     */
    fullName(id, list) {
      const cats = list ?? this.#store.getState().categories;
      const c = this.find(id, cats);
      if (!c) return "";
      if (c.parentId) {
        const p = this.find(c.parentId, cats);
        if (p) return `${p.name} / ${c.name}`;
      }
      return c.name;
    }
    /**
     * Return `catId` plus its FULL subtree (children, grandchildren, …). Callers
     * such as BudgetService rely on this being the transitive closure so spend in
     * a deeply-nested category still rolls up to an ancestor budget; the previous
     * one-level version silently dropped grandchildren. Guarded against a
     * parentId cycle so a malformed tree can't loop forever.
     * @param {string} catId
     * @returns {string[]}
     */
    descendants(catId) {
      const cats = this.#store.getState().categories;
      const childrenOf = /* @__PURE__ */ new Map();
      for (const c of cats) {
        if (!childrenOf.has(c.parentId)) childrenOf.set(c.parentId, []);
        childrenOf.get(c.parentId).push(c.id);
      }
      const out = [], seen = /* @__PURE__ */ new Set(), stack = [catId];
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        for (const childId of childrenOf.get(id) || []) stack.push(childId);
      }
      return out;
    }
    /**
     * Root categories (no parent) filtered by type.
     * @param {'expense'|'income'|'transfer'|null} [type]
     * @returns {object[]}
     */
    roots(type = null) {
      const cats = this.#store.getState().categories;
      return cats.filter(
        (c) => !c.parentId && (type === null || c.type === type)
      );
    }
    /**
     * Children of a given parent ID.
     * @param {string} parentId
     * @returns {object[]}
     */
    children(parentId) {
      return this.#store.getState().categories.filter(
        (c) => c.parentId === parentId
      );
    }
    // ── Mutations ────────────────────────────────────────────────────────
    /**
     * Create a new category.
     * @param {object} data
     * @returns {object}
     */
    create(data) {
      const cat = {
        id: IdGenerator.generate("cat"),
        name: data.name,
        icon: data.icon || "tag",
        color: data.color || "#737373",
        type: data.type || "expense",
        parentId: data.parentId || null,
        budgetLimit: data.budgetLimit || null
      };
      this.#store.getState().categories.push(cat);
      this.#store.flush();
      return cat;
    }
    /**
     * Update an existing category.
     * @param {string} id
     * @param {object} changes
     * @returns {object|null}
     */
    update(id, changes) {
      const cat = this.find(id);
      if (!cat) return null;
      Object.assign(cat, changes);
      this.#store.flush();
      return cat;
    }
    /**
     * Delete a category (and unlink its children).
     * @param {string} id
     */
    delete(id) {
      const state = this.#store.getState();
      state.categories.forEach((c) => {
        if (c.parentId === id) c.parentId = null;
      });
      state.categories = state.categories.filter((c) => c.id !== id);
      state.transactions.forEach((t) => {
        if (t.categoryId === id) t.categoryId = null;
      });
      this.#store.flush();
    }
  };

  // src/domain/services/TransactionService.js
  var TransactionService = class {
    /** @type {Store} */
    #store;
    /** @type {AccountService} */
    #accounts;
    /** @type {CurrencyService} */
    #fx;
    /** @type {HijriCalendarService} */
    #hijri;
    constructor({
      store = Store.getInstance(),
      accounts = new AccountService(),
      fx = new CurrencyService(),
      hijri = new HijriCalendarService()
    } = {}) {
      this.#store = store;
      this.#accounts = accounts;
      this.#fx = fx;
      this.#hijri = hijri;
    }
    // ── Queries ─────────────────────────────────────────────────────────
    /**
     * Find a transaction by ID.
     * @param {string} id
     * @returns {object|undefined}
     */
    find(id) {
      return this.#store.getState().transactions.find((t) => t.id === id);
    }
    /**
     * Return category amounts for a transaction.
     * Non-split:  [{ categoryId, amount, currency }]
     * Split:      one entry per split row
     * @param {object} tx
     * @returns {{ categoryId: string|null, amount: number, currency: string }[]}
     */
    categoryAmounts(tx) {
      if (Array.isArray(tx.splits) && tx.splits.length) {
        return tx.splits.map((s) => ({
          categoryId: s.categoryId || null,
          amount: s.amount,
          currency: tx.currency
        }));
      }
      return [{ categoryId: tx.categoryId || null, amount: tx.amount, currency: tx.currency }];
    }
    /**
     * Compute the directional impact of a transaction on a given account.
     * Used by the account-detail view to show the correct sign/amount.
     * @param {object} tx
     * @param {object} account
     * @returns {{ dir: '+'|'-'|'', minorInAcc: number }}
     */
    impactOnAccount(tx, account) {
      if (!account) return { dir: "", minorInAcc: 0 };
      const delta = LedgerMath.accountDelta(tx, account, this.#fx);
      return {
        dir: delta < 0 ? "-" : delta > 0 ? "+" : "",
        minorInAcc: Math.abs(delta)
      };
    }
    // ── Sorting ──────────────────────────────────────────────────────────
    /**
     * Sort a transactions array in-place.
     * @param {object[]} arr
     * @param {'date-desc'|'date-asc'|'amount-desc'|'amount-asc'|'payee-asc'|'payee-desc'} sortKey
     * @param {Function} [amountFn]  (tx) => number override for amount comparison
     * @returns {object[]}
     */
    sort(arr, sortKey, amountFn) {
      const home = this.#store.getState().user.homeCurrency;
      const amt = amountFn ?? ((t) => Math.abs(this.#fx.convert(t.amount, t.currency, home)));
      const out = arr.slice();
      const d = (t) => t.date || "";
      switch (sortKey) {
        case "date-asc":
          return out.sort((a, b) => d(a).localeCompare(d(b)));
        case "amount-desc":
          return out.sort((a, b) => amt(b) - amt(a));
        case "amount-asc":
          return out.sort((a, b) => amt(a) - amt(b));
        case "payee-asc":
          return out.sort((a, b) => (a.payee || "").localeCompare(b.payee || "") || d(b).localeCompare(d(a)));
        case "payee-desc":
          return out.sort((a, b) => (b.payee || "").localeCompare(a.payee || "") || d(b).localeCompare(d(a)));
        case "date-desc":
        default:
          return out.sort((a, b) => d(b).localeCompare(d(a)));
      }
    }
    // ── Create ───────────────────────────────────────────────────────────
    /**
     * Create a new transaction (and update account balances).
     * @param {object} data
     * @returns {object}
     */
    create(data) {
      const state = this.#store.getState();
      const tx = {
        id: IdGenerator.generate("tx"),
        accountId: data.accountId,
        categoryId: data.categoryId || null,
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate || 1,
        refAmount: data.refAmount || data.amount,
        payee: data.payee || "",
        note: data.note || "",
        date: data.date,
        // Snapshot the Hijri date at creation time using the user's current offset.
        // This value is immutable after save — BudgetService reads it instead of
        // recomputing, so future offset changes never affect past-transaction budgets.
        hijriDate: this.#hijri.toHijri(data.date),
        paymentType: data.paymentType || "card",
        recordState: data.recordState || "cleared",
        type: data.type,
        transferPairId: data.transferPairId || null,
        transferDir: data.transferDir || null,
        transferRate: data.transferRate || null,
        tags: data.tags || [],
        splits: data.splits || null,
        // Optional rate-frozen account-currency amount (foreign-currency tx). When
        // absent, AccountService.recompute() freezes it at the live rate.
        acctMinor: Number.isFinite(data.acctMinor) ? data.acctMinor : void 0,
        recurring: data.recurring || null,
        recurringSourceId: data.recurringSourceId || null,
        createdAt: data.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        addedBy: data.addedBy || null
      };
      state.transactions.push(tx);
      this.#store.flush();
      return tx;
    }
    // ── Update ───────────────────────────────────────────────────────────
    /**
     * Update an existing transaction. Balances are derived, so we only mutate the
     * ledger and flush. For transfers we ALSO mirror the relevant changes onto the
     * paired leg — otherwise editing one leg's amount/currency/date leaves the
     * counter-account out of balance.
     * @param {string} id
     * @param {object} changes
     * @returns {object|null}
     */
    update(id, changes) {
      const tx = this.find(id);
      if (!tx) return null;
      Object.assign(tx, changes);
      if (!("acctMinor" in changes) && ["amount", "currency", "accountId", "splits"].some((k) => k in changes)) {
        delete tx.acctMinor;
        if (Array.isArray(tx.splits)) for (const sp of tx.splits) delete sp.acctMinor;
      }
      if (tx.type === "transfer" && tx.transferPairId) {
        const pair = this.find(tx.transferPairId);
        if (pair) {
          const mirror = {};
          for (const k of ["amount", "currency", "date", "note", "payee", "transferRate"]) {
            if (k in changes) mirror[k] = changes[k];
          }
          Object.assign(pair, mirror);
          if ("amount" in changes || "currency" in changes) delete pair.acctMinor;
        }
      }
      this.#store.flush();
      return tx;
    }
    // ── Delete ───────────────────────────────────────────────────────────
    /**
     * Delete a transaction (and its transfer pair if applicable).
     * @param {string} id
     */
    delete(id) {
      const state = this.#store.getState();
      const tx = this.find(id);
      if (!tx) return;
      const removeIds = /* @__PURE__ */ new Set([id]);
      if (tx.type === "transfer" && tx.transferPairId) removeIds.add(tx.transferPairId);
      state.transactions = state.transactions.filter((t) => !removeIds.has(t.id));
      this.#store.flush();
    }
    /**
     * Bulk-delete transactions by ID array.
     * @param {string[]} ids
     */
    bulkDelete(ids) {
      const idSet = new Set(ids);
      const state = this.#store.getState();
      state.transactions.forEach((t) => {
        if (idSet.has(t.id) && t.type === "transfer" && t.transferPairId) idSet.add(t.transferPairId);
      });
      state.transactions = state.transactions.filter((t) => !idSet.has(t.id));
      this.#store.flush();
    }
  };

  // src/domain/services/BudgetService.js
  var BudgetService = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    /** @type {CategoryService} */
    #cats;
    /** @type {HijriCalendarService} */
    #hijri;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
      this.#cats = new CategoryService();
      this.#hijri = new HijriCalendarService();
    }
    // ── Targeting ───────────────────────────────────────────────────────
    /**
     * The category IDs a budget targets. Backward-compatible: a legacy budget
     * carrying a single `categoryId` is treated as a one-element list.
     * @param {object} budget
     * @returns {string[]}
     */
    targetCategoryIds(budget) {
      if (Array.isArray(budget.categoryIds) && budget.categoryIds.length) return budget.categoryIds;
      return budget.categoryId ? [budget.categoryId] : [];
    }
    /** Every category that counts toward the budget = each target + its descendants. */
    #expandedIds(budget) {
      const set = /* @__PURE__ */ new Set();
      for (const id of this.targetCategoryIds(budget)) {
        for (const d of this.#cats.descendants(id)) set.add(d);
      }
      return set;
    }
    /**
     * True if an expense tx falls within the budget's current period.
     *
     * For Hijri periods, use t.hijriDate (the immutable snapshot written at
     * creation time) rather than re-computing toHijri(t.date) with the current
     * offset.  This means future offset adjustments never reclassify past
     * transactions into a different budget month.
     * Falls back to live computation only for legacy transactions that pre-date
     * the hijriDate field (they were created when offset was 0, so toHijriRaw
     * is the correct fallback).
     */
    #inCurrentPeriod(budget, t) {
      if (t.type !== "expense") return false;
      if (!t.date) return false;
      if (budget.period === "hijri") {
        const todayH = this.#hijri.toHijri(/* @__PURE__ */ new Date());
        const h = t.hijriDate ?? this.#hijri.toHijriRaw(t.date);
        return h.year === todayH.year && h.month === todayH.month;
      }
      const now = /* @__PURE__ */ new Date();
      const d = /* @__PURE__ */ new Date(t.date + "T12:00:00");
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    // ── Queries ─────────────────────────────────────────────────────────
    /**
     * Total current-period spend for a budget across all its target categories
     * (and their descendants), in the budget's currency.
     * @param {object} budget
     * @returns {number} minor units
     */
    currentSpend(budget) {
      const state = this.#store.getState();
      const ids = this.#expandedIds(budget);
      let spend = 0;
      for (const t of state.transactions) {
        if (!this.#inCurrentPeriod(budget, t)) continue;
        for (const slice of this.#categoryAmounts(t)) {
          if (ids.has(slice.categoryId)) spend += this.#fx.convert(slice.amount, slice.currency, budget.currency);
        }
      }
      return spend;
    }
    /**
     * Per-target-category spend for the current period (budget currency). Each
     * entry covers that target category plus its descendants — powering the small
     * split shown under a budget's progress bar.
     * @param {object} budget
     * @returns {{ categoryId: string, name: string, color: string, icon: string, spend: number }[]}
     */
    spendByCategory(budget) {
      const state = this.#store.getState();
      return this.targetCategoryIds(budget).map((cid) => {
        const ids = new Set(this.#cats.descendants(cid));
        let spend = 0;
        for (const t of state.transactions) {
          if (!this.#inCurrentPeriod(budget, t)) continue;
          for (const slice of this.#categoryAmounts(t)) {
            if (ids.has(slice.categoryId)) spend += this.#fx.convert(slice.amount, slice.currency, budget.currency);
          }
        }
        const cat = this.#cats.find(cid);
        return { categoryId: cid, name: cat?.name || "Category", color: cat?.color || "#a1a1aa", icon: cat?.icon || "circle", spend };
      });
    }
    /**
     * All expense transactions counting toward the budget this period, newest
     * first — used by the budget detail view.
     * @param {object} budget
     * @returns {object[]}
     */
    periodTransactions(budget) {
      const state = this.#store.getState();
      const ids = this.#expandedIds(budget);
      return state.transactions.filter((t) => this.#inCurrentPeriod(budget, t) && this.#categoryAmounts(t).some((s) => ids.has(s.categoryId))).sort((a, b) => b.date.localeCompare(a.date));
    }
    /**
     * Effective budget limit accounting for optional rollover from previous period.
     * @param {object} budget
     * @returns {{ limit: number, rollover: number }}
     */
    effectiveLimit(budget) {
      if (!budget.rollover) return { limit: budget.amount, rollover: 0 };
      const state = this.#store.getState();
      const todayH = this.#hijri.toHijri(/* @__PURE__ */ new Date());
      const ids = this.#expandedIds(budget);
      const now = /* @__PURE__ */ new Date();
      const prevMatches = (t) => {
        if (t.type !== "expense") return false;
        if (!t.date) return false;
        if (budget.period === "hijri") {
          let pm2 = todayH.month - 1, py2 = todayH.year;
          if (pm2 < 0) {
            pm2 = 11;
            py2 -= 1;
          }
          const h = t.hijriDate ?? this.#hijri.toHijriRaw(t.date);
          return h.year === py2 && h.month === pm2;
        }
        const d = /* @__PURE__ */ new Date(t.date + "T12:00:00");
        const pm = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        const py = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        return d.getFullYear() === py && d.getMonth() === pm;
      };
      let prevSpent = 0;
      for (const t of state.transactions) {
        if (!prevMatches(t)) continue;
        for (const slice of this.#categoryAmounts(t)) {
          if (ids.has(slice.categoryId)) {
            prevSpent += this.#fx.convert(slice.amount, slice.currency, budget.currency);
          }
        }
      }
      const leftover = Math.max(0, budget.amount - prevSpent);
      return { limit: budget.amount + leftover, rollover: leftover };
    }
    // ── Private helpers ──────────────────────────────────────────────────
    #categoryAmounts(tx) {
      if (Array.isArray(tx.splits) && tx.splits.length) {
        return tx.splits.map((s) => ({
          categoryId: s.categoryId || null,
          amount: s.amount,
          currency: tx.currency
        }));
      }
      return [{ categoryId: tx.categoryId || null, amount: tx.amount, currency: tx.currency }];
    }
    // ── CRUD ─────────────────────────────────────────────────────────────
    /**
     * Create a budget.
     * @param {object} data
     * @returns {object}
     */
    create(data) {
      const ids = Array.isArray(data.categoryIds) && data.categoryIds.length ? data.categoryIds : data.categoryId ? [data.categoryId] : [];
      const budget = {
        id: IdGenerator.generate("bg"),
        categoryIds: ids,
        categoryId: ids[0] ?? null,
        // kept in sync for backward compatibility
        amount: data.amount,
        currency: data.currency,
        period: data.period === "hijri" ? "hijri" : "gregorian",
        rollover: data.rollover || false
      };
      this.#store.getState().budgets.push(budget);
      this.#store.flush();
      return budget;
    }
    /**
     * Update a budget.
     * @param {string} id
     * @param {object} changes
     */
    update(id, changes) {
      const budget = this.#store.getState().budgets.find((b) => b.id === id);
      if (!budget) return null;
      Object.assign(budget, changes);
      this.#store.flush();
      return budget;
    }
    /**
     * Delete a budget.
     * @param {string} id
     */
    delete(id) {
      const state = this.#store.getState();
      state.budgets = state.budgets.filter((b) => b.id !== id);
      this.#store.flush();
    }
  };

  // src/domain/services/RecurringService.js
  var RecurringService = class {
    /** @type {Store} */
    #store;
    /** @type {AccountService} */
    #accounts;
    /** @type {HijriCalendarService} */
    #hijri;
    constructor() {
      this.#store = Store.getInstance();
      this.#accounts = new AccountService();
      this.#hijri = new HijriCalendarService();
    }
    // ── Date helpers ─────────────────────────────────────────────────────
    /**
     * ISO date string for a given JS Date.
     * @param {Date} d
     * @returns {string}
     */
    #isoDate(d) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    /** Days in a given local month. @param {number} year @param {number} monthIdx @returns {number} */
    #daysInMonth(year, monthIdx) {
      return new Date(year, monthIdx + 1, 0).getDate();
    }
    /**
     * Advance an ISO date string by one recurrence step.
     *
     * For monthly/yearly rules, the day is anchored to `anchorDay` (the template's
     * original day-of-month) and clamped to the target month's length. Without
     * this, `setMonth` overflows (Jan 31 → Mar 3) and a recurrence that lands on a
     * short month would permanently drift earlier (I4).
     * @param {string} iso
     * @param {'daily'|'weekly'|'monthly'|'yearly'} rule
     * @param {number} [interval=1]
     * @param {number|null} [anchorDay=null]  preferred day-of-month (defaults to iso's day)
     * @returns {string}
     */
    stepDate(iso, rule, interval = 1, anchorDay = null) {
      const d = /* @__PURE__ */ new Date(iso + "T12:00:00");
      const n = Math.max(1, Number(interval) || 1);
      const day = anchorDay ?? d.getDate();
      if (rule === "daily") d.setDate(d.getDate() + n);
      else if (rule === "weekly") d.setDate(d.getDate() + 7 * n);
      else if (rule === "monthly") {
        d.setDate(1);
        d.setMonth(d.getMonth() + n);
        d.setDate(Math.min(day, this.#daysInMonth(d.getFullYear(), d.getMonth())));
      } else if (rule === "yearly") {
        d.setDate(1);
        d.setFullYear(d.getFullYear() + n);
        d.setDate(Math.min(day, this.#daysInMonth(d.getFullYear(), d.getMonth())));
      }
      return this.#isoDate(d);
    }
    // ── Main entry ───────────────────────────────────────────────────────
    /**
     * Scan all recurring templates and generate any missing instances up to today.
     * @returns {number} number of transactions generated
     */
    process() {
      const state = this.#store.getState();
      const today = this.#isoDate(/* @__PURE__ */ new Date());
      const txs = state.transactions;
      const templates = txs.filter((t) => t.recurring && !t.recurringSourceId);
      let generated = 0;
      for (const template of templates) {
        if (template.type === "transfer") continue;
        const { rule, interval } = template.recurring;
        const anchorDay = Number(template.date.slice(8, 10)) || 1;
        const instances = txs.filter((t) => t.recurringSourceId === template.id);
        const dates = [template.date, ...instances.map((i) => i.date)].sort();
        let latest = dates[dates.length - 1];
        let next = this.stepDate(latest, rule, interval, anchorDay);
        let safety = 0;
        while (next <= today && (!template.recurring.until || next <= template.recurring.until) && safety++ < 500) {
          const clone = {
            ...template,
            // Deterministic id per (template, date) occurrence so two devices that
            // both backfill the same recurrence collide instead of duplicating.
            id: `${template.id}__${next}`,
            date: next,
            // Snapshot Hijri date at the moment the instance is generated.
            // Uses current offset — this is intentional: the instance is "new"
            // today, so it should reflect the user's current calendar setting.
            hijriDate: this.#hijri.toHijri(next),
            recurringSourceId: template.id,
            recurring: null,
            tags: (template.tags || []).slice(),
            splits: template.splits ? template.splits.map((s) => ({ ...s })) : null
          };
          txs.push(clone);
          generated++;
          next = this.stepDate(next, rule, interval, anchorDay);
        }
      }
      if (generated > 0) this.#store.persist();
      return generated;
    }
  };

  // src/domain/services/ReceiptScanService.js
  var GEMINI_MODEL = "gemini-2.5-flash-lite";
  var GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  var ReceiptScanService = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
    }
    // ── Public API ────────────────────────────────────────────────────────
    /**
     * Scan a receipt image/PDF with Gemini.
     *
     * @param {File} file  Image or PDF selected by the user.
     * @returns {Promise<Object>} Resolves with a prefill object ready to pass
     *   directly to `openModal('transaction', { prefill })`.
     *   Fields: type, amount (major units), currency, accountId, payee, note,
     *           date (YYYY-MM-DD), paymentType, and optionally categoryId or splits.
     * @throws {Error} With a human-readable `.message` on any failure, including
     *   the sentinel `'NO_API_KEY'` when no Gemini key is configured.
     */
    async scan(file) {
      const state = this.#store.getState();
      const apiKey = state.user.geminiApiKey?.trim();
      if (!apiKey) throw new Error("NO_API_KEY");
      let base64, mediaType;
      try {
        base64 = await this.#fileToBase64(file);
        mediaType = file.type || "image/jpeg";
      } catch (_) {
        throw new Error("Could not read the image file. Please try a different file.");
      }
      const cats = state.categories;
      const catLines = this.#buildCategoryLines(cats);
      const fallback = cats.find((c) => c.type === "expense" && !c.parentId) || cats[0];
      const fallbackId = fallback?.id || "";
      const fallbackName = fallback?.name || "General";
      const today = DateService.todayIso();
      const defaultCcy = state.user.defaultCurrency || state.user.homeCurrency || "USD";
      const prompt2 = this.#buildPrompt(defaultCcy, catLines, fallbackId, fallbackName, today);
      let res;
      try {
        res = await fetch(GEMINI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{
              parts: [
                // Image FIRST — consistent with Google's own multimodal examples
                { inline_data: { mime_type: mediaType, data: base64 } },
                { text: prompt2 }
              ]
            }],
            generationConfig: {
              temperature: 0.1,
              // low temperature → deterministic, follows format exactly
              maxOutputTokens: 1024
            }
          })
        });
      } catch (networkErr) {
        throw new Error("Network error \u2014 check your connection and try again.");
      }
      if (!res.ok) {
        let msg = `API error ${res.status}`;
        try {
          const errBody = await res.json();
          msg = errBody.error?.message || msg;
        } catch (_) {
        }
        throw new Error(msg);
      }
      const body = await res.json();
      const raw = (body.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in AI response. The model may have refused the request or returned an unexpected format.");
      }
      let receipt;
      try {
        receipt = JSON.parse(jsonMatch[0]);
      } catch (_) {
        throw new Error("Could not parse the AI response as JSON. Please try again.");
      }
      return this.#buildPrefill(receipt, cats, defaultCcy, today, state.accounts[0]?.id);
    }
    // ── Private helpers ───────────────────────────────────────────────────
    /**
     * Convert a File to a base64-encoded data string (without the data-URL prefix).
     * @param {File} file
     * @returns {Promise<string>}
     */
    #fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    /**
     * Build the category list injected into the prompt.
     * Each line shows the exact database ID the model must copy verbatim,
     * plus the human name and type for context.
     * Subcategories are indented and show "Parent > Child" so the model
     * can pick the most specific match.
     *
     * @param {object[]} cats  Full category array from state.
     * @returns {string}
     */
    #buildCategoryLines(cats) {
      return cats.map((c) => {
        if (c.parentId) {
          const parent = cats.find((p) => p.id === c.parentId);
          return `  ID="${c.id}"  \u2192  ${parent ? parent.name + " > " : ""}${c.name}  [${c.type}]`;
        }
        return `ID="${c.id}"  \u2192  ${c.name}  [${c.type}]`;
      }).join("\n");
    }
    /**
     * Build the complete Gemini prompt string.
     * The prompt instructs the model to return a single JSON object (not an array)
     * with strict schema, using exact category IDs from the injected list.
     */
    #buildPrompt(defaultCurrency, catLines, fallbackId, fallbackName, today) {
      return `You are a receipt parser. Analyze the attached receipt and return ONLY a single valid JSON object. No markdown, no code fences, no explanation \u2014 just the raw JSON.

REQUIRED JSON SHAPE:
{
  "merchant": "store or merchant name",
  "date": "YYYY-MM-DD",
  "total": 0.00,
  "currency": "${defaultCurrency}",
  "note": "one-line description of the purchase",
  "items": [
    { "description": "item label", "qty": "1x", "amount": 0.00, "categoryId": "EXACT_ID_FROM_LIST" }
  ]
}

CATEGORY ID LIST \u2014 you MUST set categoryId to one of these exact ID strings. Copy the ID character-for-character. Do NOT invent IDs, do NOT use the category name as the ID:
${catLines}

FALLBACK: if an item does not match any category well, use ID="${fallbackId}" (${fallbackName}).

RULES:
1. Each item must have a categoryId from the list above \u2014 no exceptions.
2. Group line items sharing the same best-fit category into one, summing their amounts.
3. If the whole receipt is one category, return a single item with the full total.
4. "total" must equal the sum of all item amounts.
5. Date \u2192 YYYY-MM-DD. Use ${today} if the date is not legible on the receipt.
6. Currency \u2192 detect from any symbol/code on the receipt; if absent use "${defaultCurrency}". Always return an ISO 4217 code.
7. "qty" \u2192 full unit detail exactly as printed (count, weight, volume, size, pack). Use "1x" only if no unit info is shown.`;
    }
    /**
     * Validate the parsed receipt object and produce a fully-formed prefill.
     *
     * @param {object}   receipt       Parsed JSON from Gemini
     * @param {object[]} cats          Category array from state
     * @param {string}   defaultCcy    Fallback currency code
     * @param {string}   today         ISO date string
     * @param {string}   defaultAccId  First account ID (default for splits)
     * @returns {Object} prefill object
     */
    #buildPrefill(receipt, cats, defaultCcy, today, defaultAccId) {
      const validCatIds = new Set(cats.map((c) => c.id));
      const currency = (receipt.currency || defaultCcy).toUpperCase();
      const rawItems = Array.isArray(receipt.items) && receipt.items.length > 0 ? receipt.items : [{ description: receipt.note || "Receipt", amount: receipt.total || 0, categoryId: "" }];
      const items = rawItems.map((item) => ({
        ...item,
        categoryId: validCatIds.has(item.categoryId) ? item.categoryId : ""
      }));
      const total = Number(receipt.total) || items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const itemNote = items.map((item) => {
        const qty = item.qty || "1x";
        return `${item.description}: ${qty} \xB7 ${currency} ${Number(item.amount || 0).toFixed(2)}`;
      }).join("\n");
      const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
      const date = receipt.date && ISO_DATE.test(receipt.date) ? receipt.date : today;
      const prefill = {
        type: "expense",
        amount: total,
        // major units — the modal converts via toMinor
        currency,
        accountId: defaultAccId || "",
        payee: receipt.merchant || "",
        note: itemNote || receipt.note || "Scanned from receipt",
        date,
        paymentType: "card"
      };
      if (items.length > 1) {
        prefill.splits = items.map((item) => ({
          categoryId: item.categoryId || null,
          accountId: defaultAccId || "",
          // Splits expect minor units; convert from the major-unit amount Gemini returns
          amount: this.#fx.toMinor(Number(item.amount) || 0, currency)
        }));
        prefill.categoryId = "";
      } else {
        prefill.categoryId = items[0]?.categoryId || "";
      }
      return prefill;
    }
  };

  // src/domain/services/SyncService.js
  var SyncService = class {
    /** @type {Store} */
    #store;
    /** @type {EventBus} */
    #bus;
    /** @type {CurrencyService} */
    #fx;
    // Supabase SDK client (null until sbInit() succeeds)
    #sb = null;
    #user = null;
    #cloudVersion = 0;
    // The version THIS device last wrote. Realtime UPDATE events carrying this
    // version are our own echo and are ignored, so a local push no longer triggers
    // a redundant self-pull (replaceState + re-render + recurring re-scan).
    #lastSelfVersion = 0;
    #saveTimer = null;
    #channel = null;
    #sharesChannel = null;
    #contribChannel = null;
    #subscribed = false;
    // Serialises push/pull so overlapping cloud operations can't interleave and
    // clobber each other (last-pull-wins races).
    #syncing = Promise.resolve();
    // Optimistic-UI tracking for family sharing
    #pendingRemovals = /* @__PURE__ */ new Set();
    #pendingAdditions = /* @__PURE__ */ new Map();
    #sharedData = [];
    constructor() {
      this.#store = Store.getInstance();
      this.#bus = EventBus.getInstance();
      this.#fx = new CurrencyService();
    }
    // ── Init ─────────────────────────────────────────────────────────────
    /** @returns {boolean} true if Supabase is configured */
    isManagedMode() {
      return !!(APP_SUPABASE_URL && APP_SUPABASE_KEY);
    }
    /**
     * Initialise Supabase client.
     * @returns {boolean}
     */
    init() {
      const state = this.#store.getState();
      const url = (APP_SUPABASE_URL || state.user.supabaseUrl || "").trim();
      const key = (APP_SUPABASE_KEY || state.user.supabaseKey || "").trim();
      if (!url || !key) return false;
      try {
        this.#sb = supabase.createClient(url, key, {
          auth: { persistSession: true, autoRefreshToken: true }
        });
        return true;
      } catch (e) {
        console.error("[SyncService] Supabase init error:", e);
        return false;
      }
    }
    // ── Auth ──────────────────────────────────────────────────────────────
    async signInWithGoogle() {
      if (!this.#sb) {
        this.#toast("Configure Supabase first");
        return;
      }
      const redirectTo = window.location.origin + window.location.pathname;
      const { error } = await this.#sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, queryParams: { prompt: "select_account" } }
      });
      if (error) this.#toast("Google sign-in error: " + error.message);
    }
    async signOut() {
      if (!this.#sb) return;
      this.#sb.auth.signOut().catch(() => {
      });
      if (this.#user) this.#resetToGuest(true);
    }
    /** Remove all realtime channels so they don't leak across sessions/users. */
    #teardownChannels() {
      for (const ch of [this.#channel, this.#sharesChannel, this.#contribChannel]) {
        if (ch) {
          try {
            this.#sb?.removeChannel(ch);
          } catch (_) {
          }
        }
      }
      this.#channel = this.#sharesChannel = this.#contribChannel = null;
      this.#subscribed = false;
    }
    async restoreSession() {
      if (!this.#sb) return {};
      this.#sb.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" && session?.user) {
          if (!this.#user) this.#adoptSession(session.user);
        } else if (event === "SIGNED_OUT" && this.#user) {
          this.#resetToGuest(true);
        }
      });
      try {
        const { data } = await this.#sb.auth.getSession();
        const user = data?.session?.user ?? null;
        if (user) {
          const isFirst = await this.#adoptSession(user);
          return { isFirstSignIn: isFirst };
        }
      } catch (e) {
        console.warn("[SyncService] getSession failed:", e);
      }
      this.#resetToGuest(false);
      return { isFirstSignIn: false, needsSignIn: true };
    }
    /**
     * Adopt a restored / freshly signed-in session: pull cloud data + subscribe.
     * @param {object} user
     * @returns {Promise<boolean>} isFirstSignIn
     */
    async #adoptSession(user) {
      if (this.#user) return false;
      this.#user = user;
      this.#emitUser(user);
      this.#emitStatus("syncing");
      this.#bus.emit("auth:changed", { user });
      if (window.location.hash.includes("access_token")) {
        history.replaceState(null, "", window.location.pathname);
      }
      const isFirst = await this.pull();
      this.#subscribe();
      return isFirst;
    }
    /**
     * Drop back to local/guest state, wiping cloud-derived data so the next user
     * never sees the previous one's records.
     * @param {boolean} showSignIn  prompt the sign-in modal (true after sign-out)
     */
    #resetToGuest(showSignIn) {
      this.#teardownChannels();
      this.#user = null;
      this.#cloudVersion = 0;
      this.#sharedData = [];
      this.#pendingRemovals.clear();
      this.#pendingAdditions.clear();
      this.#store.reset(() => SeedFactory.create(), (s) => this.#migrateDefaults(s));
      this.#emitStatus("local");
      this.#emitUser(null);
      this.#bus.emit("auth:changed", { user: null, showSignIn });
    }
    get currentUser() {
      return this.#user;
    }
    get sharedData() {
      return this.#sharedData;
    }
    /**
     * Public entry point to re-pull family shares from the cloud and notify the
     * UI.  The heavy lifting stays in the private #pullFamilyShares(); this
     * wrapper exists because private fields are inaccessible from app.js (#3/#16).
     */
    async pullFamilyShares() {
      await this.#pullFamilyShares();
      this.#bus.emit("state:changed", this.#store.getState());
    }
    // ── Save / Push ───────────────────────────────────────────────────────
    /** Debounced cloud push — called after every local save. */
    schedulePush() {
      if (!this.#sb || !this.#user) return;
      clearTimeout(this.#saveTimer);
      this.#saveTimer = setTimeout(() => this.push(), 1e3);
    }
    /** Public push — serialised through the sync queue. */
    push() {
      this.#syncing = this.#syncing.then(() => this.#doPush()).catch(() => {
      });
      return this.#syncing;
    }
    /**
     * The SINGLE choke point for writing local state to the cloud. Performs an
     * ATOMIC compare-and-swap: the write only succeeds when the row's version
     * still equals the one we last saw. If another device advanced it, zero rows
     * come back and this returns false so the caller can pull+merge instead of
     * blindly clobbering newer data. Every cloud write — the normal push AND the
     * family-contribution writeback — must go through here; a blind upsert
     * anywhere else reintroduces the lost-update race.
     * @param {object} state  the state snapshot to persist
     * @returns {Promise<boolean>} true on success, false if a newer version won
     */
    async #commitState(state) {
      const expected = this.#cloudVersion;
      if (expected > 0) {
        const { data: rows, error: error2 } = await this.#sb.from("user_data").update({ data: state, version: expected + 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", this.#user.id).eq("version", expected).select("version");
        if (error2) throw error2;
        if (!rows || !rows.length) return false;
        this.#cloudVersion = expected + 1;
        this.#lastSelfVersion = this.#cloudVersion;
        return true;
      }
      const { error } = await this.#sb.from("user_data").upsert({
        id: this.#user.id,
        data: state,
        version: 1,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }, { onConflict: "id" });
      if (error) throw error;
      this.#cloudVersion = 1;
      this.#lastSelfVersion = this.#cloudVersion;
      return true;
    }
    async #doPush() {
      if (!this.#sb || !this.#user) return;
      this.#emitStatus("syncing");
      try {
        const ok = await this.#commitState(this.#store.getState());
        if (!ok) {
          this.#toast("Another device saved first \u2014 merging\u2026");
          await this.#doPull();
          return;
        }
        this.#emitStatus("synced");
        await this.#pushFamilyShares();
        await this.#pullMemberContributions();
      } catch (e) {
        console.error("[SyncService] Cloud save error:", e);
        this.#emitStatus("error");
        this.#toast("Sync error: " + (e.message || e));
      }
    }
    // ── Pull ──────────────────────────────────────────────────────────────
    /**
     * Public pull — serialised through the sync queue so concurrent realtime
     * events can't interleave replaceState() calls.
     * @returns {Promise<boolean>} isFirstSignIn
     */
    pull() {
      this.#syncing = this.#syncing.then(() => this.#doPull()).catch(() => false);
      return this.#syncing;
    }
    /** @returns {boolean} isFirstSignIn */
    async #doPull() {
      if (!this.#sb || !this.#user) return false;
      this.#emitStatus("syncing");
      try {
        const { data, error } = await this.#sb.from("user_data").select("data, version, updated_at").eq("id", this.#user.id).single();
        if (error && error.code !== "PGRST116") throw error;
        if (data?.data) {
          this.#store.replaceState(data.data, (s) => this.#migrateDefaults(s));
          this.#cloudVersion = data.version ?? 0;
          new RecurringService().process();
          await this.#pullFamilyShares();
          await this.#pullMemberContributions();
          this.#emitStatus("synced");
          this.#bus.emit("state:changed", this.#store.getState());
          return false;
        } else {
          this.#cloudVersion = 0;
          await this.#doPush();
          this.#emitStatus("synced");
          return true;
        }
      } catch (e) {
        console.error("[SyncService] Cloud load error:", e);
        this.#emitStatus("error");
        this.#toast("Sync error: " + (e.message || e));
        return false;
      }
    }
    // ── Real-time subscription ────────────────────────────────────────────
    #subscribe() {
      if (!this.#sb || !this.#user || this.#subscribed) return;
      this.#subscribed = true;
      this.#channel = this.#sb.channel("pocket_realtime_" + this.#user.id).on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "user_data",
        filter: `id=eq.${this.#user.id}`
      }, (payload) => {
        const v = payload?.new?.version;
        if (v != null && v === this.#lastSelfVersion) return;
        this.pull();
      }).subscribe();
      const email = this.#user.email?.toLowerCase().replace(/[^a-z0-9]/g, "_") || "";
      const sharesChannel = this.#sb.channel("pocket_family_" + email).on("broadcast", { event: "share_updated" }, async () => {
        await this.#pullFamilyShares();
        this.#bus.emit("state:changed", this.#store.getState());
      }).subscribe();
      const contribChannel = this.#sb.channel("pocket_contrib_" + this.#user.id).on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "family_contributions",
        filter: `owner_id=eq.${this.#user.id}`
      }, () => this.#pullMemberContributions()).subscribe();
      this.#sharesChannel = sharesChannel;
      this.#contribChannel = contribChannel;
    }
    // ── Family sharing (private) ─────────────────────────────────────────
    /**
     * Submit a transaction on behalf of a shared-account member.
     *
     * Uses upsert with ignoreDuplicates so a retry never causes a constraint error.
     * Applies an optimistic balance update to #sharedData immediately so the
     * member sees the correct balance without waiting for the owner snapshot.
     * Tracks the tx in #pendingAdditions so it survives the next pullFamilyShares.
     *
     * @param {string} ownerId  Supabase user ID of the account owner
     * @param {object} txData   Transaction object to contribute
     */
    async submitContribution(ownerId, txData) {
      if (!this.#sb || !this.#user) throw new Error("Not signed in");
      const share = this.#sharedData.find((s) => s._ownerId === ownerId);
      const accountId = txData.accountId ?? txData.splits?.[0]?.accountId ?? share?.accounts?.[0]?.id ?? (share?.permission ? Object.keys(share.permission)[0] : null);
      const { error } = await this.#sb.from("family_contributions").upsert({
        owner_id: ownerId,
        member_email: this.#user.email.toLowerCase(),
        account_id: accountId,
        tx_data: txData,
        synced: false
      }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
      if (share) {
        share.transactions = [txData, ...share.transactions || []];
        this.#deriveShareBalances(share);
        this.#pendingAdditions.set(txData.id, { tx: txData, ownerId });
        this.#bus.emit("state:changed", this.#store.getState());
      }
    }
    /**
     * Ask the owner to delete a specific transaction the member previously added.
     *
     * Uses upsert with a stable `del_${txId}` id so the marker is idempotent:
     * a double-tap never causes a unique-constraint error.
     * Applies an optimistic balance revert and hides the tx from #sharedData
     * immediately via #pendingRemovals.
     *
     * @param {string} ownerId  Owner's Supabase user ID
     * @param {string} txId     Transaction ID to delete
     */
    async deleteContribution(ownerId, txId) {
      if (!this.#sb || !this.#user) throw new Error("Not signed in");
      if (this.#pendingRemovals.has(txId)) {
        this.#sharedData.forEach((share2) => {
          share2.transactions = (share2.transactions || []).filter((t) => t.id !== txId);
        });
        this.#bus.emit("state:changed", this.#store.getState());
        return;
      }
      const share = this.#sharedData.find(
        (s) => (s.transactions || []).some((t) => t.id === txId)
      );
      const target = share?.transactions?.find((t) => t.id === txId) || null;
      const accountId = target?.accountId ?? target?.splits?.[0]?.accountId ?? share?.accounts?.[0]?.id ?? (share?.permission ? Object.keys(share.permission)[0] : null);
      this.#pendingRemovals.add(txId);
      if (share) {
        share.transactions = (share.transactions || []).filter((t) => t.id !== txId);
        this.#deriveShareBalances(share);
        this.#bus.emit("state:changed", this.#store.getState());
      }
      const { error } = await this.#sb.from("family_contributions").upsert({
        owner_id: ownerId,
        member_email: this.#user.email.toLowerCase(),
        account_id: accountId,
        tx_data: { _delete: true, id: `del_${txId}`, targetId: txId },
        synced: false
      }, { onConflict: "id", ignoreDuplicates: true });
      if (error) {
        this.#pendingRemovals.delete(txId);
        throw error;
      }
    }
    /**
     * Schedule a pullFamilyShares + state:changed after a delay.
     * Called after shared tx submit/delete to get the owner's confirmed snapshot.
     * @param {number} delayMs
     */
    scheduleSharesRefresh(delayMs) {
      setTimeout(async () => {
        if (!this.#sb || !this.#user) return;
        try {
          await this.#pullFamilyShares();
          this.#bus.emit("state:changed", this.#store.getState());
        } catch (_) {
        }
      }, delayMs);
    }
    /**
     * Re-derive a shared snapshot's account balances from its own transaction
     * list using the SAME LedgerMath authority the rest of the app uses. Replaces
     * the old bespoke optimistic-balance arithmetic, so there is one balance model
     * everywhere. The owner's snapshot carries openingBalance per account, so
     * `openingBalance + ledger(share.transactions)` reproduces the owner's
     * derived balance for each shared account.
     * @param {object} share
     */
    #deriveShareBalances(share) {
      if (!share || !Array.isArray(share.accounts)) return;
      const balances = LedgerMath.balances(share.accounts, share.transactions || [], this.#fx);
      for (const a of share.accounts) a.balance = balances.get(a.id) ?? a.balance ?? 0;
    }
    async #pushFamilyShares() {
      const state = this.#store.getState();
      if (!this.#sb || !this.#user || !state.family?.length) return;
      for (const member of state.family) {
        if (!member.email) continue;
        const permMap = {};
        (member.permissions || []).forEach((p) => {
          permMap[p.accountId] = p.access;
        });
        const sharedIds = Object.keys(permMap);
        if (!sharedIds.length) continue;
        const snapshot = {
          sharedBy: state.user.name || this.#user.email,
          // Owner's home currency so members can embed correct exchangeRate /
          // refAmount on contributed transactions (#21).
          homeCurrency: state.user.homeCurrency,
          permission: permMap,
          accounts: state.accounts.filter((a) => sharedIds.includes(a.id)),
          transactions: state.transactions.filter(
            (t) => permMap[t.accountId] || (t.splits || []).some((s) => permMap[s.accountId])
          ),
          categories: state.categories,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        try {
          await this.#sb.from("family_shares").upsert({
            owner_id: this.#user.id,
            member_email: member.email.toLowerCase().trim(),
            snapshot
          }, { onConflict: "owner_id,member_email" });
          this.#broadcastToMember(member.email.toLowerCase().trim());
        } catch (e) {
          console.warn("[SyncService] pushFamilyShares error:", e);
        }
      }
    }
    #broadcastToMember(email) {
      if (!this.#sb) return;
      const chanName = "pocket_family_" + email.replace(/[^a-z0-9]/g, "_");
      const ch = this.#sb.channel(chanName);
      ch.subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        ch.send({ type: "broadcast", event: "share_updated", payload: {} });
        setTimeout(() => {
          try {
            this.#sb.removeChannel(ch);
          } catch (_) {
          }
        }, 3e3);
      });
    }
    async #pullFamilyShares() {
      if (!this.#sb || !this.#user?.email) return;
      try {
        const { data, error } = await this.#sb.from("family_shares").select("owner_id, snapshot").eq("member_email", this.#user.email.toLowerCase());
        if (error) {
          console.warn("[SyncService] pullFamilyShares error:", error);
          return;
        }
        const rawIds = new Set((data || []).flatMap((r) => (r.snapshot?.transactions || []).map((t) => t.id)));
        this.#sharedData = (data || []).filter((r) => r.snapshot && r.owner_id !== this.#user.id).map((r) => ({ ...r.snapshot, _ownerId: r.owner_id }));
        for (const txId of [...this.#pendingRemovals]) {
          if (!rawIds.has(txId)) this.#pendingRemovals.delete(txId);
        }
        if (this.#pendingRemovals.size) {
          this.#sharedData.forEach((share) => {
            share.transactions = (share.transactions || []).filter((t) => !this.#pendingRemovals.has(t.id));
          });
        }
        for (const [txId, { tx, ownerId }] of [...this.#pendingAdditions]) {
          const share = this.#sharedData.find((s) => s._ownerId === ownerId);
          if (!share) {
            this.#pendingAdditions.delete(txId);
            continue;
          }
          const alreadyIn = (share.transactions || []).some((t) => t.id === txId);
          if (alreadyIn) {
            this.#pendingAdditions.delete(txId);
            continue;
          }
          share.transactions = [tx, ...share.transactions || []];
        }
        for (const share of this.#sharedData) this.#deriveShareBalances(share);
      } catch (e) {
        console.warn("[SyncService] pullFamilyShares error:", e);
      }
    }
    async #pullMemberContributions() {
      if (!this.#sb || !this.#user) return;
      try {
        const { data, error } = await this.#sb.from("family_contributions").select("id, tx_data").eq("owner_id", this.#user.id).eq("synced", false);
        if (error || !data?.length) return;
        const state = this.#store.getState();
        const deleteRows = data.filter((r) => r.tx_data?._delete === true);
        const addRows = data.filter((r) => !r.tx_data?._delete && r.tx_data?.id);
        if (deleteRows.length) {
          const deleteIds = new Set(deleteRows.map((r) => r.tx_data.targetId || r.tx_data.id));
          state.transactions = state.transactions.filter((t) => !deleteIds.has(t.id));
        }
        const existingIds = new Set(state.transactions.map((t) => t.id));
        const newRows = addRows.filter((r) => r.tx_data?.id && !existingIds.has(r.tx_data.id));
        newRows.forEach((row) => {
          const tx = { ...row.tx_data, _fromFamily: true };
          state.transactions.push(tx);
        });
        if (newRows.length || deleteRows.length) {
          this.#store.persist();
          const committed = await this.#commitState(state);
          if (committed) {
            const ids = data.map((r) => r.id);
            await this.#sb.from("family_contributions").update({ synced: true }).in("id", ids);
            await this.#pushFamilyShares();
            this.#bus.emit("state:changed", state);
            const n = newRows.length + deleteRows.length;
            if (n > 0) this.#toast(`${n} family change${n > 1 ? "s" : ""} synced`);
          } else {
            this.#toast("Another device saved first \u2014 merging\u2026");
            await this.#doPull();
          }
        }
      } catch (e) {
        console.warn("[SyncService] pullMemberContributions error:", e);
      }
    }
    // ── Private helpers ──────────────────────────────────────────────────
    #emitStatus(status) {
      this.#bus.emit("sync:status", { status });
    }
    #emitUser(user) {
      this.#bus.emit("sync:user", { user });
    }
    #toast(msg) {
      this.#bus.emit("toast", { message: msg });
    }
    #migrateDefaults(state) {
      StateMigrator.migrate(state, this.#fx);
    }
  };

  // src/domain/services/ThemeService.js
  var ThemeService = class {
    #store;
    constructor(store) {
      this.#store = store;
    }
    apply() {
      const mode = this.#store.getState().user?.theme || "system";
      const dark = mode === "dark" || mode === "system" && window.matchMedia("(prefers-color-scheme:dark)").matches;
      document.documentElement.classList.toggle("dark", dark);
    }
    toggle() {
      const cur = this.#store.getState().user?.theme || "system";
      const next = cur === "light" ? "dark" : cur === "dark" ? "system" : "light";
      this.set(next);
      return next;
    }
    set(mode) {
      const state = this.#store.getState();
      if (!state.user) return mode;
      this.#store.setState((s) => {
        s.user = { ...s.user, theme: mode };
        return { user: s.user };
      });
      this.apply();
      return mode;
    }
  };

  // src/domain/services/PaymentTypeService.js
  var BASE_TYPES = ["card", "cash", "transfer", "cheque", "online"];
  var PaymentTypeService = class {
    #store;
    constructor(store) {
      this.#store = store;
    }
    allTypes() {
      const custom = this.#store.getState().user?.customPaymentTypes || [];
      return [...BASE_TYPES, ...custom];
    }
    addCustom(name) {
      const n = name.trim();
      if (!n) return;
      const state = this.#store.getState();
      if (!Array.isArray(state.user.customPaymentTypes)) state.user.customPaymentTypes = [];
      const list = state.user.customPaymentTypes;
      if (!list.includes(n)) {
        list.push(n);
        this.#store.flush();
      }
      return n;
    }
  };

  // src/domain/services/ExchangeRateService.js
  var ENDPOINT = "https://open.er-api.com/v6/latest/USD";
  var REFRESH_MS = 6 * 60 * 60 * 1e3;
  var ExchangeRateService = class {
    /** @type {Store} */
    #store;
    /** @type {EventBus} */
    #bus;
    constructor() {
      this.#store = Store.getInstance();
      this.#bus = EventBus.getInstance();
    }
    /**
     * Seed the in-memory table from the last persisted live rates, so a reload
     * uses the most recent known rates even before (or without) a network fetch.
     */
    seedFromState() {
      const persisted = this.#store.getState()?.fxRates;
      if (persisted && typeof persisted === "object") this.#merge(persisted);
    }
    /**
     * Fetch the latest rates if the cached set is stale (or `force`), update the
     * live table, persist, and notify the UI so totals re-render.
     * Failures are swallowed — the app keeps using the last-known/seed rates.
     * @param {boolean} [force=false]
     * @returns {Promise<boolean>} true if rates were updated
     */
    async refresh(force = false) {
      const state = this.#store.getState();
      const last = state.fxRatesUpdatedAt ? Date.parse(state.fxRatesUpdatedAt) : 0;
      if (!force && last && Date.now() - last < REFRESH_MS) return false;
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const rates = json?.rates;
        if (!rates || typeof rates.USD !== "number") throw new Error("Unexpected payload");
        this.#merge(rates);
        state.fxRates = { ...RATES };
        state.fxRatesUpdatedAt = (/* @__PURE__ */ new Date()).toISOString();
        this.#store.persist();
        this.#bus.emit("state:changed", state);
        return true;
      } catch (e) {
        console.warn("[ExchangeRateService] rate refresh failed:", e);
        return false;
      }
    }
    /** When the rates were last refreshed (ISO), or null. */
    get lastUpdated() {
      return this.#store.getState()?.fxRatesUpdatedAt ?? null;
    }
    /** Merge only valid positive numbers into the live table (in place). */
    #merge(map) {
      for (const [code, value] of Object.entries(map)) {
        if (typeof value === "number" && isFinite(value) && value > 0) RATES[code] = value;
      }
    }
  };

  // src/ui/components/Toast.js
  var Toast = class {
    /** @type {HTMLElement|null} */
    #el = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    #timer = null;
    /** @type {number} */
    #duration;
    /**
     * @param {object} [opts]
     * @param {number} [opts.duration=1800]  auto-dismiss delay in ms
     */
    constructor({ duration = 1800 } = {}) {
      this.#duration = duration;
    }
    // ── Lifecycle ────────────────────────────────────────────────────────
    /**
     * Mount the toast element and subscribe to the EventBus.
     * @param {HTMLElement} [container=document.body]
     */
    mount(container = document.body) {
      this.#el = document.createElement("div");
      this.#el.id = "toast";
      this.#el.className = "toast";
      container.appendChild(this.#el);
      EventBus.getInstance().on("toast", ({ message }) => this.show(message));
    }
    // ── Public API ───────────────────────────────────────────────────────
    /**
     * Show a toast message.
     * @param {string} message
     */
    show(message) {
      if (!this.#el) return;
      this.#el.textContent = message;
      this.#el.classList.add("show");
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.hide(), this.#duration);
    }
    /** Immediately hide the toast. */
    hide() {
      this.#el?.classList.remove("show");
    }
  };

  // src/ui/components/Modal.js
  var Modal = class {
    /** @type {HTMLElement|null} */
    #backdrop = null;
    /** @type {HTMLElement|null} */
    #card = null;
    /** @type {string|null} */
    #active = null;
    /** @type {object|null} */
    #currentOpts = null;
    /** @type {Map<string, object>}  name → ModalView instance */
    #registry = /* @__PURE__ */ new Map();
    constructor() {
    }
    // ── Lifecycle ────────────────────────────────────────────────────────
    /**
     * Mount the backdrop + card elements.
     * @param {HTMLElement} [container=document.body]
     */
    mount(container = document.body) {
      this.#backdrop = document.createElement("div");
      this.#backdrop.id = "modalRoot";
      this.#backdrop.className = "modal-backdrop";
      this.#backdrop.addEventListener("click", (e) => {
        if (e.target === this.#backdrop) this.close();
      });
      this.#card = document.createElement("div");
      this.#card.id = "modalCard";
      this.#card.className = "modal";
      this.#card.addEventListener("click", (e) => e.stopPropagation());
      this.#backdrop.appendChild(this.#card);
      container.appendChild(this.#backdrop);
    }
    // ── Registry ─────────────────────────────────────────────────────────
    /**
     * Register a named modal view.
     * @param {string} name
     * @param {object} view  must implement render(opts) → string
     */
    register(name, view) {
      this.#registry.set(name, view);
    }
    // ── Open / Close ─────────────────────────────────────────────────────
    /**
     * Open a named modal.
     * @param {string} name
     * @param {object} [opts={}]  passed through to view.render(opts)
     */
    open(name, opts = {}) {
      if (name === "_raw") {
        this.#active = "_raw";
        this.#currentOpts = opts;
        this.#card.innerHTML = opts.html || "";
        this.#backdrop.classList.add("open");
        document.body.style.overflow = "hidden";
        if (typeof lucide !== "undefined") lucide.createIcons();
        return;
      }
      const view = this.#registry.get(name);
      if (!view) {
        console.warn(`[Modal] No view registered for "${name}"`);
        return;
      }
      this.#active = name;
      this.#currentOpts = opts;
      view.onOpen?.(opts, this.#card);
      this.#card.innerHTML = view.render(opts);
      this.#backdrop.classList.add("open");
      document.body.style.overflow = "hidden";
      if (typeof lucide !== "undefined") lucide.createIcons();
      EventBus.getInstance().emit("modal:opened", { name, opts });
    }
    /**
     * Re-render the currently open modal in-place using stored opts.
     * Call this after mutating modal view state (e.g. toggling splits).
     */
    refresh() {
      if (!this.#active || this.#active === "_raw") return;
      const view = this.#registry.get(this.#active);
      if (!view || !this.#card) return;
      this.#card.innerHTML = view.render(this.#currentOpts ?? {});
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
    /** Close the active modal. */
    close() {
      this.#backdrop.classList.remove("open");
      document.body.style.overflow = "";
      const prev = this.#active;
      this.#active = null;
      this.#card.innerHTML = "";
      EventBus.getInstance().emit("modal:closed", { name: prev });
    }
    /** @returns {string|null} name of the currently open modal */
    get active() {
      return this.#active;
    }
    /** @returns {boolean} */
    get isOpen() {
      return this.#active !== null;
    }
    /**
     * Update the card content in-place (used by modals that re-render on user
     * input without closing, e.g. when toggling splits mode).
     * @param {string} html
     */
    updateContent(html) {
      if (!this.#card) return;
      this.#card.innerHTML = html;
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  };

  // src/core/Html.js
  var Html = class {
    /**
     * Escape text / double-quoted attribute content.
     * @param {*} s
     * @returns {string}
     */
    static escape(s) {
      return (s ?? "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
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
      return (s ?? "").toString().replace(/\\/g, "\\\\").replace(/'/g, "\\u0027").replace(/"/g, "\\u0022").replace(/</g, "\\u003C").replace(/>/g, "\\u003E").replace(/&/g, "\\u0026").replace(/\r?\n/g, "");
    }
    /**
     * Validate a CSS hex colour; fall back to a neutral grey when invalid.
     * @param {*} c
     * @param {string} [fallback='#71717a']
     * @returns {string}
     */
    static color(c, fallback = "#71717a") {
      return /^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : fallback;
    }
    /**
     * Validate a Lucide icon slug (lowercase letters + hyphens); fall back safely.
     * @param {*} name
     * @param {string} [fallback='circle']
     * @returns {string}
     */
    static icon(name, fallback = "circle") {
      return /^[a-z][a-z0-9-]*$/.test(name || "") ? name : fallback;
    }
  };

  // src/ui/components/Navigation.js
  var Navigation = class _Navigation {
    /** @type {HTMLElement|null} */
    #sidebar = null;
    /** @type {HTMLElement|null} */
    #bottomNav = null;
    /** @type {HTMLElement|null} */
    #authPill = null;
    /** @type {EventBus} */
    #bus;
    /** @type {Router} */
    #router;
    /** Last known sync status — re-applied whenever the pill is re-rendered */
    #lastSyncStatus = null;
    /** Callbacks set by Application so navigation can trigger actions */
    #onNavigate = null;
    #onAdd = null;
    #onMore = null;
    #onSettings = null;
    #onToggleTheme = null;
    #onSignIn = null;
    #onSignOut = null;
    constructor() {
      this.#bus = EventBus.getInstance();
      this.#router = Router.getInstance();
    }
    // ── Lifecycle ────────────────────────────────────────────────────────
    /**
     * Connect DOM elements and attach event listeners.
     * @param {object} callbacks
     */
    mount(callbacks = {}) {
      this.#sidebar = document.getElementById("sidebarNav");
      this.#bottomNav = document.getElementById("bottomNav");
      this.#authPill = document.getElementById("authPill");
      this.#onNavigate = callbacks.onNavigate || (() => {
      });
      this.#onAdd = callbacks.onAdd || (() => {
      });
      this.#onMore = callbacks.onMore || (() => {
      });
      this.#onSettings = callbacks.onSettings || (() => {
      });
      this.#onToggleTheme = callbacks.onToggleTheme || (() => {
      });
      this.#onSignIn = callbacks.onSignIn || (() => {
      });
      this.#onSignOut = callbacks.onSignOut || (() => {
      });
      this.#bus.on("route:changed", () => this.render());
      this.#bus.on("sync:user", ({ user }) => this.renderAuthPill(user));
      this.#bus.on("sync:status", ({ status }) => {
        this.#lastSyncStatus = status;
        this.updateSyncIndicator(status);
      });
      this.render();
      this.renderAuthPill(null);
    }
    // ── Rendering ────────────────────────────────────────────────────────
    render() {
      const current = this.#router.current;
      if (this.#sidebar) this.#sidebar.innerHTML = this.#renderSidebar(current);
      if (this.#bottomNav) this.#bottomNav.innerHTML = this.#renderBottomTabs(current);
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
    // Sub-routes that should light up a parent nav item
    static #ALIAS = { accountDetail: "accounts", budgetDetail: "budgets" };
    #renderSidebar(current) {
      const active = _Navigation.#ALIAS[current] ?? current;
      return NAV_ITEMS.map((n) => `
        <a class="nav-item ${active === n.id ? "active" : ""}"
           onclick="window.__app.navigate('${n.id}')">
          <i data-lucide="${n.icon}"></i> ${n.label}
        </a>`).join("");
    }
    #renderBottomTabs(current) {
      const active = _Navigation.#ALIAS[current] ?? current;
      return MOBILE_TABS.map((n) => `
        <a class="tab-item ${active === n.id ? "active" : ""}"
           onclick="window.__app.navigate('${n.id}')">
          <i data-lucide="${n.icon}" style="width:22px;height:22px"></i>
          <span>${n.label}</span>
        </a>`).join("");
    }
    /**
     * Render the auth pill in the sidebar.
     * @param {object|null} user  Supabase user object, or null
     */
    renderAuthPill(user) {
      if (!this.#authPill) return;
      if (user) {
        const initial = (user.email?.[0] || "?").toUpperCase();
        this.#authPill.innerHTML = `
        <div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800">
          <div class="w-6 h-6 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 grid place-items-center text-xs font-bold flex-shrink-0">
            ${initial}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs font-medium truncate">${this.#esc(user.email || "")}</div>
            <div id="syncIndicator" class="flex items-center gap-1 mt-0.5"></div>
          </div>
          <button id="signOutBtn" title="Sign out"
                  class="p-1.5 -mr-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <i data-lucide="log-out" style="width:15px;height:15px"></i>
          </button>
        </div>`;
        const btn = this.#authPill.querySelector("#signOutBtn");
        if (btn) btn.addEventListener("click", () => this.#onSignOut?.());
        if (this.#lastSyncStatus) this.updateSyncIndicator(this.#lastSyncStatus);
      } else {
        this.#authPill.innerHTML = `
        <button onclick="window.__app.openModal('auth')"
                class="nav-item w-full justify-center gap-2 border border-zinc-200 dark:border-zinc-800">
          <i data-lucide="cloud" style="width:15px;height:15px"></i>
          <span class="text-sm">Sign in / Sign up</span>
        </button>`;
      }
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
    /**
     * Update the sync status badge inside the auth pill.
     * @param {'local'|'syncing'|'synced'|'error'} status
     */
    updateSyncIndicator(status) {
      const el = document.getElementById("syncIndicator");
      if (!el) return;
      const MAP = {
        local: { icon: "hard-drive", color: "#71717a", label: "Local only" },
        syncing: { icon: "loader", color: "#3b82f6", label: "Syncing\u2026" },
        synced: { icon: "cloud-check", color: "#10b981", label: "Synced" },
        error: { icon: "cloud-off", color: "#ef4444", label: "Sync error" }
      };
      const s = MAP[status] || MAP.local;
      el.innerHTML = `
      <i data-lucide="${s.icon}" style="width:13px;height:13px;color:${s.color}"></i>
      <span style="color:${s.color};font-size:11px">${s.label}</span>`;
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
    // ── Helpers ──────────────────────────────────────────────────────────
    #esc(s) {
      return Html.escape(s);
    }
  };

  // src/ui/views/BaseView.js
  var BaseView = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    /** @type {HijriCalendarService} */
    #hijri;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
      this.#hijri = new HijriCalendarService();
    }
    // ── Contract ─────────────────────────────────────────────────────────
    /**
     * Render the view to an HTML string.
     * Must be overridden by subclasses.
     * @returns {string}
     */
    render() {
      throw new Error(`${this.constructor.name} must implement render()`);
    }
    /**
     * Hook called after the rendered HTML has been injected into the DOM.
     * Override to draw charts, attach custom event listeners, etc.
     */
    onAfterRender() {
    }
    // ── Shared state accessors ───────────────────────────────────────────
    get state() {
      return this.#store.getState();
    }
    get homeCurrency() {
      return this.state.user.homeCurrency;
    }
    // ── Formatting helpers ───────────────────────────────────────────────
    /**
     * @param {number} minor
     * @param {string} currency
     * @returns {string}
     */
    formatMoney(minor, currency) {
      return this.#fx.formatMoney(minor, currency);
    }
    /**
     * @param {number} minor   source currency minor units
     * @param {string} from
     * @param {string} to
     * @returns {number}
     */
    convert(minor, from, to) {
      return this.#fx.convert(minor, from, to);
    }
    /** @param {number} minor @param {string} currency @returns {number} */
    fromMinor(minor, currency) {
      return this.#fx.fromMinor(minor, currency);
    }
    /** @param {number|string} amount @param {string} currency @returns {number} */
    toMinor(amount, currency) {
      return this.#fx.toMinor(amount, currency);
    }
    /**
     * Human-readable date label respecting user preferences.
     * @param {string} iso  YYYY-MM-DD
     * @returns {string}
     */
    dateLabel(iso) {
      const d = /* @__PURE__ */ new Date(iso + "T12:00:00");
      const now = /* @__PURE__ */ new Date();
      const yest = new Date(now);
      yest.setDate(yest.getDate() - 1);
      let label;
      if (d.toDateString() === now.toDateString()) label = "Today";
      else if (d.toDateString() === yest.toDateString()) label = "Yesterday";
      else label = this.#formatDateUser(iso);
      if (this.state.user?.showHijri) {
        const h = this.#hijri.toHijri(iso);
        label += ` \xB7 ${h.day} ${this.#hijri.monthsShort[h.month]}`;
      }
      return label;
    }
    /**
     * Hijri date + miqaat badge HTML for a Gregorian date.
     * @param {string} iso
     * @returns {string}
     */
    hijriBadge(iso) {
      if (!this.state.user?.showHijri) return "";
      const top = this.#hijri.topMiqaat(this.#hijri.miqaatsForGregorian(iso));
      if (!top) return "";
      const color = top.p === 1 ? "#f59e0b" : top.p === 2 ? "#a855f7" : "#94a3b8";
      return `<span title="${this.escapeHtml(top.t)}" class="inline-flex items-center" style="color:${color}">
      <i data-lucide="moon-star" style="width:13px;height:13px"></i>
    </span>`;
    }
    /**
     * Escape HTML special characters.
     * @param {string|any} s
     * @returns {string}
     */
    escapeHtml(s) {
      return Html.escape(s);
    }
    /**
     * Empty-state card HTML.
     * @param {string} title
     * @param {string} subtitle
     * @returns {string}
     */
    emptyState(title, subtitle) {
      return `
      <div class="text-center py-8">
        <div class="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 grid place-items-center mb-3">
          <i data-lucide="inbox"></i>
        </div>
        <div class="font-semibold">${this.escapeHtml(title)}</div>
        <div class="text-sm text-zinc-500 mt-1">${this.escapeHtml(subtitle)}</div>
      </div>`;
    }
    // ── Private helpers ──────────────────────────────────────────────────
    #formatDateUser(iso) {
      const fmt = this.state.user.dateFormat || "auto";
      if (fmt === "auto") {
        const d2 = /* @__PURE__ */ new Date(iso + "T12:00:00");
        const now = /* @__PURE__ */ new Date();
        return d2.toLocaleDateString(void 0, {
          month: "short",
          day: "numeric",
          year: d2.getFullYear() === now.getFullYear() ? void 0 : "numeric"
        });
      }
      const [y, m, d] = iso.split("-");
      if (fmt === "YYYY-MM-DD") return `${y}-${m}-${d}`;
      if (fmt === "MM/DD/YYYY") return `${m}/${d}/${y}`;
      if (fmt === "DD/MM/YYYY") return `${d}/${m}/${y}`;
      return iso;
    }
  };

  // src/domain/services/ReportService.js
  var ReportService = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    /** @type {TransactionService} */
    #txs;
    /** @type {HijriCalendarService} */
    #hijri;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
      this.#txs = new TransactionService();
      this.#hijri = new HijriCalendarService();
    }
    // ── Date helpers ─────────────────────────────────────────────────────
    /** @param {string} iso @param {number|'all'|'month'} range @returns {boolean} */
    withinRange(iso, range) {
      if (range === "all") return true;
      const d = /* @__PURE__ */ new Date(iso + "T12:00:00");
      if (range === "month") return d >= this.startOfMonth();
      const start = /* @__PURE__ */ new Date();
      start.setDate(start.getDate() - Number(range));
      return d >= start;
    }
    /** @returns {Date} */
    startOfMonth(d = /* @__PURE__ */ new Date()) {
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }
    // ── Aggregations ─────────────────────────────────────────────────────
    /**
     * Spending grouped by category over a date range.
     * @param {number|'all'} rangeDays
     * @returns {{ categoryId: string, amount: number }[]}  sorted desc
     */
    spendingByCategory(rangeDays) {
      const state = this.#store.getState();
      const home = state.user.homeCurrency;
      const byCat = {};
      state.transactions.filter((t) => t.type === "expense" && this.withinRange(t.date, rangeDays)).forEach((t) => {
        for (const slice of this.#txs.categoryAmounts(t)) {
          if (!slice.categoryId) continue;
          byCat[slice.categoryId] = (byCat[slice.categoryId] || 0) + this.#fx.convert(slice.amount, slice.currency, home);
        }
      });
      return Object.entries(byCat).map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
    }
    /**
     * Daily expense totals (major units, home currency) for the last N days.
     * @param {number} days
     * @returns {{ date: string, amount: number }[]}
     */
    dailyExpenses(days) {
      const state = this.#store.getState();
      const home = state.user.homeCurrency;
      const keys = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = /* @__PURE__ */ new Date();
        d.setDate(d.getDate() - i);
        keys.push(DateService.toIso(d));
      }
      const totals = Object.fromEntries(keys.map((k) => [k, 0]));
      state.transactions.filter((t) => t.type === "expense" && keys.includes(t.date)).forEach((t) => {
        totals[t.date] += this.#fx.fromMinor(
          this.#fx.convert(t.amount, t.currency, home),
          home
        );
      });
      return keys.map((date) => ({ date, amount: totals[date] }));
    }
    /**
     * Top N expense transactions in a range, sorted by value desc.
     * @param {number} n
     * @param {number|'all'} rangeDays
     * @returns {{ tx: object, value: number }[]}
     */
    topTransactions(n, rangeDays) {
      const state = this.#store.getState();
      const home = state.user.homeCurrency;
      return state.transactions.filter((t) => t.type === "expense" && this.withinRange(t.date, rangeDays)).map((t) => ({ tx: t, value: this.#fx.convert(t.amount, t.currency, home) })).sort((a, b) => b.value - a.value).slice(0, n);
    }
    /**
     * Net-worth time series in the user's home currency.
     * Strategy: snapshot balances, walk transactions in reverse to recover
     * starting balances, then walk forward emitting a point per unique date.
     * @returns {{ date: string, netWorth: number }[]}
     */
    netWorthSeries() {
      const state = this.#store.getState();
      const home = state.user.homeCurrency;
      const accounts = state.accounts;
      const openingTotal = accounts.reduce(
        (s, a) => s + this.#fx.convert(Number(a.openingBalance ?? 0) || 0, a.currency, home),
        0
      );
      if (!state.transactions.length) {
        return [{ date: DateService.todayIso(), netWorth: Math.round(openingTotal) }];
      }
      const txsAsc = state.transactions.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));
      const byId = new Map(accounts.map((a) => [a.id, a]));
      const homeDelta = (t) => {
        let d = 0;
        for (const c of LedgerMath.contributions(t)) {
          const acc = byId.get(c.accountId);
          if (!acc) continue;
          const m = Number.isFinite(c.minor) ? c.minor : 0;
          d += this.#fx.convert(m, c.currency, home);
        }
        return d;
      };
      const series = [];
      let running = openingTotal;
      let curDate = null;
      for (const t of txsAsc) {
        if (curDate !== null && curDate !== t.date) {
          series.push({ date: curDate, netWorth: Math.round(running) });
        }
        curDate = t.date;
        running += homeDelta(t);
      }
      if (curDate) series.push({ date: curDate, netWorth: Math.round(running) });
      const today = DateService.todayIso();
      if (!series.length || series[series.length - 1].date !== today) {
        series.push({ date: today, netWorth: Math.round(running) });
      }
      return series;
    }
    /**
     * Spending grouped by Hijri month.
     * @param {number|'all'} rangeDays
     * @returns {{ year: number, month: number, amount: number }[]}
     */
    spendingByHijriMonth(rangeDays) {
      const state = this.#store.getState();
      const home = state.user.homeCurrency;
      const byMonth = {};
      state.transactions.filter((t) => t.type === "expense" && this.withinRange(t.date, rangeDays)).forEach((t) => {
        const h = this.#hijri.toHijri(t.date);
        const k = `${h.year}-${h.month}`;
        byMonth[k] = (byMonth[k] || 0) + this.#fx.convert(t.amount, t.currency, home);
      });
      return Object.entries(byMonth).map(([k, v]) => {
        const [y, m] = k.split("-").map(Number);
        return { year: y, month: m, amount: v };
      }).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    }
  };

  // src/ui/views/TransactionRowRenderer.js
  var TransactionRowRenderer = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    /** @type {HijriCalendarService} */
    #hijri;
    /** @type {TransactionService} */
    #txService;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
      this.#hijri = new HijriCalendarService();
      this.#txService = new TransactionService();
    }
    // ── Public API ───────────────────────────────────────────────────────
    /**
     * Render a single transaction as an HTML string.
     *
     * @param {object} tx        The transaction object
     * @param {object} [opts={}]
     *   @param {object|null}  opts.account      Account context (account-detail view)
     *   @param {boolean}      opts.isShared     Viewing a shared account
     *   @param {number|null}  opts.shareIndex   Index into shared-data array
     *   @param {object|null}  opts.share        Shared-data snapshot (live reference)
     *   @param {object[]}     opts.categories   Category list override (shared context)
     *   @param {object[]}     opts.transactions Transaction list override (shared context)
     *   @param {boolean}      opts.multiSelect  Multi-select mode active
     *   @param {Set<string>}  opts.selectedIds  Currently-selected IDs
     * @returns {string} HTML string
     */
    render(tx, opts = {}) {
      const ctx = this.#buildCtx(opts);
      return this.#renderRow(tx, ctx);
    }
    // ── Private helpers ──────────────────────────────────────────────────
    #buildCtx(opts) {
      const state = this.#store.getState();
      const account = opts.account || null;
      const isShared = opts.isShared || false;
      const shareIndex = isShared ? opts.shareIndex ?? null : null;
      const share = opts.share || null;
      const cats = opts.categories || (isShared && share ? share.categories : state.categories);
      const txs = opts.transactions || (isShared && share ? share.transactions : state.transactions);
      const perm = isShared && account ? (share?.permission || {})[account.id] || "view" : isShared ? "view" : "owner";
      const currentUserEmail = state._currentUserEmail || null;
      return {
        account,
        perm,
        shareIndex,
        isShared,
        share,
        cats,
        txs,
        home: state.user.homeCurrency,
        currentUserEmail,
        canDelete: perm === "full" || perm === "owner",
        canEditTx: perm === "edit" || perm === "full" || perm === "owner",
        findCat: (id) => cats.find((c) => c.id === id) || null,
        catFullName: (id) => {
          const c = cats.find((x) => x.id === id);
          if (!c) return "";
          if (c.parentId) {
            const p = cats.find((x) => x.id === c.parentId);
            if (p) return `${p.name} / ${c.name}`;
          }
          return c.name;
        },
        multiSelect: opts.multiSelect || false,
        selectedIds: opts.selectedIds || /* @__PURE__ */ new Set()
      };
    }
    #renderRow(t, ctx) {
      const {
        account,
        perm,
        shareIndex,
        isShared,
        canDelete,
        home,
        findCat,
        catFullName,
        txs,
        multiSelect,
        selectedIds,
        currentUserEmail
      } = ctx;
      const cat = findCat(t.categoryId);
      const acc = account || this.#getAccount(t.accountId);
      const safeColor = Html.color(cat?.color);
      const safeIcon = t.type === "transfer" ? "arrow-right-left" : Html.icon(cat?.icon);
      let sign, displayAmount, displayCurrency, origLine = "";
      if (account) {
        const impact = this.#txService.impactOnAccount(t, account);
        sign = impact.dir;
        displayAmount = impact.minorInAcc;
        displayCurrency = account.currency;
        origLine = t.currency !== account.currency ? `<div class="text-xs text-zinc-500">orig ${this.#fx.formatMoney(t.amount, t.currency)}</div>` : account.currency !== home ? `<div class="text-xs text-zinc-500">${this.#fx.formatMoney(this.#fx.convert(impact.minorInAcc, account.currency, home), home)}</div>` : "";
      } else {
        sign = t.type === "expense" ? "-" : t.type === "income" ? "+" : "";
        displayAmount = t.amount;
        displayCurrency = t.currency;
        origLine = t.currency !== home ? `<div class="text-xs text-zinc-500">${this.#fx.formatMoney(this.#fx.convert(t.amount, t.currency, home), home)}</div>` : "";
      }
      const color = sign === "-" ? "text-rose-500" : sign === "+" ? "text-emerald-500" : "text-zinc-500";
      const isOwnContrib = isShared && !!currentUserEmail && t.addedBy === currentUserEmail;
      const canDeleteRow = canDelete || isOwnContrib;
      const jsId = Html.js(t.id);
      const jsAcc = Html.js(acc?.id || t.accountId);
      const idxNum = Number(shareIndex) || 0;
      const clickFn = isShared ? perm === "edit" || perm === "full" ? `window.__app.openSharedTxEdit(${idxNum},'${jsAcc}','${jsId}')` : null : `window.__app.openModal('transaction',{id:'${jsId}'})`;
      const deleteFn = isShared ? isOwnContrib ? `window.__app.deleteSharedContrib(${idxNum},'${jsId}')` : `window.__app.deleteSharedTx(${idxNum},'${jsId}')` : `window.__app.deleteTx('${jsId}')`;
      let subline = "";
      if (t.type === "transfer" && t.transferPairId) {
        const pair = txs.find((x) => x.id === t.transferPairId);
        const other = pair ? this.#getAccount(pair.accountId) : null;
        const arrow = sign === "-" ? "\u2192" : sign === "+" ? "\u2190" : "\u2194";
        subline = `Transfer ${arrow} ${this.#esc(other?.name || "\u2014")}${pair && pair.currency !== t.currency ? ` \xB7 ${this.#fx.formatMoney(pair.amount, pair.currency)}` : ""}`;
      } else if (Array.isArray(t.splits) && t.splits.length) {
        if (account) {
          subline = `Split \xB7 ${t.splits.length} categor${t.splits.length === 1 ? "y" : "ies"} \xB7 ${this.#esc(account.name)}`;
        } else {
          const uniqAccs = new Set(t.splits.map((s) => s.accountId || t.accountId));
          subline = `Split across ${t.splits.length} categories \xB7 ${this.#esc(uniqAccs.size > 1 ? `${uniqAccs.size} accounts` : acc?.name || "")}`;
        }
      } else {
        const catName = this.#esc(catFullName(t.categoryId) || "\u2014");
        const accName = this.#esc(acc?.name || "");
        subline = accName ? `${catName} \xB7 ${accName}` : catName;
      }
      const state = this.#store.getState();
      const hijriDate = state.user?.showHijri ? this.#hijri.toHijri(t.date) : null;
      const isSelected = selectedIds.has(t.id);
      if (multiSelect) {
        return `
        <label class="w-full flex items-center gap-3 px-3 py-2.5 cursor-pointer ${isSelected ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"} transition">
          <input type="checkbox" ${isSelected ? "checked" : ""}
                 onchange="window.__app.toggleTxSelection('${jsId}')"
                 class="w-4 h-4 rounded accent-blue-500"
                 onclick="event.stopPropagation()">
          <div class="icon-pill" style="background:${safeColor}22;color:${safeColor}">
            <i data-lucide="${safeIcon}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">${this.#esc(t.payee || cat?.name || (t.type === "transfer" ? "Transfer" : "Transaction"))}</div>
            <div class="text-xs text-zinc-500 truncate">${subline}</div>
          </div>
          <div class="text-right">
            <div class="font-semibold ${color}">${sign}${this.#fx.formatMoney(displayAmount, displayCurrency)}</div>
          </div>
        </label>`;
      }
      const title = this.#esc(t.payee || cat?.name || (t.type === "transfer" ? "Transfer" : "Transaction"));
      const hijriShort = this.#hijri.monthsShort;
      const badges = [
        state.user?.showHijri ? this.#hijriBadge(t.date) : "",
        Array.isArray(t.splits) && t.splits.length ? `<span class="chip" style="font-size:.65rem;padding:.1rem .4rem">\u2197 ${t.splits.length} splits</span>` : "",
        t.recurring ? `<span class="chip" style="font-size:.65rem;padding:.1rem .4rem" title="Repeats ${this.#esc(t.recurring.rule)}">\u27F3 ${this.#esc(t.recurring.rule)}</span>` : "",
        t.recurringSourceId ? `<span class="chip" style="font-size:.65rem;padding:.1rem .4rem;opacity:.65">\u27F3</span>` : "",
        !isShared && t._fromFamily ? `<span class="chip" style="font-size:.58rem;padding:.1rem .3rem;background:#818cf822;color:#818cf8">family</span>` : ""
      ].filter(Boolean).join("");
      const rowBody = `
      <div class="icon-pill" style="background:${safeColor}22;color:${safeColor}">
        <i data-lucide="${safeIcon}"></i>
      </div>
      <div class="flex-1 min-w-0">
        <div class="font-medium truncate flex items-center gap-1.5">${title}${badges}</div>
        <div class="text-xs text-zinc-500 truncate">
          ${subline}${hijriDate ? ` \xB7 ${hijriDate.day} ${hijriShort[hijriDate.month]}` : ""}${t.addedBy ? ` \xB7 by ${this.#esc(t.addedBy)}` : ""}
        </div>
      </div>
      <div class="text-right">
        <div class="font-semibold ${color}">${sign}${this.#fx.formatMoney(displayAmount, displayCurrency)}</div>
        ${origLine}
      </div>`;
      const inner = clickFn ? `<button onclick="${clickFn}" class="tx-row-content w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 transition">${rowBody}</button>` : `<div class="tx-row-content w-full flex items-center gap-3 px-3 py-2.5">${rowBody}</div>`;
      return canDeleteRow ? `<div class="tx-swipe-wrapper"
             ontouchstart="window.__app.onTxSwipeStart(event,'${jsId}',${shareIndex !== null ? idxNum : -1},${isOwnContrib})"
             ontouchmove="window.__app.onTxSwipeMove(event)"
             ontouchend="window.__app.onTxSwipeEnd()">
           <div class="tx-delete-bg"><i data-lucide="trash-2" style="color:white;width:18px;height:18px"></i></div>
           ${inner}
         </div>` : inner;
    }
    #hijriBadge(iso) {
      const state = this.#store.getState();
      if (!state.user?.showHijri) return "";
      const top = this.#hijri.topMiqaat(this.#hijri.miqaatsForGregorian(iso));
      if (!top) return "";
      const color = top.p === 1 ? "#f59e0b" : top.p === 2 ? "#a855f7" : "#94a3b8";
      return `<span title="${this.#esc(top.t)}" class="inline-flex items-center" style="color:${color}">
      <i data-lucide="moon-star" style="width:13px;height:13px"></i>
    </span>`;
    }
    #getAccount(id) {
      return this.#store.getState().accounts.find((a) => a.id === id) || null;
    }
    #esc(s) {
      return Html.escape(s);
    }
  };

  // src/ui/views/DashboardView.js
  var DashboardView = class extends BaseView {
    /** @type {ReportService} */
    #reports;
    /** @type {HijriCalendarService} */
    #hijri;
    /** @type {TransactionRowRenderer} */
    #rowRenderer;
    /** @type {object|null} */
    #chart = null;
    constructor() {
      super();
      this.#reports = new ReportService();
      this.#hijri = new HijriCalendarService();
      this.#rowRenderer = new TransactionRowRenderer();
    }
    render() {
      const { state, homeCurrency: home } = this;
      const monthStart = this.#reports.startOfMonth();
      const monthTx = state.transactions.filter((t) => /* @__PURE__ */ new Date(t.date + "T12:00:00") >= monthStart);
      const income = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
      const expense = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
      const total = state.accounts.filter((a) => !a.archived).reduce((s, a) => s + this.convert(a.balance, a.currency, home), 0);
      const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
      const todayIso = DateService.todayIso();
      const todayH = this.#hijri.toHijri(todayIso);
      const todayMiq = this.#hijri.miqaatsFor(todayH);
      return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <div class="text-xs uppercase tracking-wider text-zinc-500">Overview</div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <button class="btn btn-primary hidden md:inline-flex"
                onclick="window.__app.openModal('transaction')">
          <i data-lucide="plus"></i> New transaction
        </button>
      </div>

      ${state.user.showHijri ? this.#hijriCard(todayH, todayMiq) : ""}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="card p-5 md:col-span-1">
          <div class="text-xs text-zinc-500 mb-1">Total balance</div>
          <div class="text-3xl font-semibold tracking-tight">${this.formatMoney(total, home)}</div>
          <div class="text-xs text-zinc-500 mt-2">
            ${state.accounts.filter((a) => !a.archived).length} accounts \xB7 ${home}
          </div>
        </div>
        <div class="card p-5">
          <div class="flex items-center gap-2 text-xs text-zinc-500 mb-1">
            <i data-lucide="arrow-down-left" class="text-emerald-500"></i> Income this month
          </div>
          <div class="text-2xl font-semibold text-emerald-500">${this.formatMoney(income, home)}</div>
        </div>
        <div class="card p-5">
          <div class="flex items-center gap-2 text-xs text-zinc-500 mb-1">
            <i data-lucide="arrow-up-right" class="text-rose-500"></i> Expenses this month
          </div>
          <div class="text-2xl font-semibold text-rose-500">${this.formatMoney(expense, home)}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="card p-5 md:col-span-2">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold">Recent transactions</h3>
            <button class="btn btn-ghost text-xs" onclick="window.__app.navigate('transactions')">
              View all <i data-lucide="chevron-right"></i>
            </button>
          </div>
          <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
            ${recent.length ? recent.map((t) => this.#rowRenderer.render(t)).join("") : this.emptyState("No transactions yet", "Tap + to add one.")}
          </div>
        </div>
        <div class="card p-5">
          <h3 class="font-semibold mb-1">Top spending</h3>
          <div class="text-xs text-zinc-500 mb-3">This month</div>
          <div class="relative" style="height:200px"><canvas id="dashChart"></canvas></div>
          <div id="dashLegend" class="mt-4 space-y-2 text-sm"></div>
        </div>
      </div>`;
    }
    onAfterRender() {
      this.#drawChart();
    }
    // ── Private helpers ──────────────────────────────────────────────────
    #hijriCard(todayH, miqaats) {
      const months = this.#hijri.monthsLong;
      return `
      <div class="card p-4 mb-4 flex items-start gap-3">
        <div class="icon-pill" style="background:#0ea5e922;color:#0ea5e9">
          <i data-lucide="moon-star"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-zinc-500">Today</div>
          <div class="font-semibold">${todayH.day} ${months[todayH.month]} ${todayH.year} H</div>
          <div class="text-xs text-zinc-500">
            ${(/* @__PURE__ */ new Date()).toLocaleDateString(void 0, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </div>
          ${miqaats.length ? `
            <div class="mt-2 flex flex-wrap gap-1.5">
              ${miqaats.slice(0, 4).map((m) => `
                <span class="chip" style="${m.p === 1 ? "background:#fef3c7;color:#92400e;" : m.p === 2 ? "background:#ede9fe;color:#6d28d9;" : ""}">
                  ${this.escapeHtml(m.t)}
                </span>`).join("")}
              ${miqaats.length > 4 ? `<span class="chip">+${miqaats.length - 4} more</span>` : ""}
            </div>` : ""}
        </div>
      </div>`;
    }
    #drawChart() {
      const { state, homeCurrency: home } = this;
      const spending = this.#reports.spendingByCategory("month");
      const ctx = document.getElementById("dashChart");
      if (!ctx) return;
      if (this.#chart) {
        this.#chart.destroy();
        this.#chart = null;
      }
      const items = spending.map(({ categoryId, amount }) => {
        const cat = state.categories.find((c) => c.id === categoryId);
        return cat ? { cat, amount } : null;
      }).filter(Boolean).filter(({ amount }) => amount > 0).slice(0, 6);
      if (!items.length) {
        ctx.parentElement.innerHTML = `
        <div class="text-center text-sm text-zinc-500 py-12">No spending yet this month.</div>`;
        return;
      }
      const labels = items.map((i) => i.cat.name);
      const data = items.map((i) => this.fromMinor(i.amount, home));
      const colors = items.map((i) => i.cat.color);
      this.#chart = new Chart(ctx, {
        // eslint-disable-line no-undef
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
        options: { cutout: "70%", plugins: { legend: { display: false } } }
      });
      const total = items.reduce((s, i) => s + i.amount, 0);
      document.getElementById("dashLegend").innerHTML = items.map((i) => `
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${i.cat.color}"></span>
          <span class="text-zinc-700 dark:text-zinc-300">${i.cat.name}</span>
        </div>
        <div class="text-zinc-500">${Math.round(100 * i.amount / total)}%</div>
      </div>`).join("");
    }
  };

  // src/ui/views/TransactionsView.js
  var TransactionsView = class extends BaseView {
    /** @type {TransactionRowRenderer} */
    #rowRenderer;
    /** @type {TransactionService} */
    #txService;
    /** @type {CategoryService} */
    #categories;
    // ── Filter state (persists across re-renders while view is mounted) ──
    #filter = {
      search: "",
      range: "30",
      dateFrom: "",
      dateTo: "",
      accountIds: [],
      categoryIds: [],
      types: [],
      paymentTypes: [],
      amountMin: "",
      amountMax: "",
      sort: "date-desc"
    };
    #filterOpen = false;
    #multiSelect = false;
    #selectedIds = /* @__PURE__ */ new Set();
    #visibleIds = [];
    constructor() {
      super();
      this.#rowRenderer = new TransactionRowRenderer();
      this.#txService = new TransactionService();
      this.#categories = new CategoryService();
    }
    /**
     * Category filter that also matches sub-categories of a selected parent and
     * the category of any split leg — the old `includes(t.categoryId)` missed
     * both (B4).
     * @param {object} t
     * @param {Set<string>} wanted  expanded set of acceptable category IDs
     * @returns {boolean}
     */
    #matchesCategory(t, wanted) {
      const ids = Array.isArray(t.splits) && t.splits.length ? t.splits.map((s) => s.categoryId) : [t.categoryId];
      return ids.some((id) => wanted.has(id));
    }
    // ── Public state ─────────────────────────────────────────────────────
    /** Expose filter and selection state to the Application layer. */
    get filter() {
      return this.#filter;
    }
    get multiSelect() {
      return this.#multiSelect;
    }
    get selectedIds() {
      return this.#selectedIds;
    }
    get visibleIds() {
      return this.#visibleIds;
    }
    toggleMultiSelect() {
      this.#multiSelect = !this.#multiSelect;
      this.#selectedIds.clear();
    }
    toggleSelection(id) {
      if (this.#selectedIds.has(id)) this.#selectedIds.delete(id);
      else this.#selectedIds.add(id);
    }
    selectAll() {
      this.#visibleIds.forEach((id) => this.#selectedIds.add(id));
    }
    deselectAll() {
      this.#selectedIds.clear();
    }
    clearMultiSelect() {
      this.#multiSelect = false;
      this.#selectedIds.clear();
    }
    setFilter(key, value) {
      this.#filter[key] = value;
    }
    toggleFilterItem(field, value) {
      const arr = this.#filter[field];
      const i = arr.indexOf(value);
      if (i >= 0) arr.splice(i, 1);
      else arr.push(value);
    }
    clearFilters() {
      Object.assign(this.#filter, {
        search: "",
        range: "30",
        dateFrom: "",
        dateTo: "",
        accountIds: [],
        categoryIds: [],
        types: [],
        paymentTypes: [],
        amountMin: "",
        amountMax: ""
      });
    }
    // ── BaseView contract ────────────────────────────────────────────────
    render() {
      const { state, homeCurrency: home } = this;
      const f = this.#filter;
      const fSearch = f.search.toLowerCase();
      const fAmtMin = f.amountMin !== "" ? this.toMinor(parseFloat(f.amountMin), home) : null;
      const fAmtMax = f.amountMax !== "" ? this.toMinor(parseFloat(f.amountMax), home) : null;
      const wantedCats = f.categoryIds.length ? new Set(f.categoryIds.flatMap((id) => this.#categories.descendants(id))) : null;
      const filtered = this.#txService.sort(
        state.transactions.filter((t) => {
          if (f.dateFrom && t.date < f.dateFrom) return false;
          if (f.dateTo && t.date > f.dateTo) return false;
          if (!f.dateFrom && !f.dateTo && !this.#withinRange(t.date, f.range)) return false;
          if (f.accountIds.length && !f.accountIds.includes(t.accountId)) return false;
          if (wantedCats && !this.#matchesCategory(t, wantedCats)) return false;
          if (f.types.length && !f.types.includes(t.type)) return false;
          if (f.paymentTypes.length && !f.paymentTypes.includes(t.paymentType)) return false;
          if (fSearch && !((t.payee || "").toLowerCase().includes(fSearch) || (t.note || "").toLowerCase().includes(fSearch) || (state.categories.find((c) => c.id === t.categoryId)?.name || "").toLowerCase().includes(fSearch))) return false;
          if (fAmtMin !== null || fAmtMax !== null) {
            const amtH = Math.abs(this.convert(t.amount, t.currency, home));
            if (fAmtMin !== null && amtH < fAmtMin) return false;
            if (fAmtMax !== null && amtH > fAmtMax) return false;
          }
          return true;
        }),
        f.sort
      );
      this.#visibleIds = filtered.map((t) => t.id);
      const sortKey = f.sort || "date-desc";
      const groupByDate = sortKey.startsWith("date-");
      const dayGroups = {};
      const monthTotals = {};
      if (groupByDate) {
        filtered.forEach((t) => {
          (dayGroups[t.date] = dayGroups[t.date] || []).push(t);
          const ym = t.date.slice(0, 7);
          if (!monthTotals[ym]) monthTotals[ym] = { income: 0, expense: 0 };
          const inHome = this.convert(t.amount, t.currency, home);
          if (t.type === "income") monthTotals[ym].income += inHome;
          if (t.type === "expense") monthTotals[ym].expense += inHome;
        });
      }
      const activeCount = f.accountIds.length + f.categoryIds.length + f.types.length + f.paymentTypes.length + (f.dateFrom ? 1 : 0) + (f.dateTo ? 1 : 0) + (f.amountMin ? 1 : 0) + (f.amountMax ? 1 : 0) + (f.range !== "30" && !f.dateFrom && !f.dateTo ? 1 : 0);
      return `
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Transactions</h1>
        <div class="flex gap-2">
          <button class="btn ${this.#multiSelect ? "btn-primary" : "btn-outline"}"
                  onclick="window.__app.toggleMultiSelect()" title="Select multiple">
            <i data-lucide="check-square"></i>
            <span class="hidden md:inline ml-1">Select</span>
          </button>
          <button class="btn btn-primary" onclick="window.__app.openModal('transaction')">
            <i data-lucide="plus"></i> Add
          </button>
        </div>
      </div>

      ${this.#bulkBar()}
      ${this.#filterBar(f, activeCount, home)}
      ${this.#txList(filtered, dayGroups, monthTotals, groupByDate, sortKey)}
    `;
    }
    // ── Private render helpers ───────────────────────────────────────────
    #filterBar(f, activeCount, cur) {
      const accountOpts = this.state.accounts.map((a) => ({ value: a.id, label: a.name }));
      const categoryOpts = this.state.categories.map((c) => ({ value: c.id, label: c.name }));
      const typeOpts = [
        { value: "expense", label: "Expense" },
        { value: "income", label: "Income" },
        { value: "transfer", label: "Transfer" }
      ];
      const paymentTypes = [...new Set(this.state.transactions.map((t) => t.paymentType).filter(Boolean))];
      const paymentOpts = paymentTypes.map((p) => ({
        value: p,
        label: p.charAt(0).toUpperCase() + p.slice(1)
      }));
      const allActiveChips = [
        ...f.accountIds.map((v) => `<span class="chip">${this.escapeHtml(accountOpts.find((o) => o.value === v)?.label || v)} <button onclick="window.__app.txFilterToggle('accountIds','${v}')">\xD7</button></span>`),
        ...f.categoryIds.map((v) => `<span class="chip">${this.escapeHtml(categoryOpts.find((o) => o.value === v)?.label || v)} <button onclick="window.__app.txFilterToggle('categoryIds','${v}')">\xD7</button></span>`),
        ...f.types.map((v) => `<span class="chip">${v.charAt(0).toUpperCase() + v.slice(1)} <button onclick="window.__app.txFilterToggle('types','${v}')">\xD7</button></span>`),
        ...f.paymentTypes.map((v) => `<span class="chip">${v.charAt(0).toUpperCase() + v.slice(1)} <button onclick="window.__app.txFilterToggle('paymentTypes','${v}')">\xD7</button></span>`),
        f.dateFrom || f.dateTo ? `<span class="chip">${f.dateFrom || "\u2026"} \u2192 ${f.dateTo || "\u2026"} <button onclick="window.__app.txFilterClear('dates')">\xD7</button></span>` : "",
        f.range !== "30" && !f.dateFrom && !f.dateTo ? `<span class="chip">${f.range === "all" ? "All time" : "Last " + f.range + "d"} <button onclick="window.__app.txFilterSet('range','30')">\xD7</button></span>` : "",
        f.amountMin || f.amountMax ? `<span class="chip">${f.amountMin || "0"}\u2013${f.amountMax || "\u221E"} ${cur} <button onclick="window.__app.txFilterClear('amounts')">\xD7</button></span>` : ""
      ].filter(Boolean).join("");
      return `
      <div class="card mb-4">
        <div class="flex items-center gap-2 p-3">
          <div class="relative flex-1">
            <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" style="width:15px;height:15px"></i>
            <input class="input pl-9" placeholder="Search payee, note or category\u2026"
                   value="${this.escapeHtml(f.search)}"
                   data-focus-key="txSearch"
                   oninput="window.__app.txFilterSet('search',this.value)" />
          </div>
          <button class="btn ${this.#filterOpen ? "btn-primary" : "btn-outline"} relative shrink-0"
                  onclick="window.__app.toggleTxFilterPanel()" title="Advanced filters">
            <i data-lucide="sliders-horizontal"></i>
            <span class="hidden md:inline ml-1">Filters</span>
            ${activeCount ? `<span class="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">${activeCount}</span>` : ""}
          </button>
          <select class="select w-auto shrink-0"
                  onchange="window.__app.txFilterSet('sort',this.value)" title="Sort">
            ${TX_SORT_OPTIONS.map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>

        ${this.#filterOpen ? this.#advancedFilterPanel(f, accountOpts, categoryOpts, typeOpts, paymentOpts, activeCount, cur) : ""}

        ${activeCount && !this.#filterOpen ? `
          <div class="border-t border-zinc-100 dark:border-zinc-800 px-3 py-1.5 flex flex-wrap gap-1.5 items-center">
            ${allActiveChips}
            <button class="text-xs text-zinc-400 hover:text-rose-500 ml-auto"
                    onclick="window.__app.clearTxFilters()">Clear all</button>
          </div>` : ""}
      </div>`;
    }
    #advancedFilterPanel(f, accountOpts, categoryOpts, typeOpts, paymentOpts, activeCount, cur) {
      return `
      <div class="border-t border-zinc-100 dark:border-zinc-800 p-3 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Account <span class="font-normal opacity-60">(multi)</span></label>
          ${this.#multiChips("accountIds", accountOpts, f.accountIds, "\uFF0B Add account\u2026")}
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Category <span class="font-normal opacity-60">(multi)</span></label>
          ${this.#multiChips("categoryIds", categoryOpts, f.categoryIds, "\uFF0B Add category\u2026")}
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Type <span class="font-normal opacity-60">(multi)</span></label>
          ${this.#multiChips("types", typeOpts, f.types, "\uFF0B Add type\u2026")}
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Payment method <span class="font-normal opacity-60">(multi)</span></label>
          ${this.#multiChips("paymentTypes", paymentOpts, f.paymentTypes, "\uFF0B Add method\u2026")}
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Period</label>
          <select class="select" onchange="window.__app.txFilterSet('range',this.value)">
            ${[["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last 12 months"], ["all", "All time"]].map(([v, l]) => `<option value="${v}" ${f.range === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Custom date range</label>
          <div class="flex gap-1 items-center">
            <input class="input flex-1" type="date" value="${f.dateFrom}" onchange="window.__app.txFilterSet('dateFrom',this.value)" title="From">
            <span class="text-zinc-400 text-xs">\u2013</span>
            <input class="input flex-1" type="date" value="${f.dateTo}"   onchange="window.__app.txFilterSet('dateTo',this.value)"   title="To">
          </div>
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Min amount (${cur})</label>
          <input class="input" type="number" min="0" step="0.01" placeholder="0.00" value="${f.amountMin}" oninput="window.__app.txFilterSet('amountMin',this.value)">
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Max amount (${cur})</label>
          <input class="input" type="number" min="0" step="0.01" placeholder="No limit" value="${f.amountMax}" oninput="window.__app.txFilterSet('amountMax',this.value)">
        </div>
        ${activeCount ? `
          <div class="md:col-span-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <button class="btn btn-outline text-rose-500 text-sm" onclick="window.__app.clearTxFilters()">
              <i data-lucide="x"></i> Clear all filters
            </button>
          </div>` : ""}
      </div>`;
    }
    #multiChips(field, options, selected, placeholder) {
      const remaining = options.filter((o) => !selected.includes(o.value));
      const chips = selected.map((v) => {
        const lbl = options.find((o) => o.value === v)?.label || v;
        return `<span class="chip" style="background:#f4f4f5">${this.escapeHtml(lbl)}<button type="button" onclick="window.__app.txFilterToggle('${field}','${v}')" style="margin-left:4px;opacity:.6" title="Remove">\xD7</button></span>`;
      }).join("");
      const dropdown = remaining.length ? `<select class="select text-sm mt-1" onchange="if(this.value){window.__app.txFilterToggle('${field}',this.value);this.value=''}">
           <option value="">${placeholder}</option>
           ${remaining.map((o) => `<option value="${this.escapeHtml(o.value)}">${this.escapeHtml(o.label)}</option>`).join("")}
         </select>` : selected.length ? `<div class="text-xs text-zinc-400 mt-1">All selected</div>` : "";
      return `<div class="flex flex-wrap gap-1 mb-0.5">${chips}</div>${dropdown}`;
    }
    #txList(filtered, dayGroups, monthTotals, groupByDate, sortKey) {
      if (filtered.length === 0) {
        return `
        <div class="card p-10 text-center">
          ${this.emptyState("No transactions found", "Adjust filters or add a new one.")}
          <button class="btn btn-primary mt-4" onclick="window.__app.openModal('transaction')">
            <i data-lucide="plus"></i> Add transaction
          </button>
        </div>`;
      }
      if (groupByDate) {
        const dateKeys = Object.keys(dayGroups);
        let prevMonth = null;
        return dateKeys.map((date) => {
          const ym = date.slice(0, 7);
          const header = ym !== prevMonth ? this.#monthHeader(ym, monthTotals[ym]) : "";
          prevMonth = ym;
          return `${header}
          <div class="mb-2">
            <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1 px-1">${this.dateLabel(date)}</div>
            <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
              ${dayGroups[date].map((t) => this.#rowRenderer.render(t, {
            multiSelect: this.#multiSelect,
            selectedIds: this.#selectedIds
          })).join("")}
            </div>
          </div>`;
        }).join("");
      }
      const sortLabel = TX_SORT_OPTIONS.find(([v]) => v === sortKey)?.[1] || "Sorted";
      return `
      <div class="mb-4">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2 px-1">
          ${sortLabel} \xB7 ${filtered.length} result${filtered.length === 1 ? "" : "s"}
        </div>
        <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
          ${filtered.map((t) => this.#rowRenderer.render(t, {
        multiSelect: this.#multiSelect,
        selectedIds: this.#selectedIds
      })).join("")}
        </div>
      </div>`;
    }
    #monthHeader(ym, tot) {
      if (!tot) return "";
      const [y, m] = ym.split("-").map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString(void 0, { month: "long", year: "numeric" });
      const net = tot.income - tot.expense;
      const home = this.homeCurrency;
      return `
      <div class="month-divider flex items-center gap-2 my-3 px-1">
        <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 shrink-0">${this.escapeHtml(label)}</span>
        <div class="flex-1 border-t border-zinc-200 dark:border-zinc-700"></div>
        ${tot.income ? `<span class="text-xs text-emerald-600 dark:text-emerald-400 shrink-0">+${this.formatMoney(tot.income, home)}</span>` : ""}
        ${tot.expense ? `<span class="text-xs text-rose-500 shrink-0">-${this.formatMoney(tot.expense, home)}</span>` : ""}
        <span class="text-xs ${net >= 0 ? "text-zinc-500" : "text-rose-500"} shrink-0">${net >= 0 ? "net +" : "net "}${this.formatMoney(Math.abs(net), home)}</span>
      </div>`;
    }
    #bulkBar() {
      if (!this.#multiSelect) return "";
      const n = this.#selectedIds.size;
      const allSelected = this.#visibleIds.length > 0 && this.#visibleIds.every((id) => this.#selectedIds.has(id));
      return `
      <div class="fixed bottom-20 md:bottom-6 left-0 right-0 flex justify-center z-40 px-4">
        <div class="card flex items-center gap-2 px-3 py-3 shadow-2xl" style="max-width:520px;width:100%">
          <span class="text-sm font-medium">${n} selected</span>
          <button class="btn btn-ghost text-sm px-2"
                  onclick="${allSelected ? "window.__app.deselectAllTx()" : "window.__app.selectAllTx()"}"
                  title="${allSelected ? "Deselect all" : "Select all"}">
            <i data-lucide="${allSelected ? "square" : "check-square"}"></i>
            <span class="hidden md:inline ml-1">${allSelected ? "Deselect all" : "Select all"}</span>
          </button>
          <div class="flex-1"></div>
          <button class="btn btn-ghost text-sm" onclick="window.__app.toggleMultiSelect()">Cancel</button>
          ${n > 0 ? `<button class="btn btn-outline text-rose-500 text-sm" onclick="window.__app.bulkDeleteTx()">
            <i data-lucide="trash-2"></i> Delete
          </button>` : ""}
        </div>
      </div>`;
    }
    #withinRange(iso, range) {
      if (range === "all") return true;
      const days = parseInt(range, 10);
      const cutoff = /* @__PURE__ */ new Date();
      cutoff.setDate(cutoff.getDate() - days);
      return /* @__PURE__ */ new Date(iso + "T12:00:00") >= cutoff;
    }
    // ── Filter panel open/close toggled by Application ───────────────────
    toggleFilterPanel() {
      this.#filterOpen = !this.#filterOpen;
    }
    get filterOpen() {
      return this.#filterOpen;
    }
  };

  // src/ui/views/AccountsView.js
  var AccountsView = class extends BaseView {
    constructor() {
      super();
    }
    render() {
      const { state, homeCurrency: home } = this;
      if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
      if (!Array.isArray(state.user.collapsedAccountGroups)) state.user.collapsedAccountGroups = [];
      const collapsed = new Set(state.user.collapsedAccountGroups);
      const groupSections = state.accountGroups.map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        accs: state.accounts.filter((a) => a.groupId === g.id)
      }));
      const validGroupIds = new Set(state.accountGroups.map((g) => g.id));
      const ungroupedAccs = state.accounts.filter((a) => !a.groupId || !validGroupIds.has(a.groupId));
      const sections = [
        ...groupSections,
        ungroupedAccs.length ? { id: "__none__", name: "Ungrouped", color: "#9ca3af", accs: ungroupedAccs } : null
      ].filter(Boolean);
      const sharedOutIds = new Set(
        (state.family || []).flatMap((m) => (m.permissions || []).map((p) => p.accountId))
      );
      const anyExpanded = sections.some((s) => !collapsed.has(s.id));
      const anyCollapsed = sections.some((s) => collapsed.has(s.id));
      return `
      <div class="flex items-center justify-between mb-6 gap-2">
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Accounts</h1>
        <div class="flex items-center gap-2">
          ${sections.length > 1 ? `
            ${anyExpanded ? `<button class="btn btn-ghost text-sm" onclick="window.__app.collapseAllAccountGroups()" title="Collapse all groups"><i data-lucide="chevrons-down-up" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Collapse all</span></button>` : ""}
            ${anyCollapsed ? `<button class="btn btn-ghost text-sm" onclick="window.__app.expandAllAccountGroups()" title="Expand all groups"><i data-lucide="chevrons-up-down" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Expand all</span></button>` : ""}
          ` : ""}
          <button class="btn btn-primary" onclick="window.__app.openModal('account')">
            <i data-lucide="plus"></i> New account
          </button>
        </div>
      </div>

      ${state.accounts.length === 0 ? `<div class="card p-10 text-center">${this.emptyState("No accounts", "Add your first account to start tracking.")}</div>` : sections.map((sec) => `
            <div class="mb-6">
              ${this.#sectionHeader(sec, collapsed, home)}
              ${collapsed.has(sec.id) ? "" : `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  ${sec.accs.map((a) => this.#accountCard(a, home, sharedOutIds)).join("")}
                </div>`}
            </div>`).join("")}

      ${this.#sharedCards(state, home)}
    `;
    }
    // ── Private ──────────────────────────────────────────────────────────
    #accountCard(a, home, sharedOutIds) {
      const txCount = this.state.transactions.filter(
        (t) => t.accountId === a.id || Array.isArray(t.splits) && t.splits.some((s) => (s.accountId || t.accountId) === a.id)
      ).length;
      const isSharedOut = sharedOutIds.has(a.id);
      return `
      <div class="card p-5 relative overflow-hidden ${a.archived ? "opacity-60" : ""} hover:shadow-md transition-shadow cursor-pointer"
           onclick="window.__app.openAccountDetail('${a.id}')">
        <div class="absolute -right-8 -top-8 w-32 h-32 rounded-full pointer-events-none" style="background:${a.color}22"></div>
        <div class="flex items-start gap-3 relative">
          <div class="icon-pill" style="background:${a.color};color:white">
            <i data-lucide="${a.icon || "wallet"}"></i>
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <div class="font-semibold">${this.escapeHtml(a.name)}</div>
              ${a.archived ? '<span class="chip">Archived</span>' : ""}
              ${isSharedOut ? `<span title="Shared with family" style="display:inline-flex;align-items:center;gap:2px;font-size:.6rem;background:#818cf822;color:#818cf8;border-radius:6px;padding:1px 5px"><i data-lucide="users" style="width:10px;height:10px"></i> Shared</span>` : ""}
            </div>
            <div class="text-xs text-zinc-500 capitalize">${a.type} \xB7 ${a.currency} \xB7 ${txCount} transaction${txCount === 1 ? "" : "s"}</div>
          </div>
          <button class="btn btn-ghost"
                  onclick="event.stopPropagation();window.__app.openModal('account',{id:'${a.id}'})"
                  title="Edit account">
            <i data-lucide="pencil"></i>
          </button>
        </div>
        <div class="mt-5 relative">
          <div class="text-xs text-zinc-500">Balance</div>
          <div class="text-2xl font-semibold ${a.balance < 0 ? "text-rose-500" : ""}">${this.formatMoney(a.balance, a.currency)}</div>
          ${a.currency !== home ? `<div class="text-xs text-zinc-500">${this.formatMoney(this.convert(a.balance, a.currency, home), home)} in ${home}</div>` : ""}
        </div>
        <div class="mt-3 text-xs text-zinc-400 relative flex items-center gap-1">
          <i data-lucide="arrow-right" style="width:11px;height:11px;display:inline"></i> View transactions
        </div>
      </div>`;
    }
    #sectionHeader(sec, collapsed, home) {
      const isCollapsed = collapsed.has(sec.id);
      const totalHome = sec.accs.reduce((s, a) => s + this.convert(a.balance, a.currency, home), 0);
      return `
      <div class="flex items-center gap-2 mb-2 px-1">
        <button type="button"
                onclick="window.__app.toggleAccountGroupCollapse('${sec.id}')"
                class="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 -my-1 p-1"
                title="${isCollapsed ? "Expand" : "Collapse"} group">
          <i data-lucide="${isCollapsed ? "chevron-right" : "chevron-down"}" style="width:15px;height:15px;display:inline"></i>
        </button>
        <span class="inline-block rounded-full" style="background:${sec.color};width:8px;height:8px"></span>
        <span class="text-xs uppercase tracking-wider text-zinc-500">${this.escapeHtml(sec.name)}</span>
        <span class="chip" style="font-size:.65rem">${sec.accs.length}</span>
        <div class="flex-1"></div>
        <span class="text-xs text-zinc-500">${this.formatMoney(totalHome, home)}</span>
        ${sec.id !== "__none__" ? `
          <button class="text-xs text-zinc-400 hover:text-rose-500 ml-1 p-1"
                  onclick="window.__app.deleteAccountGroup('${sec.id}')"
                  title="Delete group">
            <i data-lucide="trash-2" style="width:12px;height:12px"></i>
          </button>` : ""}
      </div>`;
    }
    #sharedCards(state, home) {
      const sharedData = state._sharedData || [];
      const cards = sharedData.flatMap(
        (share, si) => (share.accounts || []).map((a) => {
          const perm = (share.permission || {})[a.id] || "view";
          const txCount = (share.transactions || []).filter((t) => t.accountId === a.id).length;
          const permLabel = this.#accessLabel(perm);
          return `
          <div class="card p-5 relative overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
               style="border-color:#818cf822"
               onclick="window.__app.openAccountDetail('${a.id}',{shareIndex:${si}})">
            <div class="absolute -right-8 -top-8 w-32 h-32 rounded-full pointer-events-none" style="background:${a.color || "#818cf8"}22"></div>
            <div class="flex items-start gap-3 relative">
              <div class="icon-pill" style="background:${a.color || "#818cf8"};color:white">
                <i data-lucide="${a.icon || "wallet"}"></i>
              </div>
              <div class="flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <div class="font-semibold">${this.escapeHtml(a.name)}</div>
                  <span class="chip" style="background:#818cf822;color:#818cf8;font-size:.6rem">${permLabel}</span>
                </div>
                <div class="text-xs text-zinc-500 capitalize">${a.type} \xB7 ${a.currency} \xB7 ${txCount} transaction${txCount === 1 ? "" : "s"}</div>
                <div class="text-xs text-zinc-400 mt-0.5">Shared by ${this.escapeHtml(share.sharedBy || "Family")}</div>
              </div>
            </div>
            <div class="mt-5 relative">
              <div class="text-xs text-zinc-500">Balance</div>
              <div class="text-2xl font-semibold ${a.balance < 0 ? "text-rose-500" : ""}">${this.formatMoney(a.balance, a.currency)}</div>
              ${a.currency !== home ? `<div class="text-xs text-zinc-500">${this.formatMoney(this.convert(a.balance, a.currency, home), home)} in ${home}</div>` : ""}
            </div>
            <div class="mt-3 text-xs text-zinc-400 relative flex items-center gap-1">
              <i data-lucide="arrow-right" style="width:11px;height:11px;display:inline"></i> View transactions
            </div>
          </div>`;
        })
      );
      if (!cards.length) return "";
      return `
      <div class="mb-6">
        <div class="flex items-center gap-2 mb-3 px-1">
          <i data-lucide="users" style="width:14px;height:14px;color:#818cf8"></i>
          <span class="text-xs uppercase tracking-wider text-zinc-500">Shared with me</span>
          <span class="chip" style="font-size:.65rem">${cards.length}</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${cards.join("")}
        </div>
      </div>`;
    }
    #accessLabel(perm) {
      const MAP = { owner: "Owner", full: "Full access", edit: "Can edit", view: "View only" };
      return MAP[perm] || perm;
    }
  };

  // src/ui/views/AccountDetailView.js
  var AccountDetailView = class extends BaseView {
    /** @type {TransactionRowRenderer} */
    #rowRenderer;
    /** @type {TransactionService} */
    #txService;
    /** @type {AccountService} */
    #accountService;
    /** @type {ReportService} */
    #reports;
    // ── Per-view state ────────────────────────────────────────────────────
    #accountId = null;
    #sharedMeta = null;
    // { shareIndex } or null
    #viewMode = "transactions";
    // 'transactions' | 'monthly'
    #filter = { search: "", range: "all", sort: "date-desc" };
    #multiSelect = false;
    #selectedIds = /* @__PURE__ */ new Set();
    #visibleIds = [];
    constructor() {
      super();
      this.#rowRenderer = new TransactionRowRenderer();
      this.#txService = new TransactionService();
      this.#accountService = new AccountService();
      this.#reports = new ReportService();
    }
    // ── Public setters ────────────────────────────────────────────────────
    setAccount(id, sharedMeta = null) {
      this.#accountId = id;
      this.#sharedMeta = sharedMeta;
      this.#multiSelect = false;
      this.#selectedIds.clear();
      this.#viewMode = "transactions";
    }
    setViewMode(mode) {
      this.#viewMode = mode;
    }
    setFilter(key, val) {
      this.#filter[key] = val;
    }
    toggleMultiSelect() {
      this.#multiSelect = !this.#multiSelect;
      this.#selectedIds.clear();
    }
    toggleSelection(id) {
      this.#selectedIds.has(id) ? this.#selectedIds.delete(id) : this.#selectedIds.add(id);
    }
    selectAll() {
      this.#visibleIds.forEach((id) => this.#selectedIds.add(id));
    }
    deselectAll() {
      this.#selectedIds.clear();
    }
    clearMultiSelect() {
      this.#multiSelect = false;
      this.#selectedIds.clear();
    }
    get visibleIds() {
      return this.#visibleIds;
    }
    get selectedIds() {
      return this.#selectedIds;
    }
    get multiSelect() {
      return this.#multiSelect;
    }
    get accountId() {
      return this.#accountId;
    }
    // ── BaseView contract ─────────────────────────────────────────────────
    render() {
      if (!this.#accountId) return "";
      const state = this.state;
      const isShared = !!this.#sharedMeta;
      const shareIndex = this.#sharedMeta?.shareIndex ?? null;
      const share = shareIndex !== null ? (state._sharedData || [])[shareIndex] : null;
      const a = isShared ? (share?.accounts || []).find((x) => x.id === this.#accountId) : state.accounts.find((x) => x.id === this.#accountId);
      if (!a) return "";
      const perm = isShared ? (share?.permission || {})[a.id] || "view" : "owner";
      const canAdd = perm === "edit" || perm === "full" || perm === "owner";
      const canDelete = perm === "full" || perm === "owner";
      const canManage = perm === "owner";
      const home = this.homeCurrency;
      const allTxs = isShared ? (share?.transactions || []).filter((t) => this.#txTouchesAccount(t, a.id)) : state.transactions.filter((t) => this.#txTouchesAccount(t, a.id));
      const ms = this.#reports.startOfMonth();
      let mthIn = 0, mthOut = 0, lifetimeIn = 0, lifetimeOut = 0;
      for (const t of allTxs) {
        const imp = this.#txService.impactOnAccount(t, a);
        if (imp.dir === "+") {
          lifetimeIn += imp.minorInAcc;
          if (/* @__PURE__ */ new Date(t.date + "T12:00:00") >= ms) mthIn += imp.minorInAcc;
        }
        if (imp.dir === "-") {
          lifetimeOut += imp.minorInAcc;
          if (/* @__PURE__ */ new Date(t.date + "T12:00:00") >= ms) mthOut += imp.minorInAcc;
        }
      }
      const ledgerSum = canManage ? this.#ledgerSum(a, state.transactions) : 0;
      const residual = canManage ? a.balance - ledgerSum : 0;
      const f = this.#filter;
      const fSearch = f.search.toLowerCase();
      const filtered = this.#txService.sort(
        allTxs.filter((t) => this.#withinRange(t.date, f.range)).filter((t) => !fSearch || (t.payee || "").toLowerCase().includes(fSearch) || (t.note || "").toLowerCase().includes(fSearch)),
        f.sort,
        (t) => this.#txService.impactOnAccount(t, a).minorInAcc
      );
      this.#visibleIds = filtered.map((t) => t.id);
      const sortKey = f.sort || "date-desc";
      const groupByDate = sortKey.startsWith("date-");
      const dayGroups = {};
      const monthlyInOut = {};
      if (groupByDate) {
        filtered.forEach((t) => {
          (dayGroups[t.date] = dayGroups[t.date] || []).push(t);
        });
      }
      const opening = canManage ? a.balance - ledgerSum : null;
      const sortedAll = allTxs.slice().sort((x, y) => x.date.localeCompare(y.date));
      let running = opening ?? 0;
      sortedAll.forEach((t) => {
        const ym = t.date.slice(0, 7);
        if (!monthlyInOut[ym]) monthlyInOut[ym] = { income: 0, expense: 0, endBalance: null };
        const imp = this.#txService.impactOnAccount(t, a);
        if (imp.dir === "+") {
          running += imp.minorInAcc;
          monthlyInOut[ym].income += imp.minorInAcc;
        } else if (imp.dir === "-") {
          running -= imp.minorInAcc;
          monthlyInOut[ym].expense += imp.minorInAcc;
        }
        if (canManage) monthlyInOut[ym].endBalance = running;
      });
      const newTxPrefill = JSON.stringify({
        type: "expense",
        accountId: a.id,
        currency: a.currency,
        date: DateService.todayIso(),
        paymentType: "card"
      }).replace(/'/g, "&#39;");
      const newTxBtn = "";
      const permLabel = this.#accessLabel(perm);
      const backFn = isShared ? `window.__app.navigate('accounts')` : `window.__app.navigate('accounts')`;
      return `
      <div class="flex items-center gap-2 mb-4">
        <button class="btn btn-ghost" onclick="${backFn}" title="Back to Accounts">
          <i data-lucide="arrow-left"></i><span class="hidden md:inline ml-1">Accounts</span>
        </button>
        <div class="flex-1"></div>
        ${isShared ? `<span class="chip" style="background:#818cf822;color:#818cf8">${permLabel} \xB7 Shared by ${this.escapeHtml(share?.sharedBy || "")}</span>` : ""}
        ${canManage && Math.abs(residual) >= 1 ? `<button class="btn btn-outline text-amber-600" onclick="window.__app.reconcileAccount('${a.id}')" title="Balance out of sync"><i data-lucide="scale"></i><span class="hidden md:inline ml-1">Reconcile</span></button>` : ""}
        ${isShared ? `<button class="btn btn-outline" onclick="window.__app.refreshSharedAccount(${shareIndex})" title="Refresh"><i data-lucide="refresh-cw"></i><span class="hidden md:inline ml-1">Refresh</span></button>` : ""}
        ${canManage || canDelete ? `<button class="btn ${this.#multiSelect ? "btn-primary" : "btn-outline"}" onclick="window.__app.toggleAccountMultiSelect()" title="Select multiple"><i data-lucide="check-square"></i></button>` : ""}
        ${canManage ? `<button class="btn btn-outline" onclick="window.__app.openModal('account',{id:'${a.id}'})"><i data-lucide="pencil"></i><span class="hidden md:inline ml-1">Edit</span></button>` : ""}
        ${newTxBtn}
      </div>

      ${this.#bulkBar(isShared, shareIndex)}

      ${canManage && Math.abs(residual) >= 1 ? `
        <div class="card-muted p-3 mb-4" style="border-color:#fcd34d">
          <div class="font-medium text-amber-600 text-sm mb-1 flex items-center gap-1.5">
            <i data-lucide="alert-triangle" style="width:14px;height:14px"></i> Balance is out of sync with transactions
          </div>
          <div class="text-xs text-zinc-600 dark:text-zinc-400">
            Account balance: <b>${this.formatMoney(a.balance, a.currency)}</b> \xB7 transactions sum to <b>${this.formatMoney(ledgerSum, a.currency)}</b> \xB7 residual <b>${residual >= 0 ? "+" : "-"}${this.formatMoney(Math.abs(residual), a.currency)}</b>. Click <b>Reconcile</b> to log the residual as an opening-balance entry.
          </div>
        </div>` : ""}

      <div class="card p-5 mb-4 relative overflow-hidden ${a.archived ? "opacity-70" : ""}">
        <div class="absolute -right-10 -top-10 w-40 h-40 rounded-full" style="background:${a.color || "#818cf8"}22"></div>
        <div class="flex items-start gap-3 relative">
          <div class="icon-pill" style="background:${a.color || "#818cf8"};color:white;width:44px;height:44px">
            <i data-lucide="${a.icon || "wallet"}" style="width:22px;height:22px"></i>
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <div class="text-xl font-semibold">${this.escapeHtml(a.name)}</div>
              ${a.archived ? '<span class="chip">Archived</span>' : ""}
            </div>
            <div class="text-xs text-zinc-500 capitalize">${a.type || ""} \xB7 ${a.currency}</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-zinc-500">Balance</div>
            <div class="text-2xl font-semibold ${a.balance < 0 ? "text-rose-500" : ""}">${this.formatMoney(a.balance, a.currency)}</div>
            ${a.currency !== home ? `<div class="text-xs text-zinc-500">${this.formatMoney(this.convert(a.balance, a.currency, home), home)} in ${home}</div>` : ""}
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div class="card-muted p-3"><div class="text-xs text-zinc-500">This month in</div><div class="text-lg font-semibold text-emerald-500">+${this.formatMoney(mthIn, a.currency)}</div></div>
        <div class="card-muted p-3"><div class="text-xs text-zinc-500">This month out</div><div class="text-lg font-semibold text-rose-500">-${this.formatMoney(mthOut, a.currency)}</div></div>
        <div class="card-muted p-3"><div class="text-xs text-zinc-500">Lifetime in</div><div class="text-lg font-semibold">+${this.formatMoney(lifetimeIn, a.currency)}</div></div>
        <div class="card-muted p-3"><div class="text-xs text-zinc-500">Lifetime out</div><div class="text-lg font-semibold">-${this.formatMoney(lifetimeOut, a.currency)}</div></div>
      </div>

      ${canManage ? `
        <div class="flex items-center gap-2 mb-4">
          <button class="btn ${this.#viewMode === "transactions" ? "btn-primary" : "btn-outline"}"
                  onclick="window.__app.setAccountViewMode('transactions')">
            <i data-lucide="list"></i><span class="hidden sm:inline ml-1">Transactions</span>
          </button>
          <button class="btn ${this.#viewMode === "monthly" ? "btn-primary" : "btn-outline"}"
                  onclick="window.__app.setAccountViewMode('monthly')">
            <i data-lucide="calendar-range"></i><span class="hidden sm:inline ml-1">Monthly balances</span>
          </button>
        </div>` : ""}

      ${canManage && this.#viewMode === "monthly" ? this.#monthlyView(a, state.transactions) : this.#txListSection(a, filtered, dayGroups, monthlyInOut, sortKey, groupByDate, isShared, shareIndex, share)}
    `;
    }
    // ── Private ───────────────────────────────────────────────────────────
    #txListSection(a, filtered, dayGroups, monthlyInOut, sortKey, groupByDate, isShared, shareIndex, share) {
      const f = this.#filter;
      const searchBar = `
      <div class="card p-3 mb-4">
        <div class="flex flex-col md:flex-row gap-2">
          <div class="relative flex-1">
            <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"></i>
            <input class="input pl-9" placeholder="Search payee or note..."
                   value="${this.escapeHtml(f.search)}"
                   data-focus-key="accDetailSearch"
                   oninput="window.__app.setAccDetailFilter('search',this.value)">
          </div>
          <select class="select md:w-36" onchange="window.__app.setAccDetailFilter('range',this.value)">
            ${[["7", "Last 7d"], ["30", "Last 30d"], ["90", "Last 90d"], ["all", "All time"]].map(([v, l]) => `<option value="${v}" ${f.range === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
          <select class="select md:w-44" onchange="window.__app.setAccDetailFilter('sort',this.value)">
            ${TX_SORT_OPTIONS.map(([v, l]) => `<option value="${v}" ${f.sort === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
      </div>`;
      const cats = isShared && share ? share.categories : this.state.categories;
      const txArr = isShared && share ? share.transactions : this.state.transactions;
      const opts = {
        account: a,
        isShared,
        shareIndex,
        share,
        categories: cats,
        transactions: txArr,
        multiSelect: this.#multiSelect,
        selectedIds: this.#selectedIds
      };
      let txListHtml;
      if (filtered.length === 0) {
        txListHtml = `<div class="card p-10 text-center">${this.emptyState("No transactions", "Try a wider date range or add an entry for this account.")}</div>`;
      } else if (groupByDate) {
        let prevMonth = null;
        txListHtml = Object.keys(dayGroups).map((date) => {
          const ym = date.slice(0, 7);
          const header = ym !== prevMonth ? this.#monthDivider(ym, monthlyInOut[ym], a) : "";
          prevMonth = ym;
          return `${header}
          <div class="mb-2">
            <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1 px-1">${this.dateLabel(date)}</div>
            <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
              ${dayGroups[date].map((t) => this.#rowRenderer.render(t, opts)).join("")}
            </div>
          </div>`;
        }).join("");
      } else {
        const sortLabel = TX_SORT_OPTIONS.find(([v]) => v === sortKey)?.[1] || "Sorted";
        txListHtml = `
        <div class="mb-4">
          <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2 px-1">${sortLabel} \xB7 ${filtered.length} result${filtered.length === 1 ? "" : "s"}</div>
          <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
            ${filtered.map((t) => this.#rowRenderer.render(t, opts)).join("")}
          </div>
        </div>`;
      }
      return `${searchBar}${txListHtml}`;
    }
    #monthDivider(ym, tot, a) {
      if (!tot) return "";
      const [y, m] = ym.split("-").map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString(void 0, { month: "long", year: "numeric" });
      return `
      <div class="flex items-center gap-2 my-3 px-1">
        <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 shrink-0">${this.escapeHtml(label)}</span>
        <div class="flex-1 border-t border-zinc-200 dark:border-zinc-700"></div>
        ${tot.income ? `<span class="text-xs text-emerald-600 dark:text-emerald-400 shrink-0">+${this.formatMoney(tot.income, a.currency)}</span>` : ""}
        ${tot.expense ? `<span class="text-xs text-rose-500 shrink-0">-${this.formatMoney(tot.expense, a.currency)}</span>` : ""}
        ${tot.endBalance != null ? `<span class="text-xs text-zinc-500 shrink-0">bal ${this.formatMoney(tot.endBalance, a.currency)}</span>` : ""}
      </div>`;
    }
    /**
     * Full year × month grid — one row per year, 12 monthly columns, year-end column.
     * Each cell shows end-of-month balance (top) and net change (bottom, color-coded).
     */
    #monthlyView(a, transactions) {
      const all = transactions.filter((t) => this.#txTouchesAccount(t, a.id));
      if (!all.length) return `<div class="card p-8 text-center">${this.emptyState("No transactions yet", "")}</div>`;
      const ledger = this.#ledgerSum(a, transactions);
      const opening = a.balance - ledger;
      const sorted = all.slice().sort((x, y) => x.date.localeCompare(y.date));
      const monthData = {};
      let running = opening;
      sorted.forEach((t) => {
        const ym = t.date.slice(0, 7);
        const imp = this.#txService.impactOnAccount(t, a);
        if (!monthData[ym]) monthData[ym] = { income: 0, expense: 0, net: 0, balance: 0, hasActivity: false };
        monthData[ym].hasActivity = true;
        if (imp.dir === "+") {
          running += imp.minorInAcc;
          monthData[ym].income += imp.minorInAcc;
        } else if (imp.dir === "-") {
          running -= imp.minorInAcc;
          monthData[ym].expense += imp.minorInAcc;
        }
        monthData[ym].net = monthData[ym].income - monthData[ym].expense;
        monthData[ym].balance = running;
      });
      const firstYM = sorted[0].date.slice(0, 7);
      const now = /* @__PURE__ */ new Date();
      const lastYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const firstYear = +firstYM.slice(0, 4);
      const lastYear = +lastYM.slice(0, 4);
      const years = [];
      for (let yr = lastYear; yr >= firstYear; yr--) years.push(yr);
      const factor = this.toMinor(1, a.currency);
      const digits = factor === 1 ? 0 : factor === 1e3 ? 3 : 2;
      const fmtPlain = new Intl.NumberFormat(void 0, { style: "decimal", minimumFractionDigits: digits, maximumFractionDigits: digits });
      const fp = (minor) => fmtPlain.format(this.fromMinor(minor, a.currency));
      const monthShort = Array.from({ length: 12 }, (_, i) => new Date(2e3, i, 1).toLocaleDateString(void 0, { month: "short" }));
      return `
      <p class="text-xs text-zinc-500 mb-2">All figures in <span class="font-medium text-zinc-700 dark:text-zinc-300">${a.currency}</span> \xB7 End-of-month balance (top) \xB7 monthly net (bottom)</p>
      <div class="card overflow-auto mb-4">
        <table class="w-full text-sm" style="min-width:820px">
          <thead>
            <tr class="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
              <th class="text-left py-2 px-3 sticky left-0 bg-white dark:bg-zinc-950">Year</th>
              ${monthShort.map((m) => `<th class="text-right py-2 px-2">${m}</th>`).join("")}
              <th class="text-right py-2 px-3">Year-end</th>
            </tr>
          </thead>
          <tbody>
            ${years.map((yr) => {
        let eoy = null;
        const cells = [];
        for (let mm = 1; mm <= 12; mm++) {
          const ym = `${yr}-${String(mm).padStart(2, "0")}`;
          const d = monthData[ym];
          if (!d) {
            cells.push(`<td class="text-right py-2 px-2 text-zinc-400">\u2014</td>`);
            continue;
          }
          eoy = d.balance;
          const dim = d.hasActivity ? "" : "opacity-50";
          const netSign = d.net >= 0 ? "+" : "-";
          const netColor = d.net > 0 ? "text-emerald-500" : d.net < 0 ? "text-rose-500" : "text-zinc-400";
          const balColor = d.balance < 0 ? "text-rose-500" : "";
          cells.push(`
                  <td class="text-right py-2 px-2 ${dim}">
                    <div class="font-medium tabular-nums ${balColor}">${fp(d.balance)}</div>
                    ${d.hasActivity ? `<div class="text-[10px] tabular-nums ${netColor}">${netSign}${fp(Math.abs(d.net))}</div>` : ""}
                  </td>`);
        }
        return `
                <tr class="border-b border-zinc-100 dark:border-zinc-900">
                  <td class="font-semibold py-2 px-3 sticky left-0 bg-white dark:bg-zinc-950">${yr}</td>
                  ${cells.join("")}
                  <td class="text-right py-2 px-3 font-semibold tabular-nums">${eoy != null ? fp(eoy) : "\u2014"}</td>
                </tr>`;
      }).join("")}
          </tbody>
        </table>
      </div>`;
    }
    #bulkBar(isShared = false, shareIndex = null) {
      if (!this.#multiSelect) return "";
      const n = this.#selectedIds.size;
      const allSelected = this.#visibleIds.length > 0 && this.#visibleIds.every((id) => this.#selectedIds.has(id));
      const deleteAction = isShared && shareIndex !== null ? `window.__app.bulkDeleteSharedAccTx(${shareIndex})` : `window.__app.bulkDeleteAccTx()`;
      return `
      <div class="fixed bottom-20 md:bottom-6 left-0 right-0 flex justify-center z-40 px-4">
        <div class="card flex items-center gap-2 px-3 py-3 shadow-2xl" style="max-width:520px;width:100%">
          <span class="text-sm font-medium">${n} selected</span>
          <button class="btn btn-ghost text-sm px-2"
                  onclick="${allSelected ? "window.__app.deselectAllAccTx()" : "window.__app.selectAllAccTx()"}">
            <i data-lucide="${allSelected ? "square" : "check-square"}"></i>
            <span class="hidden md:inline ml-1">${allSelected ? "Deselect all" : "Select all"}</span>
          </button>
          <div class="flex-1"></div>
          <button class="btn btn-ghost text-sm" onclick="window.__app.toggleAccountMultiSelect()">Cancel</button>
          ${n > 0 ? `<button class="btn btn-outline text-rose-500 text-sm" onclick="${deleteAction}"><i data-lucide="trash-2"></i> Delete</button>` : ""}
        </div>
      </div>`;
    }
    #txTouchesAccount(t, accountId) {
      if (t.accountId === accountId) return true;
      if (Array.isArray(t.splits)) return t.splits.some((s) => (s.accountId || t.accountId) === accountId);
      return false;
    }
    /** Delegates to AccountService — single source of truth for ledger computation. */
    #ledgerSum(account, transactions) {
      return this.#accountService.ledgerSum(account, transactions);
    }
    #withinRange(iso, range) {
      if (range === "all") return true;
      const days = parseInt(range, 10);
      const cutoff = /* @__PURE__ */ new Date();
      cutoff.setDate(cutoff.getDate() - days);
      return /* @__PURE__ */ new Date(iso + "T12:00:00") >= cutoff;
    }
    #accessLabel(perm) {
      const MAP = { owner: "Owner", full: "Full access", edit: "Can edit", view: "View only" };
      return MAP[perm] || perm;
    }
  };

  // src/ui/views/BudgetsView.js
  var BudgetsView = class extends BaseView {
    /** @type {BudgetService} */
    #budgets;
    /** @type {HijriCalendarService} */
    #hijri;
    constructor() {
      super();
      this.#budgets = new BudgetService();
      this.#hijri = new HijriCalendarService();
    }
    render() {
      const state = this.state;
      const todayIso = DateService.todayIso();
      const todayH = this.#hijri.toHijri(todayIso);
      const now = /* @__PURE__ */ new Date();
      const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Budgets</h1>
          <div class="text-xs text-zinc-500 mt-0.5">Gregorian-month or Hijri-month tracking</div>
        </div>
        <button class="btn btn-primary" onclick="window.__app.openModal('budget')">
          <i data-lucide="plus"></i> New budget
        </button>
      </div>

      ${state.budgets.length === 0 ? `<div class="card p-10 text-center">${this.emptyState("No budgets yet", "Set a monthly limit per category to stay on track.")}</div>` : `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${state.budgets.map((b) => this.#budgetCard(b, todayH, now, eom)).join("")}
          </div>`}
    `;
    }
    // ── Private ───────────────────────────────────────────────────────────
    #budgetCard(b, todayH, now, eom) {
      const targetIds = this.#budgets.targetCategoryIds(b);
      const cats = targetIds.map((id) => this.state.categories.find((c) => c.id === id)).filter(Boolean);
      const firstCat = cats[0];
      const isHijri = b.period === "hijri";
      const spent = this.#budgets.currentSpend(b);
      const eff = this.#budgets.effectiveLimit(b);
      const limit = eff.limit;
      const pct = limit === 0 ? 0 : Math.min(100, Math.round(100 * spent / limit));
      const color = pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#10b981";
      const daysLeft = isHijri ? this.#hijri.daysInMonth(todayH.year, todayH.month) - todayH.day : eom.getDate() - now.getDate();
      const multi = targetIds.length > 1;
      const hasSubs = !multi && this.state.categories.some((c) => c.parentId === firstCat?.id);
      const title = cats.length ? cats.map((c) => this.escapeHtml(c.name)).join(", ") : "Category";
      const split = multi ? this.#budgets.spendByCategory(b) : [];
      const periodLabel = isHijri ? `<span class="inline-flex items-center gap-1"><i data-lucide="moon-star" style="width:11px;height:11px"></i> ${this.#hijri.monthsShort[todayH.month]} ${todayH.year} H</span>` : `<span class="inline-flex items-center gap-1"><i data-lucide="calendar" style="width:11px;height:11px"></i> ${now.toLocaleDateString(void 0, { month: "long" })}</span>`;
      return `
      <div class="card p-5 cursor-pointer hover:shadow-md transition-shadow" onclick="window.__app.openBudgetDetail('${b.id}')">
        <div class="flex items-start gap-3">
          <div class="icon-pill" style="background:${firstCat?.color || "#10b981"}22;color:${firstCat?.color || "#10b981"}">
            <i data-lucide="${firstCat?.icon || (multi ? "layers" : "circle")}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between gap-2">
              <div class="font-semibold flex items-center gap-2 min-w-0">
                <span class="truncate">${title}</span>
                ${multi ? `<span class="chip flex-shrink-0" style="font-size:.65rem">${cats.length} categories</span>` : hasSubs ? '<span class="chip flex-shrink-0" style="font-size:.65rem">incl. sub-categories</span>' : ""}
              </div>
              <button class="btn btn-ghost flex-shrink-0" onclick="event.stopPropagation(); window.__app.openModal('budget',{id:'${b.id}'})" title="Edit budget">
                <i data-lucide="pencil"></i>
              </button>
            </div>
            <div class="text-xs text-zinc-500">${periodLabel}${b.rollover ? " \xB7 rollover on" : ""}</div>
          </div>
        </div>
        <div class="mt-4">
          <div class="flex items-baseline justify-between">
            <div class="text-lg font-semibold">${this.formatMoney(spent, b.currency)}</div>
            <div class="text-sm text-zinc-500">/ ${this.formatMoney(limit, b.currency)}${eff.rollover ? ` <span class="text-emerald-600">(+${this.formatMoney(eff.rollover, b.currency)})</span>` : ""}</div>
          </div>
          <div class="progress mt-2"><div style="width:${pct}%; background:${color}"></div></div>
          <div class="flex items-center justify-between mt-2 text-xs">
            <span class="text-zinc-500">${pct}% used \xB7 ${Math.max(0, daysLeft)} ${isHijri ? "Hijri " : ""}day${daysLeft === 1 ? "" : "s"} left</span>
            <span class="${spent >= limit ? "text-rose-500" : "text-emerald-500"}">
              ${spent >= limit ? `Over by ${this.formatMoney(spent - limit, b.currency)}` : `${this.formatMoney(limit - spent, b.currency)} left`}
            </span>
          </div>
          ${multi ? `
            <div class="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-1">
              ${split.map((s) => `
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-1.5 min-w-0">
                    <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" style="background:${s.color}"></span>
                    <span class="truncate">${this.escapeHtml(s.name)}</span>
                  </span>
                  <span class="text-zinc-500 flex-shrink-0">${this.formatMoney(s.spend, b.currency)}</span>
                </div>`).join("")}
            </div>` : ""}
        </div>
      </div>`;
    }
  };

  // src/ui/views/BudgetDetailView.js
  var BudgetDetailView = class extends BaseView {
    /** @type {BudgetService} */
    #budgets;
    /** @type {HijriCalendarService} */
    #hijri;
    /** @type {TransactionRowRenderer} */
    #rowRenderer;
    /** @type {string|null} */
    #budgetId = null;
    constructor() {
      super();
      this.#budgets = new BudgetService();
      this.#hijri = new HijriCalendarService();
      this.#rowRenderer = new TransactionRowRenderer();
    }
    setBudget(id) {
      this.#budgetId = id;
    }
    get budgetId() {
      return this.#budgetId;
    }
    render() {
      if (!this.#budgetId) return "";
      const state = this.state;
      const b = state.budgets.find((x) => x.id === this.#budgetId);
      if (!b) return `<div class="p-6 text-zinc-400">Budget not found.</div>`;
      const targetIds = this.#budgets.targetCategoryIds(b);
      const cats = targetIds.map((id) => state.categories.find((c) => c.id === id)).filter(Boolean);
      const spent = this.#budgets.currentSpend(b);
      const eff = this.#budgets.effectiveLimit(b);
      const limit = eff.limit;
      const pct = limit === 0 ? 0 : Math.min(100, Math.round(100 * spent / limit));
      const color = pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#10b981";
      const split = this.#budgets.spendByCategory(b);
      const txs = this.#budgets.periodTransactions(b);
      const isHijri = b.period === "hijri";
      const now = /* @__PURE__ */ new Date();
      const todayH = this.#hijri.toHijri(now);
      const periodLabel = isHijri ? `${this.#hijri.monthsLong[todayH.month]} ${todayH.year} H` : now.toLocaleDateString(void 0, { month: "long", year: "numeric" });
      const title = cats.length ? cats.map((c) => c.name).join(", ") : "Budget";
      const firstColor = cats[0]?.color || "#10b981";
      const firstIcon = cats[0]?.icon || "target";
      const dayGroups = {};
      txs.forEach((t) => {
        (dayGroups[t.date] = dayGroups[t.date] || []).push(t);
      });
      return `
      <div class="flex items-center gap-2 mb-4">
        <button class="btn btn-ghost" onclick="window.__app.navigate('budgets')" title="Back to Budgets">
          <i data-lucide="arrow-left"></i><span class="hidden md:inline ml-1">Budgets</span>
        </button>
        <div class="flex-1"></div>
        <button class="btn btn-outline" onclick="window.__app.openModal('budget',{id:'${b.id}'})">
          <i data-lucide="pencil"></i><span class="hidden md:inline ml-1">Edit</span>
        </button>
      </div>

      <div class="card p-5 mb-4">
        <div class="flex items-start gap-3">
          <div class="icon-pill" style="background:${firstColor}22;color:${firstColor};width:44px;height:44px">
            <i data-lucide="${firstIcon}" style="width:22px;height:22px"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xl font-semibold">${this.escapeHtml(title)}</div>
            <div class="text-xs text-zinc-500">
              <i data-lucide="${isHijri ? "moon-star" : "calendar"}" style="width:11px;height:11px;display:inline"></i>
              ${periodLabel}${b.rollover ? " \xB7 rollover on" : ""}
            </div>
          </div>
        </div>

        <div class="mt-4">
          <div class="flex items-baseline justify-between">
            <div class="text-2xl font-semibold">${this.formatMoney(spent, b.currency)}</div>
            <div class="text-sm text-zinc-500">/ ${this.formatMoney(limit, b.currency)}${eff.rollover ? ` <span class="text-emerald-600">(+${this.formatMoney(eff.rollover, b.currency)})</span>` : ""}</div>
          </div>
          <div class="progress mt-2"><div style="width:${pct}%; background:${color}"></div></div>
          <div class="flex items-center justify-between mt-2 text-xs">
            <span class="text-zinc-500">${pct}% used</span>
            <span class="${spent >= limit ? "text-rose-500" : "text-emerald-500"}">
              ${spent >= limit ? `Over by ${this.formatMoney(spent - limit, b.currency)}` : `${this.formatMoney(limit - spent, b.currency)} left`}
            </span>
          </div>
        </div>

        ${split.length > 1 ? `
          <div class="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5">
            <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1">By category</div>
            ${split.map((s) => `
              <div class="flex items-center justify-between text-sm">
                <span class="flex items-center gap-2 min-w-0">
                  <span class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${s.color}"></span>
                  <span class="truncate">${this.escapeHtml(s.name)}</span>
                </span>
                <span class="text-zinc-500 flex-shrink-0">${this.formatMoney(s.spend, b.currency)}</span>
              </div>`).join("")}
          </div>` : ""}
      </div>

      <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2 px-1">
        ${txs.length} transaction${txs.length === 1 ? "" : "s"} this period
      </div>
      ${txs.length === 0 ? `<div class="card p-10 text-center">${this.emptyState("No spending yet", "No transactions have counted toward this budget this period.")}</div>` : Object.keys(dayGroups).map((date) => `
            <div class="mb-2">
              <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1 px-1">${this.dateLabel(date)}</div>
              <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
                ${dayGroups[date].map((t) => this.#rowRenderer.render(t, { multiSelect: false, selectedIds: /* @__PURE__ */ new Set() })).join("")}
              </div>
            </div>`).join("")}
    `;
    }
  };

  // src/ui/views/CategoriesView.js
  var CategoriesView = class extends BaseView {
    constructor() {
      super();
    }
    render() {
      const state = this.state;
      const sections = ["expense", "income", "transfer"];
      if (!Array.isArray(state.user.collapsedCategories)) state.user.collapsedCategories = [];
      const collapsed = new Set(state.user.collapsedCategories);
      const collapsibleParents = state.categories.filter(
        (c) => !c.parentId && state.categories.some((ch) => ch.parentId === c.id)
      );
      const anyExpanded = collapsibleParents.some((p) => !collapsed.has(p.id));
      const anyCollapsed = collapsibleParents.some((p) => collapsed.has(p.id));
      return `
      <div class="flex items-center justify-between mb-6 gap-2">
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Categories</h1>
        <div class="flex items-center gap-2">
          ${collapsibleParents.length ? `
            ${anyExpanded ? `<button class="btn btn-ghost text-sm" onclick="window.__app.collapseAllCategories()" title="Collapse every parent"><i data-lucide="chevrons-down-up" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Collapse all</span></button>` : ""}
            ${anyCollapsed ? `<button class="btn btn-ghost text-sm" onclick="window.__app.expandAllCategories()" title="Expand every parent"><i data-lucide="chevrons-up-down" style="width:14px;height:14px"></i><span class="hidden md:inline ml-1">Expand all</span></button>` : ""}
          ` : ""}
          <button class="btn btn-primary" onclick="window.__app.openModal('category')">
            <i data-lucide="plus"></i> New category
          </button>
        </div>
      </div>

      ${sections.map((sec) => this.#section(sec, state.categories, collapsed)).join("")}
    `;
    }
    // ── Private ───────────────────────────────────────────────────────────
    #section(sec, categories, collapsed) {
      const list = categories.filter((c) => c.type === sec);
      if (!list.length) return "";
      const roots = list.filter((c) => !c.parentId);
      return `
      <div class="mb-6">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2 px-1">${sec}</div>
        <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
          ${roots.map((p) => {
        const children = list.filter((c) => c.parentId === p.id);
        const isCollapsed = collapsed.has(p.id);
        const showChildren = children.length > 0 && !isCollapsed;
        return this.#parentRow(p, children, isCollapsed) + (showChildren ? children.map((c) => this.#childRow(c)).join("") : "");
      }).join("")}
        </div>
      </div>`;
    }
    #parentRow(p, children, isCollapsed) {
      const hasChildren = children.length > 0;
      const toggleIcon = !hasChildren ? "" : `
      <button type="button"
              onclick="event.stopPropagation();window.__app.toggleCategoryCollapse('${p.id}')"
              class="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 -my-1 -ml-1 mr-1 p-1"
              title="${isCollapsed ? "Expand subcategories" : "Collapse subcategories"}">
        <i data-lucide="${isCollapsed ? "chevron-right" : "chevron-down"}" style="width:16px;height:16px;display:inline"></i>
      </button>`;
      return `
      <div class="w-full flex items-center gap-2 px-2 hover:bg-zinc-50 dark:hover:bg-zinc-900">
        ${toggleIcon || '<span style="width:24px;display:inline-block"></span>'}
        <button onclick="window.__app.openModal('category',{id:'${p.id}'})"
                class="flex-1 flex items-center gap-3 py-3 text-left">
          <div class="icon-pill" style="background:${p.color}22;color:${p.color}">
            <i data-lucide="${p.icon}"></i>
          </div>
          <div class="flex-1 font-medium">${this.escapeHtml(p.name)}</div>
          ${hasChildren ? `<span class="chip" style="font-size:.65rem">${children.length} sub${children.length === 1 ? "" : "s"}</span>` : ""}
          <i data-lucide="chevron-right" class="text-zinc-400"></i>
        </button>
      </div>`;
    }
    #childRow(c) {
      return `
      <button onclick="window.__app.openModal('category',{id:'${c.id}'})"
              class="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 pl-12">
        <div class="icon-pill" style="background:${c.color}22;color:${c.color};width:28px;height:28px">
          <i data-lucide="${c.icon}" style="width:14px;height:14px"></i>
        </div>
        <div class="flex-1 font-medium text-sm">${this.escapeHtml(c.name)}</div>
        <span class="chip" style="font-size:.65rem">sub</span>
        <i data-lucide="chevron-right" class="text-zinc-400"></i>
      </button>`;
    }
  };

  // src/ui/views/ReportsView.js
  var ReportsView = class extends BaseView {
    /** @type {ReportService} */
    #reports;
    /** @type {HijriCalendarService} */
    #hijri;
    /** @type {string} */
    #range = "30";
    // Chart instances — destroyed before each re-draw
    #charts = { bar: null, donut: null, nw: null };
    constructor() {
      super();
      this.#reports = new ReportService();
      this.#hijri = new HijriCalendarService();
    }
    // ── Public API ────────────────────────────────────────────────────────
    setRange(r) {
      this.#range = r;
    }
    get range() {
      return this.#range;
    }
    // ── BaseView contract ─────────────────────────────────────────────────
    render() {
      const showHijri = this.state.user?.showHijri;
      return `
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Reports</h1>
        <div class="flex items-center gap-2">
          <select class="select" onchange="window.__app.setReportRange(this.value)">
            <option value="7"  ${this.#range === "7" ? "selected" : ""}>Last 7d</option>
            <option value="30" ${this.#range === "30" ? "selected" : ""}>Last 30d</option>
            <option value="90" ${this.#range === "90" ? "selected" : ""}>Last 90d</option>
          </select>
          <button class="btn btn-outline" onclick="window.__app.openModal('csv')">
            <i data-lucide="download"></i> Export
          </button>
          <button class="btn btn-outline" onclick="window.print()" title="Save as PDF via browser print">
            <i data-lucide="printer"></i> PDF
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="card p-5">
          <h3 class="font-semibold mb-3">Daily spending</h3>
          <div style="height:240px;position:relative"><canvas id="reportBar"></canvas></div>
        </div>
        <div class="card p-5">
          <h3 class="font-semibold mb-3">By category</h3>
          <div style="height:240px;position:relative"><canvas id="reportDonut"></canvas></div>
        </div>
      </div>

      <div class="card p-5 mt-4">
        <h3 class="font-semibold mb-3 flex items-center gap-2">
          <i data-lucide="trending-up"></i> Net worth over time
        </h3>
        <div style="height:240px;position:relative"><canvas id="reportNetWorth"></canvas></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div class="card p-5">
          <h3 class="font-semibold mb-3 flex items-center gap-2">
            <i data-lucide="flame"></i> Biggest transactions
          </h3>
          <div id="reportTopTx"></div>
        </div>
        <div class="card p-5">
          <h3 class="font-semibold mb-3">Breakdown</h3>
          <div id="reportTable"></div>
        </div>
      </div>

      ${showHijri ? `
        <div class="card p-5 mt-4">
          <h3 class="font-semibold mb-1 flex items-center gap-2">
            <i data-lucide="moon-star"></i> By Hijri month
          </h3>
          <div class="text-xs text-zinc-500 mb-3">Spending grouped by Hijri month over the selected range</div>
          <div id="hijriMonthBreakdown"></div>
        </div>` : ""}
    `;
    }
    onAfterRender() {
      this.#drawCharts();
    }
    // ── Private ───────────────────────────────────────────────────────────
    #drawCharts() {
      const home = this.homeCurrency;
      const state = this.state;
      const days = Number(this.#range);
      const dayKeys = [];
      const labels = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = /* @__PURE__ */ new Date();
        d.setDate(d.getDate() - i);
        const k = DateService.toIso(d);
        dayKeys.push(k);
        labels.push(d.toLocaleDateString(void 0, { month: "short", day: "numeric" }));
      }
      const expenseByDay = Object.fromEntries(dayKeys.map((k) => [k, 0]));
      state.transactions.filter((t) => t.type === "expense" && dayKeys.includes(t.date)).forEach((t) => {
        expenseByDay[t.date] += this.fromMinor(this.convert(t.amount, t.currency, home), home);
      });
      const ctx1 = document.getElementById("reportBar");
      if (ctx1) {
        if (this.#charts.bar) {
          this.#charts.bar.destroy();
          this.#charts.bar = null;
        }
        this.#charts.bar = new Chart(ctx1, {
          // eslint-disable-line no-undef
          type: "bar",
          data: { labels, datasets: [{ data: dayKeys.map((k) => expenseByDay[k]), backgroundColor: "#09090b", borderRadius: 6 }] },
          options: {
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { maxTicksLimit: 7, color: "#a1a1aa" }, grid: { display: false } },
              y: { ticks: { color: "#a1a1aa" }, grid: { color: "rgba(120,120,120,.1)" } }
            }
          }
        });
      }
      const spending = this.#reports.spendingByCategory(days);
      const items = spending.map(({ categoryId, amount }) => {
        const cat = state.categories.find((c) => c.id === categoryId);
        return cat ? { cat, amount } : null;
      }).filter(Boolean);
      const ctx2 = document.getElementById("reportDonut");
      if (ctx2) {
        if (this.#charts.donut) {
          this.#charts.donut.destroy();
          this.#charts.donut = null;
        }
        if (items.length) {
          this.#charts.donut = new Chart(ctx2, {
            // eslint-disable-line no-undef
            type: "doughnut",
            data: {
              labels: items.map((i) => i.cat.name),
              datasets: [{ data: items.map((i) => this.fromMinor(i.amount, home)), backgroundColor: items.map((i) => i.cat.color), borderWidth: 0 }]
            },
            options: { cutout: "65%", plugins: { legend: { position: "bottom", labels: { color: "#a1a1aa", boxWidth: 10 } } } }
          });
        } else {
          ctx2.parentElement.innerHTML = `<div class="text-center text-sm text-zinc-500 py-12">No expenses in range.</div>`;
        }
      }
      const total = items.reduce((s, i) => s + i.amount, 0);
      const tableEl = document.getElementById("reportTable");
      if (tableEl) {
        tableEl.innerHTML = items.length ? `<table class="w-full text-sm">
             <thead class="text-zinc-500 text-xs uppercase tracking-wider">
               <tr><th class="text-left py-2">Category</th><th class="text-right py-2">Amount</th><th class="text-right py-2 w-20">Share</th></tr>
             </thead>
             <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
               ${items.map((i) => `
                 <tr>
                   <td class="py-2"><span class="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style="background:${i.cat.color}"></span>${this.escapeHtml(i.cat.name)}</td>
                   <td class="text-right py-2">${this.formatMoney(i.amount, home)}</td>
                   <td class="text-right py-2 text-zinc-500">${Math.round(100 * i.amount / total)}%</td>
                 </tr>`).join("")}
             </tbody>
           </table>` : `<div class="text-sm text-zinc-500 text-center py-4">No data.</div>`;
      }
      const nwSeries = this.#reports.netWorthSeries();
      const nwCtx = document.getElementById("reportNetWorth");
      if (nwCtx) {
        if (this.#charts.nw) {
          this.#charts.nw.destroy();
          this.#charts.nw = null;
        }
        this.#charts.nw = new Chart(nwCtx, {
          // eslint-disable-line no-undef
          type: "line",
          data: {
            labels: nwSeries.map((p) => p.date),
            datasets: [{
              data: nwSeries.map((p) => this.fromMinor(p.netWorth, home)),
              fill: true,
              borderColor: "#0ea5e9",
              backgroundColor: "rgba(14,165,233,0.12)",
              tension: 0.25,
              pointRadius: 0,
              borderWidth: 2
            }]
          },
          options: {
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { maxTicksLimit: 6, color: "#a1a1aa" }, grid: { display: false } },
              y: { ticks: { color: "#a1a1aa", callback: (v) => this.formatMoney(this.toMinor(v, home), home) }, grid: { color: "rgba(120,120,120,.1)" } }
            }
          }
        });
      }
      const topEl = document.getElementById("reportTopTx");
      if (topEl) {
        const tops = this.#reports.topTransactions(5, days);
        topEl.innerHTML = tops.length === 0 ? `<div class="text-sm text-zinc-500 text-center py-4">No expenses in range.</div>` : `<div class="divide-y divide-zinc-100 dark:divide-zinc-800">
            ${tops.map(({ t, value }) => {
          const cat = state.categories.find((c) => c.id === t.categoryId);
          return `
                <button onclick="window.__app.openModal('transaction',{id:'${t.id}'})"
                        class="w-full text-left flex items-center gap-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded">
                  <div class="icon-pill" style="background:${cat?.color || "#71717a"}22;color:${cat?.color || "#71717a"};width:30px;height:30px">
                    <i data-lucide="${cat?.icon || "circle"}" style="width:14px;height:14px"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium truncate">${this.escapeHtml(t.payee || cat?.name || "Transaction")}</div>
                    <div class="text-xs text-zinc-500 truncate">${this.escapeHtml(cat?.name || "")} \xB7 ${this.dateLabel(t.date).split(" \xB7 ")[0]}</div>
                  </div>
                  <div class="text-sm font-semibold text-rose-500">-${this.formatMoney(value, home)}</div>
                </button>`;
        }).join("")}
          </div>`;
      }
      if (state.user?.showHijri) {
        const byHijriMonth = this.#reports.spendingByHijriMonth(days);
        const el = document.getElementById("hijriMonthBreakdown");
        if (el) {
          const max = Math.max(1, ...byHijriMonth.map((x) => x.amount));
          el.innerHTML = byHijriMonth.length ? byHijriMonth.map((x) => `
              <div class="mb-2.5">
                <div class="flex justify-between text-sm mb-1">
                  <span>${this.#hijri.monthsLong[x.month]} <span class="text-zinc-500 text-xs">${x.year} H</span></span>
                  <span class="font-medium">${this.formatMoney(x.amount, home)}</span>
                </div>
                <div class="progress"><div style="width:${Math.round(100 * x.amount / max)}%; background:#0ea5e9"></div></div>
              </div>`).join("") : `<div class="text-sm text-zinc-500 text-center py-4">No data.</div>`;
        }
      }
    }
  };

  // src/ui/views/DebtsView.js
  var DebtsView = class extends BaseView {
    constructor() {
      super();
    }
    render() {
      const { state, homeCurrency: home } = this;
      const debts = state.debts || [];
      const active = debts.filter((d) => d.status !== "paid");
      const paid = debts.filter((d) => d.status === "paid");
      const youOwe = active.filter((d) => d.type === "borrowed").reduce((s, d) => s + this.convert(this.#remaining(d, state), d.currency, home), 0);
      const owedToYou = active.filter((d) => d.type === "lent").reduce((s, d) => s + this.convert(this.#remaining(d, state), d.currency, home), 0);
      return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Debts</h1>
          <div class="text-xs text-zinc-500 mt-0.5">Track loans, repayments and IOUs \xB7 all linked to your accounts</div>
        </div>
        <button class="btn btn-primary" onclick="window.__app.openModal('debt')">
          <i data-lucide="plus"></i> New debt
        </button>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="card p-5">
          <div class="text-xs text-zinc-500 mb-1 flex items-center gap-1.5">
            <i data-lucide="arrow-down-left" class="text-rose-500"></i> You owe
          </div>
          <div class="text-2xl font-semibold text-rose-500">${this.formatMoney(youOwe, home)}</div>
          <div class="text-xs text-zinc-500 mt-1">${active.filter((d) => d.type === "borrowed").length} active</div>
        </div>
        <div class="card p-5">
          <div class="text-xs text-zinc-500 mb-1 flex items-center gap-1.5">
            <i data-lucide="arrow-up-right" class="text-emerald-500"></i> Owed to you
          </div>
          <div class="text-2xl font-semibold text-emerald-500">${this.formatMoney(owedToYou, home)}</div>
          <div class="text-xs text-zinc-500 mt-1">${active.filter((d) => d.type === "lent").length} active</div>
        </div>
      </div>

      ${active.length === 0 ? `<div class="card p-10 text-center">${this.emptyState("No active debts", "Record money you have borrowed or lent. The amount syncs straight to the linked account.")}</div>` : `<div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Active</div>
           <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
             ${active.map((d) => this.#debtCard(d, state)).join("")}
           </div>`}

      ${paid.length ? `
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Paid off</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${paid.map((d) => this.#debtCard(d, state)).join("")}
        </div>` : ""}
    `;
    }
    // ── Private ───────────────────────────────────────────────────────────
    #debtCard(d, state) {
      const acc = state.accounts.find((a) => a.id === d.accountId);
      const rem = this.#remaining(d, state);
      const paidAmt = this.#paidAmount(d, state);
      const pct = d.principal === 0 ? 100 : Math.min(100, Math.round(100 * paidAmt / d.principal));
      const isBorrowed = d.type === "borrowed";
      const typeColor = isBorrowed ? "#ef4444" : "#10b981";
      const typeLabel = isBorrowed ? "You owe" : "Owed to you";
      const typeIcon = isBorrowed ? "arrow-down-left" : "arrow-up-right";
      const due = d.dueDate ? /* @__PURE__ */ new Date(d.dueDate + "T12:00:00") : null;
      const today = /* @__PURE__ */ new Date();
      const daysUntilDue = due ? Math.ceil((due - today) / 864e5) : null;
      const payTxs = state.transactions.filter((t) => t.debtId === d.id && t.id !== d.initialTxId);
      return `
      <div class="card p-5 ${d.status === "paid" ? "opacity-60" : ""}">
        <div class="flex items-start gap-3">
          <div class="icon-pill" style="background:${typeColor}22;color:${typeColor}">
            <i data-lucide="${typeIcon}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 justify-between">
              <div class="font-semibold truncate">${this.escapeHtml(d.counterparty)}</div>
              <div class="flex gap-1">
                ${d.status !== "paid" ? `<button class="btn btn-ghost" onclick="window.__app.openModal('debtPayment',{id:'${d.id}'})" title="Record payment"><i data-lucide="hand-coins"></i></button>` : ""}
                <button class="btn btn-ghost" onclick="window.__app.openModal('debt',{id:'${d.id}'})" title="Edit"><i data-lucide="pencil"></i></button>
              </div>
            </div>
            <div class="text-xs text-zinc-500">${typeLabel}${acc ? ` \xB7 ${this.escapeHtml(acc.name)}` : ""}</div>
          </div>
        </div>
        <div class="mt-4">
          <div class="flex items-baseline justify-between">
            <div class="text-lg font-semibold ${d.status === "paid" ? "text-zinc-500 line-through" : ""}">${this.formatMoney(rem, d.currency)}</div>
            <div class="text-sm text-zinc-500">/ ${this.formatMoney(d.principal, d.currency)}</div>
          </div>
          <div class="progress mt-2"><div style="width:${pct}%; background:${typeColor}"></div></div>
          <div class="flex items-center justify-between mt-2 text-xs">
            <span class="text-zinc-500">${pct}% repaid \xB7 ${payTxs.length} payment${payTxs.length === 1 ? "" : "s"}</span>
            ${d.status === "paid" ? `<span class="text-emerald-500 inline-flex items-center gap-1"><i data-lucide="check-circle-2" style="width:11px;height:11px"></i> Paid off</span>` : daysUntilDue !== null ? daysUntilDue < 0 ? `<span class="text-rose-500">Overdue ${-daysUntilDue}d</span>` : `<span class="text-zinc-500">Due in ${daysUntilDue}d</span>` : '<span class="text-zinc-500">No due date</span>'}
          </div>
          ${d.note ? `<div class="text-xs text-zinc-500 mt-2">${this.escapeHtml(d.note)}</div>` : ""}
        </div>
      </div>`;
    }
    /** Remaining balance = principal − sum of payment transactions (cross-currency aware) */
    #remaining(d, state) {
      const payments = state.transactions.filter(
        (t) => t.debtId === d.id && t.id !== d.initialTxId
      );
      const paid = payments.reduce((sum, t) => {
        const fromCcy = t.currency || d.currency;
        return sum + this.convert(t.amount, fromCcy, d.currency);
      }, 0);
      return Math.max(0, d.principal - paid);
    }
    /** Total amount paid back so far */
    #paidAmount(d, state) {
      const payments = state.transactions.filter((t) => t.debtId === d.id && t.id !== d.initialTxId);
      return payments.reduce((s, t) => s + this.convert(t.amount, t.currency || d.currency, d.currency), 0);
    }
  };

  // src/ui/views/CalendarView.js
  var CalendarView = class extends BaseView {
    /** @type {HijriCalendarService} */
    #hijri;
    /** @type {string|null} */
    #focus = null;
    // ISO date of focused month
    /** @type {string} */
    #tab = "grid";
    // 'grid' | 'summary' | 'items'
    constructor() {
      super();
      this.#hijri = new HijriCalendarService();
    }
    // ── Public API ────────────────────────────────────────────────────────
    setTab(tab) {
      this.#tab = tab;
    }
    shiftMonth(delta) {
      this.#ensureFocus();
      const mode = this.#calMode();
      if (mode === "hijri") {
        const h = this.#hijri.toHijri(this.#focus);
        let m = h.month + delta, y = h.year;
        while (m < 0) {
          m += 12;
          y -= 1;
        }
        while (m > 11) {
          m -= 12;
          y += 1;
        }
        this.#focus = this.#isoDate(this.#hijri.toGregorian(y, m, 1));
      } else {
        const d = /* @__PURE__ */ new Date(this.#focus + "T12:00:00");
        d.setDate(1);
        d.setMonth(d.getMonth() + delta);
        this.#focus = this.#isoDate(d);
      }
    }
    resetFocus() {
      this.#focus = null;
    }
    // ── BaseView contract ─────────────────────────────────────────────────
    render() {
      this.#ensureFocus();
      const state = this.state;
      const items = state.regularItems || [];
      const mode = this.#calMode();
      return `
      <div class="flex items-center justify-between mb-4 gap-2">
        <div class="min-w-0">
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Regular Purchases</h1>
          <div class="text-xs text-zinc-500 mt-0.5">${items.length} item${items.length === 1 ? "" : "s"} \xB7 entries flow into your ledger</div>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          <div class="hidden md:flex card p-1 gap-0.5 text-xs">
            ${[["gregorian", "Greg"], ["both", "Both"], ["hijri", "Hijri"]].map(
        ([k, l]) => `<button onclick="window.__app.setCalendarMode('${k}')"
                       class="px-2 py-1 rounded ${mode === k ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500"}">${l}</button>`
      ).join("")}
          </div>
          <button class="btn btn-outline" onclick="window.__app.openModal('regularItem')">
            <i data-lucide="plus"></i> <span class="hidden sm:inline">Item</span>
          </button>
        </div>
      </div>

      <div class="md:hidden flex gap-1 mb-3 card p-1 text-xs">
        ${[["gregorian", "Gregorian only"], ["both", "Show both"], ["hijri", "Hijri only"]].map(
        ([k, l]) => `<button onclick="window.__app.setCalendarMode('${k}')"
                   class="flex-1 px-2 py-1.5 rounded ${mode === k ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500"}">${l}</button>`
      ).join("")}
      </div>

      <div class="flex gap-2 mb-4 border-b border-zinc-200 dark:border-zinc-800">
        <button onclick="window.__app.setCalTab('grid')"
                class="px-3 py-2 text-sm ${this.#tab === "grid" ? "border-b-2 border-zinc-900 dark:border-white font-medium" : "text-zinc-500"}">Calendar</button>
        <button onclick="window.__app.setCalTab('summary')"
                class="px-3 py-2 text-sm ${this.#tab === "summary" ? "border-b-2 border-zinc-900 dark:border-white font-medium" : "text-zinc-500"}">Monthly summary</button>
        <button onclick="window.__app.setCalTab('items')"
                class="px-3 py-2 text-sm ${this.#tab === "items" ? "border-b-2 border-zinc-900 dark:border-white font-medium" : "text-zinc-500"}">Items</button>
      </div>

      ${this.#tab === "grid" ? this.#renderGrid(state) : this.#tab === "summary" ? this.#renderSummary(state) : this.#renderItems(state)}
    `;
    }
    // ── Sub-views ─────────────────────────────────────────────────────────
    #renderGrid(state) {
      const home = this.homeCurrency;
      const mode = this.#calMode();
      const isHijri = mode === "hijri";
      const showBoth = mode === "both";
      const today = /* @__PURE__ */ new Date();
      const todayStr = this.#isoDate(today);
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      let header, cells, monthSpent;
      if (isHijri) {
        const h = this.#hijri.toHijri(this.#focus);
        const daysInMonth = this.#hijri.daysInMonth(h.year, h.month);
        const day1 = this.#hijri.toGregorian(h.year, h.month, 1);
        const startWD = day1.getDay();
        header = `${this.#hijri.monthsLong[h.month]} ${h.year} H`;
        cells = [];
        for (let i = 0; i < startWD; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) {
          const g = this.#hijri.toGregorian(h.year, h.month, d);
          cells.push({ primary: d, secondary: g.getDate() + " " + g.toLocaleDateString(void 0, { month: "short" }), iso: this.#isoDate(g) });
        }
        monthSpent = this.#logsForHijriMonth(h.year, h.month, state).reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
      } else {
        const focus = /* @__PURE__ */ new Date(this.#focus + "T12:00:00");
        const year = focus.getFullYear();
        const monthIdx = focus.getMonth();
        const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
        const startWD = new Date(year, monthIdx, 1).getDay();
        header = focus.toLocaleDateString(void 0, { month: "long", year: "numeric" });
        cells = [];
        for (let i = 0; i < startWD; i++) cells.push(null);
        for (let d = 1; d <= daysInMonth; d++) {
          const dt = new Date(year, monthIdx, d, 12);
          const iso = this.#isoDate(dt);
          const h = this.#hijri.toHijri(iso);
          cells.push({ primary: d, secondary: h.day + " " + this.#hijri.monthsShort[h.month], iso });
        }
        monthSpent = this.#logsForMonth(year, monthIdx, state).reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
      }
      while (cells.length % 7 !== 0) cells.push(null);
      return `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1">
          <button class="btn btn-ghost" onclick="window.__app.shiftCalMonth(-1)" aria-label="Previous">
            <i data-lucide="chevron-left"></i>
          </button>
          <div class="font-semibold px-1 min-w-0">${this.escapeHtml(header)}</div>
          <button class="btn btn-ghost" onclick="window.__app.shiftCalMonth(1)" aria-label="Next">
            <i data-lucide="chevron-right"></i>
          </button>
          <button class="btn btn-ghost text-xs" onclick="window.__app.resetCalFocus()">Today</button>
        </div>
        <div class="text-sm text-zinc-500 hidden sm:block">${this.formatMoney(monthSpent, home)} this ${isHijri ? "Hijri month" : "month"}</div>
      </div>

      <div class="card p-2 md:p-3">
        <div class="grid grid-cols-7 gap-0.5 md:gap-1 mb-1">
          ${dayNames.map((n) => `<div class="text-xs text-zinc-500 text-center font-medium py-1">${n}</div>`).join("")}
        </div>
        <div class="grid grid-cols-7 gap-0.5 md:gap-1">
          ${cells.map((c) => {
        if (!c) return `<div></div>`;
        const logs = this.#logsForDate(c.iso, state);
        const total = logs.reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
        const isToday = c.iso === todayStr;
        const firstItem = logs[0] ? (state.regularItems || []).find((i) => i.id === logs[0].regularItemId) : null;
        const moreCount = Math.max(0, logs.length - 1);
        const dots = logs.slice(0, 4).map((t) => {
          const it = (state.regularItems || []).find((i) => i.id === t.regularItemId);
          return it ? `<span title="${this.escapeHtml(it.name)}" class="inline-block rounded-full border border-white/60 dark:border-zinc-900" style="width:10px;height:10px;background:${it.color}"></span>` : "";
        }).join("");
        const primaryColor = firstItem ? firstItem.color : "";
        return `
              <button onclick="window.__app.openModal('dayLogs',{date:'${c.iso}'})"
                      class="aspect-square rounded-lg flex flex-col items-stretch p-1 md:p-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition border ${isToday ? "border-zinc-900 dark:border-white" : "border-transparent"} ${logs.length ? "bg-zinc-50 dark:bg-zinc-900" : ""}"
                      style="${logs.length && primaryColor ? `box-shadow: inset 0 -3px 0 0 ${primaryColor}` : ""}">
                <div class="flex items-center justify-between leading-none">
                  <span class="${isToday ? "font-semibold" : ""} ${logs.length ? "font-medium" : ""}">${c.primary}</span>
                  ${showBoth ? `<span class="text-[9px] text-zinc-500 truncate ml-1">${this.escapeHtml(c.secondary)}</span>` : ""}
                </div>
                ${firstItem ? `
                  <div class="flex-1 flex items-center justify-center min-h-0">
                    <span class="icon-pill md:hidden" style="background:${firstItem.color}22;color:${firstItem.color};width:20px;height:20px">
                      <i data-lucide="${firstItem.icon}" style="width:11px;height:11px"></i>
                    </span>
                    <div class="hidden md:flex gap-0.5 flex-wrap justify-center items-center">${dots}${moreCount > 4 ? `<span class="text-[9px] text-zinc-500">+${logs.length - 4}</span>` : ""}</div>
                  </div>
                  ${moreCount > 0 ? `<div class="text-[9px] text-zinc-500 text-center md:hidden">+${moreCount}</div>` : ""}
                ` : '<div class="flex-1"></div>'}
                ${total > 0 ? `<div class="text-[9px] text-zinc-500 truncate text-center">${this.formatMoney(total, home)}</div>` : ""}
              </button>`;
      }).join("")}
        </div>
      </div>

      ${(state.regularItems || []).length === 0 ? `
        <div class="card p-6 mt-4 text-center">
          ${this.emptyState("No regular items yet", 'Define an item like "Morning coffee" or "Bus pass" and start logging.')}
          <button class="btn btn-primary mt-3" onclick="window.__app.openModal('regularItem')">
            <i data-lucide="plus"></i> Add item
          </button>
        </div>` : ""}
    `;
    }
    #renderSummary(state) {
      const home = this.homeCurrency;
      const isHijri = this.#calMode() === "hijri";
      let logs, headerLabel;
      if (isHijri) {
        const h = this.#hijri.toHijri(this.#focus);
        logs = this.#logsForHijriMonth(h.year, h.month, state);
        headerLabel = `${this.#hijri.monthsLong[h.month]} ${h.year} H`;
      } else {
        const focus = /* @__PURE__ */ new Date(this.#focus + "T12:00:00");
        logs = this.#logsForMonth(focus.getFullYear(), focus.getMonth(), state);
        headerLabel = focus.toLocaleDateString(void 0, { month: "long", year: "numeric" });
      }
      const byItem = {};
      logs.forEach((t) => {
        const it = (state.regularItems || []).find((i) => i.id === t.regularItemId);
        if (!it) return;
        byItem[t.regularItemId] = byItem[t.regularItemId] || { item: it, count: 0, qty: 0, total: 0 };
        byItem[t.regularItemId].count += 1;
        byItem[t.regularItemId].qty += Number(t.quantity || 1);
        byItem[t.regularItemId].total += this.convert(t.amount, t.currency, home);
      });
      const rows = Object.values(byItem).sort((a, b) => b.total - a.total);
      const totalSpent = rows.reduce((s, r) => s + r.total, 0);
      const totalCount = logs.length;
      return `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1">
          <button class="btn btn-ghost" onclick="window.__app.shiftCalMonth(-1)"><i data-lucide="chevron-left"></i></button>
          <div class="font-semibold px-1">${this.escapeHtml(headerLabel)}</div>
          <button class="btn btn-ghost" onclick="window.__app.shiftCalMonth(1)"><i data-lucide="chevron-right"></i></button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 md:gap-3 mb-4">
        <div class="card p-3 md:p-4"><div class="text-xs text-zinc-500">Total spent</div><div class="text-lg md:text-xl font-semibold">${this.formatMoney(totalSpent, home)}</div></div>
        <div class="card p-3 md:p-4"><div class="text-xs text-zinc-500">Purchases</div><div class="text-lg md:text-xl font-semibold">${totalCount}</div></div>
        <div class="card p-3 md:p-4"><div class="text-xs text-zinc-500">Avg / purchase</div><div class="text-lg md:text-xl font-semibold">${this.formatMoney(totalCount > 0 ? totalSpent / totalCount : 0, home)}</div></div>
      </div>

      ${rows.length === 0 ? `<div class="card p-6 text-center">${this.emptyState("No purchases this month", "Pick a date on the calendar and log items.")}</div>` : `<div class="card p-5">
             <h3 class="font-semibold mb-3">Item breakdown</h3>
             <div class="overflow-x-auto">
               <table class="w-full text-sm min-w-[420px]">
                 <thead class="text-zinc-500 text-xs uppercase tracking-wider">
                   <tr><th class="text-left py-2">Item</th><th class="text-right py-2">Count</th><th class="text-right py-2">Qty</th><th class="text-right py-2">Total</th><th class="text-right py-2">Avg</th></tr>
                 </thead>
                 <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
                   ${rows.map((r) => `
                     <tr>
                       <td class="py-2">
                         <div class="flex items-center gap-2">
                           <span class="icon-pill" style="background:${r.item.color}22;color:${r.item.color};width:24px;height:24px">
                             <i data-lucide="${r.item.icon}" style="width:13px;height:13px"></i>
                           </span>
                           <span class="truncate">${this.escapeHtml(r.item.name)}</span>
                         </div>
                       </td>
                       <td class="text-right py-2">${r.count}</td>
                       <td class="text-right py-2">${r.qty}</td>
                       <td class="text-right py-2 font-medium">${this.formatMoney(r.total, home)}</td>
                       <td class="text-right py-2 text-zinc-500">${this.formatMoney(r.total / r.count, home)}</td>
                     </tr>`).join("")}
                 </tbody>
               </table>
             </div>
           </div>`}
    `;
    }
    #renderItems(state) {
      const items = state.regularItems || [];
      if (!items.length) {
        return `
        <div class="card p-10 text-center">
          ${this.emptyState("No items yet", "Define your regular purchases here.")}
          <button class="btn btn-primary mt-3" onclick="window.__app.openModal('regularItem')">
            <i data-lucide="plus"></i> Add item
          </button>
        </div>`;
      }
      return `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${items.map((it) => `
          <button class="card p-4 flex items-center gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  onclick="window.__app.openModal('regularItem',{id:'${it.id}'})">
            <div class="icon-pill" style="background:${it.color}22;color:${it.color}">
              <i data-lucide="${it.icon}"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">${this.escapeHtml(it.name)}</div>
              <div class="text-xs text-zinc-500 truncate">${this.formatMoney(it.defaultAmount || 0, it.currency || this.homeCurrency)} default \xB7 ${it.currency || this.homeCurrency}</div>
            </div>
            <i data-lucide="chevron-right" class="text-zinc-400 flex-shrink-0"></i>
          </button>`).join("")}
      </div>`;
    }
    // ── Helpers ───────────────────────────────────────────────────────────
    #calMode() {
      return this.state.user.calendarMode || "both";
    }
    #ensureFocus() {
      if (!this.#focus) this.#focus = this.#isoDate(/* @__PURE__ */ new Date());
    }
    // Local-component ISO (B1): toISOString() is UTC and shifted the calendar grid
    // by a day in non-UTC timezones, mismatching stored local 'YYYY-MM-DD' dates.
    #isoDate(d) {
      return DateService.toIso(d);
    }
    #logsForDate(iso, state) {
      return (state.transactions || []).filter((t) => t.regularItemId && t.date === iso);
    }
    #logsForMonth(year, monthIdx, state) {
      return (state.transactions || []).filter((t) => {
        if (!t.regularItemId) return false;
        const d = /* @__PURE__ */ new Date(t.date + "T12:00:00");
        return d.getFullYear() === year && d.getMonth() === monthIdx;
      });
    }
    #logsForHijriMonth(year, monthIdx, state) {
      return (state.transactions || []).filter((t) => {
        if (!t.regularItemId) return false;
        const h = this.#hijri.toHijri(t.date);
        return h.year === year && h.month === monthIdx;
      });
    }
  };

  // src/ui/views/FamilyView.js
  var ACCOUNT_TYPE_ICONS2 = {
    cash: "wallet",
    bank: "landmark",
    card: "credit-card",
    savings: "landmark",
    invest: "trending-up"
  };
  var ACCESS_LEVELS = {
    owner: { label: "Owner", icon: "shield", color: "#8b5cf6" },
    full: { label: "Full access", icon: "shield-check", color: "#10b981" },
    edit: { label: "Can edit", icon: "pencil", color: "#3b82f6" },
    view: { label: "View only", icon: "eye", color: "#f59e0b" }
  };
  var FamilyView = class extends BaseView {
    constructor() {
      super();
    }
    render() {
      const state = this.state;
      const members = state.family || [];
      const accounts = state.accounts.filter((a) => !a.archived);
      return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-xl font-semibold">Family Sharing</h2>
          <p class="text-sm text-zinc-500 mt-0.5">Share specific accounts with family members and control their access level.</p>
        </div>
        <button class="btn btn-primary" onclick="window.__app.openModal('familyMember',{})">
          <i data-lucide="user-plus"></i> Add member
        </button>
      </div>

      ${members.length === 0 ? this.#emptyMembersCard() : this.#membersGrid(members, accounts)}

      ${this.#inboundSection(state)}
    `;
    }
    // ── Private ───────────────────────────────────────────────────────────
    #emptyMembersCard() {
      return `
      <div class="card flex flex-col items-center justify-center py-16 text-center gap-3">
        <div class="icon-pill w-14 h-14" style="background:#8b5cf622;color:#8b5cf6;border-radius:16px">
          <i data-lucide="users" style="width:28px;height:28px"></i>
        </div>
        <div class="font-medium">No family members yet</div>
        <div class="text-sm text-zinc-500 max-w-xs">Add a family member and choose which accounts they can see \u2014 with exactly the access level you want.</div>
        <button class="btn btn-primary mt-2" onclick="window.__app.openModal('familyMember',{})">
          <i data-lucide="user-plus"></i> Add member
        </button>
      </div>`;
    }
    #membersGrid(members, accounts) {
      return `
      <div class="grid gap-4 sm:grid-cols-2">
        ${members.map((m) => this.#memberCard(m, accounts)).join("")}
      </div>

      <div class="card-muted p-4 mt-6 flex gap-3 items-start">
        <i data-lucide="info" class="text-zinc-400 flex-shrink-0 mt-0.5" style="width:16px;height:16px"></i>
        <div class="text-xs text-zinc-500">
          Use the <strong>Share</strong> button to sync access with each member. Changes to permissions and transactions are reflected automatically once shared.
        </div>
      </div>`;
    }
    #memberCard(m, accounts) {
      const perms = Array.isArray(m.permissions) ? m.permissions : [];
      const sharedAccounts = perms.map((p) => {
        const acc = accounts.find((a) => a.id === p.accountId);
        if (!acc) return null;
        const lvl = ACCESS_LEVELS[p.access] || ACCESS_LEVELS.view;
        return { acc, lvl };
      }).filter(Boolean);
      const initial = m.initials || m.name.slice(0, 2).toUpperCase();
      return `
      <div class="card p-4">
        <div class="flex items-start gap-3 mb-4">
          <div class="w-10 h-10 rounded-full flex-shrink-0 grid place-items-center text-white font-semibold text-sm"
               style="background:${m.color || "#8b5cf6"}">${this.escapeHtml(initial)}</div>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">${this.escapeHtml(m.name)}</div>
            ${m.email ? `<div class="text-xs text-zinc-500 truncate">${this.escapeHtml(m.email)}</div>` : ""}
          </div>
          <button class="btn btn-ghost" onclick="window.__app.openModal('familyMember',{id:'${m.id}'})" title="Edit">
            <i data-lucide="pencil" style="width:15px;height:15px"></i>
          </button>
        </div>

        ${sharedAccounts.length === 0 ? `<div class="text-xs text-zinc-400 italic">No accounts shared yet</div>` : `<div class="space-y-2">
               ${sharedAccounts.map(({ acc, lvl }) => `
                 <div class="flex items-center gap-2">
                   <div class="icon-pill w-7 h-7 rounded-lg flex-shrink-0"
                        style="background:${acc.color || "#e4e4e7"}22;color:${acc.color || "#71717a"}">
                     <i data-lucide="${ACCOUNT_TYPE_ICONS2[acc.type] || "wallet"}" style="width:13px;height:13px"></i>
                   </div>
                   <div class="flex-1 min-w-0">
                     <div class="text-sm truncate">${this.escapeHtml(acc.name)}</div>
                     <div class="text-xs text-zinc-500">${acc.currency}</div>
                   </div>
                   <span class="chip text-xs" style="background:${lvl.color}18;color:${lvl.color}">
                     <i data-lucide="${lvl.icon}" style="width:10px;height:10px;display:inline"></i> ${lvl.label}
                   </span>
                 </div>`).join("")}
             </div>`}

        <div class="flex gap-2 mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <button class="btn btn-outline flex-1 justify-center text-xs text-rose-500"
                  onclick="window.__app.deleteFamilyMember('${m.id}')">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i> Remove
          </button>
        </div>
      </div>`;
    }
    #inboundSection(state) {
      const sharedData = state._sharedData || [];
      if (!sharedData.length) return "";
      const cards = sharedData.map((share, shareIndex) => {
        const sharedAccs = (share.accounts || []).map((a) => {
          const perm = (share.permission || {})[a.id] || "view";
          const lvl = ACCESS_LEVELS[perm] || ACCESS_LEVELS.view;
          return { a, lvl };
        });
        if (!sharedAccs.length) return "";
        const initial = (share.sharedBy || "?").slice(0, 2).toUpperCase();
        return `
        <div class="card p-4">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-8 h-8 rounded-full grid place-items-center text-white font-semibold text-xs flex-shrink-0"
                 style="background:#818cf8">${this.escapeHtml(initial)}</div>
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm truncate">${this.escapeHtml(share.sharedBy || "Family member")}</div>
              <div class="text-xs text-zinc-500">Sharing ${sharedAccs.length} account${sharedAccs.length > 1 ? "s" : ""} with you</div>
            </div>
          </div>
          <div class="space-y-2">
            ${sharedAccs.map(({ a, lvl }) => `
              <div class="flex items-center gap-2 cursor-pointer hover:opacity-80"
                   onclick="window.__app.openAccountDetail('${a.id}',{shareIndex:${shareIndex}})">
                <div class="icon-pill w-7 h-7 rounded-lg flex-shrink-0"
                     style="background:${a.color || "#818cf8"}22;color:${a.color || "#818cf8"}">
                  <i data-lucide="${a.icon || "wallet"}" style="width:13px;height:13px"></i>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm truncate font-medium">${this.escapeHtml(a.name)}</div>
                  <div class="text-xs text-zinc-500">${a.currency} \xB7 ${this.formatMoney(a.balance, a.currency)}</div>
                </div>
                <span class="chip text-xs" style="background:${lvl.color}18;color:${lvl.color}">
                  <i data-lucide="${lvl.icon}" style="width:10px;height:10px;display:inline"></i> ${lvl.label}
                </span>
              </div>`).join("")}
          </div>
        </div>`;
      }).filter(Boolean).join("");
      if (!cards) return "";
      return `
      <div class="mt-8">
        <div class="flex items-center gap-2 mb-3">
          <i data-lucide="users" style="width:15px;height:15px;color:#818cf8"></i>
          <h3 class="text-sm font-semibold uppercase tracking-wider text-zinc-500">Shared with me</h3>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">${cards}</div>
      </div>`;
    }
  };

  // src/ui/components/CategoryOptionRenderer.js
  var CategoryOptionRenderer = class _CategoryOptionRenderer {
    /**
     * Build <option> / <optgroup> HTML for a category <select>.
     *
     * @param {object[]}      allCats    Full category list (unfiltered).
     * @param {string|null}   selectedId Currently-selected category ID (or null).
     * @param {string|null}   typeFilter 'expense' | 'income' | 'transfer' | null (no filter).
     * @returns {string}  HTML fragment — insert after a blank "Uncategorised" <option>.
     */
    static render(allCats, selectedId, typeFilter = null) {
      const matchType = (c) => !typeFilter || c.type === typeFilter;
      const esc = _CategoryOptionRenderer.#esc;
      const sel = (id) => id === selectedId ? "selected" : "";
      const renderedChildIds = /* @__PURE__ */ new Set();
      const roots = allCats.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
      const grouped = roots.map((root) => {
        const children = allCats.filter((c) => c.parentId === root.id && matchType(c)).sort((a, b) => a.name.localeCompare(b.name));
        if (children.length > 0) {
          children.forEach((c) => renderedChildIds.add(c.id));
          return `<optgroup label="${esc(root.name)}">${children.map((c) => `<option value="${c.id}" ${sel(c.id)}>${esc(c.name)}</option>`).join("")}</optgroup>`;
        }
        if (matchType(root)) {
          return `<option value="${root.id}" ${sel(root.id)}>${esc(root.name)}</option>`;
        }
        return "";
      }).filter(Boolean).join("");
      const orphans = allCats.filter((c) => c.parentId && matchType(c) && !renderedChildIds.has(c.id)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${c.id}" ${sel(c.id)}>${esc(c.name)}</option>`).join("");
      return grouped + orphans;
    }
    /**
     * Build a flat, indented option list that mirrors the parent → child
     * hierarchy while keeping BOTH parents and children selectable.
     *
     * Unlike render() (which uses <optgroup>, whose labels are not selectable),
     * this is used where a parent category itself is a valid choice — e.g. a
     * budget that should cover a whole category including its sub-categories.
     *
     *   Food & Drink            ← selectable parent
     *      ↳ Coffee             ← selectable, indented child
     *      ↳ Groceries
     *   Transport
     *
     * @param {object[]}    allCats    Full category list (unfiltered).
     * @param {string|null} selectedId Currently-selected category ID (or null).
     * @param {string|null} typeFilter 'expense' | 'income' | 'transfer' | null.
     * @returns {string} HTML fragment of <option> elements.
     */
    static renderHierarchical(allCats, selectedId, typeFilter = null) {
      const matchType = (c) => !typeFilter || c.type === typeFilter;
      const esc = _CategoryOptionRenderer.#esc;
      const sel = (id) => id === selectedId ? "selected" : "";
      const childPrefix = "\xA0\xA0\xA0\u21B3\xA0";
      const rendered = /* @__PURE__ */ new Set();
      const roots = allCats.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
      let html = "";
      for (const root of roots) {
        const children = allCats.filter((c) => c.parentId === root.id && matchType(c)).sort((a, b) => a.name.localeCompare(b.name));
        if (!matchType(root) && children.length === 0) continue;
        if (matchType(root)) {
          html += `<option value="${root.id}" ${sel(root.id)}>${esc(root.name)}</option>`;
        }
        for (const c of children) {
          rendered.add(c.id);
          html += `<option value="${c.id}" ${sel(c.id)}>${childPrefix}${esc(c.name)}</option>`;
        }
      }
      const orphans = allCats.filter((c) => c.parentId && matchType(c) && !rendered.has(c.id)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${c.id}" ${sel(c.id)}>${esc(c.name)}</option>`).join("");
      return html + orphans;
    }
    /**
     * Build an indented checkbox tree for selecting MULTIPLE categories (e.g. a
     * budget that spans several sub-categories). Parents and children both get a
     * checkbox; children are indented under their parent.
     *
     * @param {object[]}        allCats     Full category list (unfiltered).
     * @param {string[]|Set}    selectedIds Currently-checked category IDs.
     * @param {string|null}     typeFilter  'expense' | 'income' | 'transfer' | null.
     * @param {string}          name        Checkbox group name (FormData key).
     * @returns {string} HTML fragment of <label><input type="checkbox"> rows.
     */
    static renderCheckboxTree(allCats, selectedIds = [], typeFilter = null, name = "categoryIds") {
      const set = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
      const matchType = (c) => !typeFilter || c.type === typeFilter;
      const esc = _CategoryOptionRenderer.#esc;
      const row = (c, indent) => `
      <label class="flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/60 ${indent ? "pl-7" : ""}">
        <input type="checkbox" name="${name}" value="${c.id}" ${set.has(c.id) ? "checked" : ""} class="accent-zinc-900 dark:accent-white">
        <span class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${c.color || "#a1a1aa"}"></span>
        <span class="text-sm ${indent ? "text-zinc-600 dark:text-zinc-300" : "font-medium"}">${indent ? "\u21B3 " : ""}${esc(c.name)}</span>
      </label>`;
      const roots = allCats.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
      const rendered = /* @__PURE__ */ new Set();
      let html = "";
      for (const root of roots) {
        const children = allCats.filter((c) => c.parentId === root.id && matchType(c)).sort((a, b) => a.name.localeCompare(b.name));
        if (!matchType(root) && children.length === 0) continue;
        if (matchType(root)) html += row(root, false);
        for (const c of children) {
          rendered.add(c.id);
          html += row(c, true);
        }
      }
      const orphans = allCats.filter((c) => c.parentId && matchType(c) && !rendered.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
      for (const c of orphans) html += row(c, false);
      return html || '<div class="text-xs text-zinc-500 py-2 px-2">No matching categories yet.</div>';
    }
    // ── Private ─────────────────────────────────────────────────────────────
    static #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/TransactionModal.js
  var DEFAULT_PAYMENT_TYPES = ["card", "cash", "bank-transfer", "cheque", "crypto", "other"];
  var TransactionModal = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    /** @type {HijriCalendarService} */
    #hijri;
    // Per-open instance state
    #splits = [];
    #splitsEnabled = false;
    #sharedTxMode = null;
    // { shareIndex, accountId, editTxId? } | null
    #currentType = null;
    // overrides data.type when user switches tabs
    #splitsSeeded = false;
    // true after initial seed; prevents re-seed on refresh
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
      this.#hijri = new HijriCalendarService();
    }
    // ── Public API (called by app.js) ────────────────────────────────────
    /** @returns {Array} current split rows */
    get splits() {
      return this.#splits;
    }
    /** @returns {boolean} */
    get splitsEnabled() {
      return this.#splitsEnabled;
    }
    setType(type) {
      this.#currentType = type;
    }
    /** @returns {{shareIndex:number, accountId:string, editTxId?:string}|null} */
    get sharedTxMode() {
      return this.#sharedTxMode;
    }
    toggleSplits() {
      this.#splitsEnabled = !this.#splitsEnabled;
      if (this.#splitsEnabled && this.#splits.length === 0) {
        const accId = document.querySelector("[name=accountId]")?.value || this.#store.getState().accounts[0]?.id || null;
        this.#splits.push(
          { categoryId: null, accountId: accId, amount: 0 },
          { categoryId: null, accountId: accId, amount: 0 }
        );
      }
      if (!this.#splitsEnabled) this.#splits = [];
    }
    addSplit(defaultAccountId = null) {
      const accId = this.#splits[this.#splits.length - 1]?.accountId || defaultAccountId || this.#store.getState().accounts[0]?.id || null;
      this.#splits.push({ categoryId: null, accountId: accId, amount: 0 });
    }
    removeSplit(i) {
      this.#splits.splice(i, 1);
      if (this.#splits.length === 0) this.#splitsEnabled = false;
    }
    setSplitField(i, field, val) {
      if (this.#splits[i]) this.#splits[i][field] = val;
    }
    setSplitAmount(i, val, currency) {
      if (this.#splits[i]) {
        this.#splits[i].amount = this.#fx.toMinor(Number(val) || 0, currency);
      }
    }
    // ── Modal strategy contract ───────────────────────────────────────────
    render(opts = {}) {
      const { id, prefill, sharedTxMode } = opts;
      const state = this.#store.getState();
      this.#sharedTxMode = sharedTxMode || null;
      const sharedEditTx = sharedTxMode?.editTxId ? (state._sharedData?.[sharedTxMode.shareIndex]?.transactions || []).find((t) => t.id === sharedTxMode.editTxId) : null;
      const editing = id ? state.transactions.find((t) => t.id === id) : null;
      const data = editing ? { ...editing } : sharedEditTx ? { ...sharedEditTx } : prefill || {
        type: "expense",
        amount: 0,
        currency: state.user.defaultCurrency || state.user.homeCurrency,
        accountId: state.accounts[0]?.id,
        categoryId: "",
        payee: "",
        note: "",
        date: DateService.todayIso(),
        paymentType: "card",
        transferToAccountId: ""
      };
      if (editing?.type === "transfer" && editing.transferPairId) {
        const pair = state.transactions.find((t) => t.id === editing.transferPairId);
        if (pair) {
          data.transferToAccountId = pair.accountId;
          if (!data.transferRate && editing.currency !== pair.currency && editing.amount && pair.amount) {
            const storedRate = this.#fx.fromMinor(pair.amount, pair.currency) / this.#fx.fromMinor(editing.amount, editing.currency);
            data.transferRate = storedRate;
          }
        }
      }
      if (editing && editing.type !== "transfer" && !data.txFxRate && Number.isFinite(editing.acctMinor) && editing.amount) {
        const acc = state.accounts.find((a) => a.id === editing.accountId);
        if (acc && acc.currency !== editing.currency) {
          data.txFxRate = this.#fx.fromMinor(editing.acctMinor, acc.currency) / this.#fx.fromMinor(editing.amount, editing.currency);
        }
      }
      if (!this.#splitsSeeded) {
        this.#splits = editing && Array.isArray(editing.splits) ? editing.splits.map((s) => ({ ...s })) : prefill && Array.isArray(prefill?.splits) ? prefill.splits.map((s) => ({ ...s })) : [];
        this.#splitsEnabled = this.#splits.length > 0;
        this.#splitsSeeded = true;
      }
      const type = this.#currentType || data.type || "expense";
      const amountValue = editing || sharedEditTx ? this.#fx.fromMinor(data.amount, data.currency) : data.amount ? this.#fx.fromMinor(data.amount, data.currency) : 0;
      const cats = state.categories;
      const isSharedMode = !!this.#sharedTxMode;
      const sharedAccObj = isSharedMode ? (state._sharedData?.[this.#sharedTxMode.shareIndex]?.accounts || []).find((a) => a.id === this.#sharedTxMode.accountId) : null;
      const sharedPerm = isSharedMode ? (state._sharedData?.[this.#sharedTxMode.shareIndex]?.permission || {})[this.#sharedTxMode.accountId] : null;
      const canDeleteShared = isSharedMode && sharedEditTx && ["full", "edit", "owner"].includes(sharedPerm);
      const todayH = this.#hijri.toHijri(data.date);
      const miqaat = this.#hijri.topMiqaat(this.#hijri.miqaatsForGregorian(data.date));
      const hijriLabel = this.#hijri.format(data.date, { long: true });
      const hijriPreview = `${hijriLabel}${miqaat ? ` \xB7 <span class="text-amber-600">${this.#esc(miqaat.t)}</span>` : ""}`;
      const paymentTypeOptions = (window.__app?.paymentTypeService?.allTypes() || DEFAULT_PAYMENT_TYPES).map((p) => {
        const sel = (data.paymentType || "card") === p ? "selected" : "";
        const label = p.charAt(0).toUpperCase() + p.slice(1);
        return '<option value="' + p + '" ' + sel + ">" + label + "</option>";
      }).join("");
      return `
      <form id="txForm" onsubmit="window.__app.submitTx(event,'${editing?.id || ""}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing || sharedEditTx ? "Edit transaction" : "New transaction"}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div class="grid grid-cols-3 gap-2 mb-4">
          ${["expense", "income", "transfer"].map((t) => `
            <button type="button" onclick="window.__app.setTxType('${t}')"
                    class="btn ${type === t ? "btn-primary" : "btn-outline"} justify-center">
              ${t.charAt(0).toUpperCase() + t.slice(1)}
            </button>`).join("")}
        </div>
        <input type="hidden" name="type" value="${type}">

        <div class="card-muted p-3 mb-3">
          <div class="text-xs text-zinc-500 mb-1">Amount</div>
          <div class="flex gap-2 items-center">
            <input class="input text-2xl font-semibold border-0 bg-transparent p-0 focus:ring-0"
                   style="border:none" name="amount" type="number" step="0.01" required
                   value="${amountValue || ""}" placeholder="0.00" autofocus
                   oninput="window.__app.onTxFormChange()">
            ${isSharedMode ? `<input type="hidden" name="currency" value="${data.currency}">
                 <span class="text-sm font-medium text-zinc-600 dark:text-zinc-400 px-2">${data.currency}</span>` : `<select class="select w-24" name="currency" onchange="window.__app.onTxCurrencyChange()">
                   ${CURRENCIES.map((c) => `<option value="${c}" ${data.currency === c ? "selected" : ""}>${this.#fx.label(c).split("\u2014")[0].trim()}</option>`).join("")}
                 </select>`}
          </div>
        </div>

        ${type === "transfer" ? this.#transferFields(data, state) : ""}
        ${type !== "transfer" && this.#splitsEnabled ? this.#splitsArea(data, cats, type, state.accounts, amountValue) : ""}
        ${type !== "transfer" && !this.#splitsEnabled ? this.#accountCategoryFields(data, state, cats, type, isSharedMode) : ""}

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Date</label>
            <input class="input" type="date" name="date" value="${data.date}"
                   oninput="window.__app.updateHijriPreview(this.value)">
            <div id="hijriDatePreview" class="text-xs text-zinc-500 mt-1">${hijriPreview}</div>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Payment</label>
            <select class="select" name="paymentType"
              onchange="window.__app?.addCustomPaymentType?.(this)"
              data-prev="${data.paymentType || "card"}">
              ${paymentTypeOptions}
              <option value="__add_payment__">\uFF0B Add custom\u2026</option>
            </select>
          </div>
        </div>

        ${type !== "transfer" ? this.#recurringSection(data) : ""}

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Payee / merchant</label>
          <input class="input" name="payee" value="${this.#esc(data.payee || "")}"
                 oninput="window.__app.suggestCategory(this.value)"
                 placeholder="e.g. Whole Foods">
          <div id="catSuggest" class="text-xs text-emerald-600 mt-1"></div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Note</label>
          <textarea class="textarea" name="note" rows="2" placeholder="optional...">${this.#esc(data.note || "")}</textarea>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Receipt (optional)</label>
          <label class="card-muted flex items-center gap-3 p-3 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl">
            <div class="icon-pill" style="background:#8b5cf622;color:#8b5cf6;flex-shrink:0"><i data-lucide="scan-line"></i></div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium scan-label-text">${state.user.geminiApiKey ? "Scan receipt with Gemini AI" : "Scan receipt with AI"}</div>
              <div class="text-xs text-zinc-500">${state.user.geminiApiKey ? "Reads items \xB7 assigns your categories \xB7 pre-fills splits" : "Add free Google AI key in Settings to enable"}</div>
            </div>
            <input type="file" accept="image/*,application/pdf" class="hidden" onchange="window.__app.scanReceipt(this)">
            <i data-lucide="chevron-right" class="text-zinc-400" style="flex-shrink:0"></i>
          </label>
        </div>

        ${editing?.createdAt ? `<div class="text-xs text-zinc-400 mb-3">Entered ${new Date(editing.createdAt).toLocaleString()}${editing.addedBy ? ` by ${this.#esc(editing.addedBy)}` : ""}</div>` : ""}

        <div class="flex items-center gap-2">
          ${editing ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteTx('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>` : canDeleteShared ? `<button type="button" class="btn btn-outline text-rose-500"
                         onclick="window.__app.deleteSharedTxContrib(${this.#sharedTxMode.shareIndex},'${sharedEditTx.id}')">
                   <i data-lucide="trash-2"></i> Delete
                 </button>` : ""}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
    }
    onOpen(opts, card) {
      this.#currentType = null;
      this.#splits = [];
      this.#splitsEnabled = false;
      this.#splitsSeeded = false;
      const data = opts?.prefill || {};
      if (data.type === "transfer") {
        setTimeout(() => window.__app?.updateTransferFxPanel?.(false), 0);
      }
      setTimeout(() => window.__app?.updateTxFxPanel?.(false), 0);
    }
    // ── Private render helpers ────────────────────────────────────────────
    #transferFields(data, state) {
      return `
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="text-xs text-zinc-500">Account</label>
          <select class="select" name="accountId" onchange="window.__app.updateTransferFxPanel(false)">
            ${state.accounts.map((a) => `<option value="${a.id}" ${data.accountId === a.id ? "selected" : ""}>${this.#esc(a.name)} \xB7 ${a.currency}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="text-xs text-zinc-500">To account</label>
          <select class="select" name="transferToAccountId" onchange="window.__app.updateTransferFxPanel(false)">
            ${state.accounts.map((a) => `<option value="${a.id}" ${data.transferToAccountId === a.id ? "selected" : ""}>${this.#esc(a.name)} \xB7 ${a.currency}</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="fxPanel" class="card-muted p-3 mb-3" style="display:none">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs text-zinc-500 uppercase tracking-wider">Exchange rate</div>
          <button type="button" class="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  onclick="window.__app.resetTransferFx()" title="Reset to auto rate">
            <i data-lucide="refresh-cw" style="width:11px;height:11px;display:inline"></i> Use auto
          </button>
        </div>
        <div class="flex items-center gap-2 mb-2 text-sm">
          <span>1 <span id="fxFromCcy" class="font-medium"></span> =</span>
          <input class="input flex-1 max-w-[140px]" type="number" step="any" min="0"
                 name="transferRate" id="fxRate"
                 value="${data.transferRate ? Number(data.transferRate).toFixed(6) : ""}"
                 oninput="window.__app.updateTransferFxPanel(true)" placeholder="0.00">
          <span class="font-medium" id="fxToCcy"></span>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs text-zinc-500">You'll receive</div>
            <div class="text-lg font-semibold" id="fxToAmount">\u2014</div>
          </div>
          <div class="text-xs text-zinc-400 text-right max-w-[55%]" id="fxRateNote"></div>
        </div>
      </div>`;
    }
    #accountCategoryFields(data, state, cats, type, isSharedMode) {
      const sharedOpts = (state._sharedData || []).flatMap(
        (share) => (share.accounts || []).filter((a) => (share.permission || {})[a.id] !== "view").map((a) => `<option value="${a.id}" ${data.accountId === a.id ? "selected" : ""}>${this.#esc(a.name)} (shared)</option>`)
      ).join("");
      const sharedAccName = isSharedMode ? (state._sharedData?.[this.#sharedTxMode.shareIndex]?.accounts || []).find((a) => a.id === this.#sharedTxMode.accountId)?.name || "Shared account" : null;
      const accountSelect = isSharedMode ? `<input type="hidden" name="accountId" value="${this.#sharedTxMode.accountId}">
         <div class="select flex items-center gap-2 text-zinc-500" style="cursor:default">
           <i data-lucide="lock" style="width:13px;height:13px;flex-shrink:0"></i>
           <span class="truncate">${this.#esc(sharedAccName)}</span>
         </div>` : `<select class="select" name="accountId" onchange="window.__app.onTxAccountChange(this.value)">
           <optgroup label="My accounts">
             ${state.accounts.map((a) => `<option value="${a.id}" ${data.accountId === a.id ? "selected" : ""}>${this.#esc(a.name)}</option>`).join("")}
           </optgroup>
           ${sharedOpts ? `<optgroup label="Shared with me">${sharedOpts}</optgroup>` : ""}
         </select>`;
      const filteredCats = cats.filter((c) => c.type === type);
      return `
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div><label class="text-xs text-zinc-500">Account</label>${accountSelect}</div>
        <div>
          <div class="flex items-center justify-between">
            <label class="text-xs text-zinc-500">Category</label>
            <button type="button" onclick="window.__app.toggleSplits()"
                    class="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              <i data-lucide="split" style="width:11px;height:11px;display:inline"></i> Split
            </button>
          </div>
          <select class="select" name="categoryId">
            <option value="">\u2014 Uncategorised \u2014</option>
            ${CategoryOptionRenderer.render(cats, data.categoryId, type)}
          </select>
        </div>
      </div>

      <!-- FX panel: shown only when the transaction currency differs from the
           account currency (e.g. a USD expense on a KES account). Mirrors the
           transfer FX panel. -->
      <div id="fxTxPanel" class="card-muted p-3 mb-3" style="display:none">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs text-zinc-500 uppercase tracking-wider">Exchange rate</div>
          <button type="button" class="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  onclick="window.__app.resetTxFx()" title="Reset to auto rate">
            <i data-lucide="refresh-cw" style="width:11px;height:11px;display:inline"></i> Use auto
          </button>
        </div>
        <div class="flex items-center gap-2 mb-2 text-sm">
          <span>1 <span id="fxTxFromCcy" class="font-medium"></span> =</span>
          <input class="input flex-1 max-w-[140px]" type="number" step="any" min="0"
                 name="txFxRate" id="fxTxRate"
                 value="${data.txFxRate ? Number(data.txFxRate).toFixed(6) : ""}"
                 oninput="window.__app.updateTxFxPanel(true)" placeholder="0.00">
          <span class="font-medium" id="fxTxToCcy"></span>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs text-zinc-500">Booked to account</div>
            <div class="text-lg font-semibold" id="fxTxToAmount">\u2014</div>
          </div>
          <div class="text-xs text-zinc-400 text-right max-w-[55%]" id="fxTxRateNote"></div>
        </div>
      </div>`;
    }
    #splitsArea(data, cats, type, accounts = [], totalMajor = 0) {
      const filteredCats = cats.filter((c) => c.type === type);
      const currency = data.currency || "USD";
      const splitSum = this.#splits.reduce((s, sp) => s + this.#fx.fromMinor(sp.amount || 0, currency), 0);
      const diff = totalMajor - splitSum;
      const diffAbs = Math.abs(diff);
      const diffFmt = this.#fx.formatMoney(this.#fx.toMinor(diffAbs, currency), currency);
      let diffHtml = "";
      if (Math.abs(diff) >= 5e-3) {
        const over = diff < 0;
        const color = over ? "text-rose-500" : "text-amber-500";
        const label = over ? `<span class="${color} font-medium">${diffFmt} over</span>` : `<span class="${color} font-medium">${diffFmt} remaining</span>`;
        diffHtml = `<div class="flex items-center gap-1 text-xs mt-1">${label}</div>`;
      } else {
        diffHtml = `<div class="flex items-center gap-1 text-xs mt-1 text-emerald-500"><i data-lucide="check" style="width:11px;height:11px"></i> Splits match total</div>`;
      }
      const sumFmt = this.#fx.formatMoney(this.#fx.toMinor(splitSum, currency), currency);
      const totalFmt = this.#fx.formatMoney(this.#fx.toMinor(totalMajor, currency), currency);
      return `
      <input type="hidden" name="accountId" value="${data.accountId || ""}">
      <div class="mb-3">
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-zinc-500 uppercase tracking-wider">Split entries</label>
          <button type="button" onclick="window.__app.toggleSplits()"
                  class="text-xs text-rose-500 hover:text-rose-700">
            <i data-lucide="x" style="width:11px;height:11px;display:inline"></i> Remove splits
          </button>
        </div>

        <!-- Total vs split sum tracker \u2014 id="splitTotalBar" patched by updateSplitTotal() -->
        <div id="splitTotalBar" class="card-muted rounded-xl px-3 py-2 mb-2 flex items-center justify-between">
          <div class="text-xs text-zinc-500">Split total</div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold">${sumFmt}</span>
            <span class="text-xs text-zinc-400">of</span>
            <span class="text-sm font-semibold">${totalFmt}</span>
          </div>
        </div>
        <div id="splitDiffLine">${diffHtml}</div>

        <div id="splitsContainer" class="space-y-2 mt-2">
          ${this.#splits.map((s, i) => this.#splitRow(s, i, filteredCats, currency, accounts, data.accountId)).join("")}
        </div>
        <button type="button" onclick="window.__app.addSplit('${this.#esc(data.accountId || "")}')"
                class="btn btn-ghost text-xs mt-2 w-full border border-dashed border-zinc-300 dark:border-zinc-700">
          <i data-lucide="plus" style="width:13px;height:13px"></i> Add split
        </button>
      </div>`;
    }
    /**
     * Render one split row.
     * Uses CategoryOptionRenderer for proper optgroup hierarchy + orphan rescue.
     * The oninput on the amount field calls updateSplitTotal() — a lightweight
     * DOM patch — instead of a full modal refresh, so focus is never lost.
     */
    #splitRow(s, i, cats, currency, accounts = [], defaultAccountId = null) {
      const accId = s.accountId || defaultAccountId || "";
      return `
      <div class="card-muted rounded-xl p-2 space-y-1.5">
        <div class="flex gap-2">
          <select class="select text-sm flex-1" name="split_cat_${i}"
                  onchange="window.__app.setSplitField(${i},'categoryId',this.value)">
            <option value="">\u2014 Uncategorised \u2014</option>
            ${CategoryOptionRenderer.render(cats, s.categoryId, null)}
          </select>
          <button type="button" onclick="window.__app.removeSplit(${i})"
                  class="btn btn-ghost text-rose-500 flex-shrink-0 px-2">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i>
          </button>
        </div>
        <div class="flex gap-2">
          <select class="select text-sm flex-1" name="split_acc_${i}"
                  onchange="window.__app.setSplitField(${i},'accountId',this.value)">
            ${accounts.map((a) => `<option value="${a.id}" ${accId === a.id ? "selected" : ""}>${this.#esc(a.name)}</option>`).join("")}
          </select>
          <input class="input text-sm w-28 flex-shrink-0" type="number" step="0.01" placeholder="0.00"
                 name="split_amt_${i}"
                 value="${s.amount ? this.#fx.fromMinor(s.amount, currency) : ""}"
                 oninput="window.__app.setSplitAmount(${i},this.value,'${currency}');window.__app.updateSplitTotal()">
        </div>
      </div>`;
    }
    #recurringSection(data) {
      const hasRecurring = !!data.recurring;
      return `
      <div class="card-muted p-3 mb-3">
        <label class="flex items-center gap-2 text-sm cursor-pointer ${hasRecurring ? "mb-2" : ""}">
          <input type="checkbox" name="recurringEnabled" ${hasRecurring ? "checked" : ""}
                 onchange="window.__app.toggleRecurringFields(this.checked)">
          <i data-lucide="repeat" style="width:13px;height:13px"></i>
          <span class="font-medium">Repeat automatically</span>
        </label>
        <div id="recurringFields" class="${hasRecurring ? "" : "hidden"}">
          <div class="grid grid-cols-3 gap-2 mb-1">
            <select class="select" name="recurringRule">
              ${["daily", "weekly", "monthly", "yearly"].map((r) => `<option value="${r}" ${data.recurring?.rule === r ? "selected" : ""}>${r}</option>`).join("")}
            </select>
            <input class="input" type="number" name="recurringInterval" min="1" step="1"
                   value="${data.recurring?.interval || 1}" title="Every N units">
            <input class="input" type="date" name="recurringUntil"
                   value="${data.recurring?.until || ""}" title="Until (optional)">
          </div>
          <div class="text-xs text-zinc-500">Interval + optional end date. Instances are generated on each app load.</div>
        </div>
      </div>`;
    }
    // Category options are now rendered by CategoryOptionRenderer.render() —
    // the static class provides optgroup hierarchy and orphan rescue in one place.
    #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/AccountModal.js
  var AccountModal = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
    }
    render(opts = {}) {
      const { id } = opts;
      const state = this.#store.getState();
      const editing = id ? state.accounts.find((a2) => a2.id === id) : null;
      const a = editing || {
        name: "",
        type: "bank",
        currency: state.user.defaultCurrency || state.user.homeCurrency,
        balance: 0,
        color: "#0ea5e9",
        icon: "landmark",
        archived: false
      };
      const balanceDisplay = editing ? this.#fx.fromMinor(a.balance, a.currency) : 0;
      const groups = state.accountGroups || [];
      return `
      <form onsubmit="window.__app.submitAccount(event,'${editing?.id || ""}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? "Edit account" : "New account"}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Name</label>
          <input class="input" name="name" required value="${this.#esc(a.name)}" autofocus>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Type</label>
            <select class="select" name="type">
              ${ACCOUNT_TYPES.map((t) => `<option value="${t.id}" ${a.type === t.id ? "selected" : ""}>${t.label}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency">
              ${CURRENCIES.map((c) => `<option value="${c}" ${a.currency === c ? "selected" : ""}>${this.#fx.label(c)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-1">
          <div>
            <label class="text-xs text-zinc-500">${editing ? "Current balance" : "Starting balance"}</label>
            <input class="input" name="balance" type="number" step="0.01" value="${balanceDisplay}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Colour</label>
            <input class="input h-10 p-1" type="color" name="color" value="${a.color}">
          </div>
        </div>
        <div class="text-xs text-zinc-400 mb-3">
          <i data-lucide="info" style="width:11px;height:11px;display:inline"></i>
          ${editing ? "Changing the balance writes a <b>Balance adjustment</b> transaction. Delete that entry to restore the previous balance." : "A non-zero starting balance is recorded as an <b>Opening balance</b> transaction in the ledger."}
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Group</label>
          <select class="select" name="groupId" id="accGroupSelect"
                  onchange="window.__app.onAccGroupChange(this)">
            <option value="" ${!a.groupId ? "selected" : ""}>(None)</option>
            ${groups.map((g) => `<option value="${g.id}" ${a.groupId === g.id ? "selected" : ""}>${this.#esc(g.name)}</option>`).join("")}
            <option value="__new__">+ New group\u2026</option>
          </select>
          <input class="input mt-2 hidden" name="newGroupName" id="accNewGroupName"
                 placeholder="New group name (e.g. Personal, Family, Business)">
        </div>

        <div class="flex items-center gap-2 mb-4">
          <input type="checkbox" name="archived" id="archChk" ${a.archived ? "checked" : ""}>
          <label for="archChk" class="text-sm">Archived</label>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteAccount('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>` : ""}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
    }
    #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/CategoryModal.js
  var ICONS = [
    "tag",
    "utensils",
    "car",
    "shopping-bag",
    "heart-pulse",
    "home",
    "film",
    "receipt",
    "graduation-cap",
    "banknote",
    "briefcase",
    "landmark",
    "plane",
    "dumbbell",
    "gift",
    "baby",
    "paw-print",
    "wifi"
  ];
  var CategoryModal = class {
    /** @type {Store} */
    #store;
    constructor() {
      this.#store = Store.getInstance();
    }
    render(opts = {}) {
      const { id } = opts;
      const state = this.#store.getState();
      const editing = id ? state.categories.find((c2) => c2.id === id) : null;
      const c = editing || { name: "", icon: "tag", color: "#3b82f6", type: "expense", parentId: null };
      return `
      <form onsubmit="window.__app.submitCategory(event,'${editing?.id || ""}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? "Edit category" : "New category"}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Name</label>
          <input class="input" name="name" required value="${this.#esc(c.name)}" autofocus>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Type</label>
            <select class="select" name="type">
              ${["expense", "income", "transfer"].map((t) => `<option ${c.type === t ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Colour</label>
            <input class="input h-10 p-1" type="color" name="color" value="${c.color}">
          </div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Parent (optional)</label>
          <select class="select" name="parentId">
            <option value="">\u2014 None (root category) \u2014</option>
            ${state.categories.filter((p) => p.type === c.type && !p.parentId && p.id !== editing?.id).map((p) => `<option value="${p.id}" ${c.parentId === p.id ? "selected" : ""}>${this.#esc(p.name)}</option>`).join("")}
          </select>
          <div class="text-xs text-zinc-500 mt-1">Up to one level deep. A budget on a parent category includes all its sub-categories.</div>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Icon</label>
          <div class="grid grid-cols-9 gap-2 mt-1">
            ${ICONS.map((ic) => `
              <label class="cursor-pointer">
                <input type="radio" name="icon" value="${ic}" ${c.icon === ic ? "checked" : ""} class="peer sr-only">
                <span class="icon-pill bg-zinc-100 dark:bg-zinc-800 peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900">
                  <i data-lucide="${ic}"></i>
                </span>
              </label>`).join("")}
          </div>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteCategory('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>` : ""}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
    }
    #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/BudgetModal.js
  var BudgetModal = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
    }
    render(opts = {}) {
      const { id } = opts;
      const state = this.#store.getState();
      const editing = id ? state.budgets.find((b2) => b2.id === id) : null;
      const b = editing || {
        categoryIds: [],
        amount: 0,
        currency: state.user.defaultCurrency || state.user.homeCurrency,
        period: "gregorian",
        rollover: false
      };
      const amount = editing ? this.#fx.fromMinor(b.amount, b.currency) : 0;
      const isHijri = b.period === "hijri";
      const selectedIds = Array.isArray(b.categoryIds) && b.categoryIds.length ? b.categoryIds : b.categoryId ? [b.categoryId] : [];
      return `
      <form onsubmit="window.__app.submitBudget(event,'${editing?.id || ""}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? "Edit budget" : "New budget"}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500 mb-1 block">Categories</label>
          <div class="card-muted p-2 max-h-52 overflow-y-auto">
            ${CategoryOptionRenderer.renderCheckboxTree(state.categories, selectedIds, "expense", "categoryIds")}
          </div>
          <div class="text-xs text-zinc-500 mt-1">Tick a parent to budget the whole group (sub-categories included), or tick specific sub-categories \u2014 e.g. just two of them.</div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500 mb-1 block">Period</label>
          <div class="grid grid-cols-2 gap-2">
            <label class="cursor-pointer">
              <input type="radio" name="period" value="gregorian" ${!isHijri ? "checked" : ""} class="peer sr-only">
              <div class="btn btn-outline justify-center peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900 peer-checked:border-transparent w-full">
                <i data-lucide="calendar"></i> Gregorian month
              </div>
            </label>
            <label class="cursor-pointer">
              <input type="radio" name="period" value="hijri" ${isHijri ? "checked" : ""} class="peer sr-only">
              <div class="btn btn-outline justify-center peer-checked:bg-zinc-900 peer-checked:text-white dark:peer-checked:bg-white dark:peer-checked:text-zinc-900 peer-checked:border-transparent w-full">
                <i data-lucide="moon-star"></i> Hijri month
              </div>
            </label>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Limit</label>
            <input class="input" name="amount" type="number" step="0.01" required value="${amount}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency">
              ${CURRENCIES.map((c) => `<option value="${c}" ${b.currency === c ? "selected" : ""}>${this.#fx.label(c)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="mb-4">
          <label class="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="rollover" ${b.rollover ? "checked" : ""}>
            <span>Roll over unspent budget to next month</span>
          </label>
          <div class="text-xs text-zinc-500 mt-1">When enabled, any remaining amount carries forward as a bonus allowance.</div>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteBudget('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>` : ""}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
    }
    #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/SettingsModal.js
  var SettingsModal = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    /** @type {HijriCalendarService} */
    #hijri;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
      this.#hijri = new HijriCalendarService();
    }
    render() {
      const state = this.#store.getState();
      const u = state.user;
      const isSaaS = window.__app?.isManagedMode?.() ?? true;
      const sbUser = window.__app?.getSbUser?.() ?? null;
      return `
      <div class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">Settings</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()"><i data-lucide="x"></i></button>
        </div>

        <!-- Home currency -->
        <div class="card-muted p-3 mb-3">
          <label class="text-xs text-zinc-500">Home currency</label>
          <div class="text-xs text-zinc-500 mb-1">All balances and totals are converted to this currency.</div>
          <select class="select" onchange="window.__app.setHomeCurrency(this.value)">
            ${CURRENCIES.map((c) => `<option value="${c}" ${u.homeCurrency === c ? "selected" : ""}>${this.#fx.label(c)}</option>`).join("")}
          </select>
        </div>

        <!-- Default currency -->
        <div class="card-muted p-3 mb-3">
          <label class="text-xs text-zinc-500">Default currency for new entries</label>
          <div class="text-xs text-zinc-500 mb-1">Pre-selected when adding a transaction, account, budget, or regular item.</div>
          <select class="select" onchange="window.__app.setDefaultCurrency(this.value)">
            ${CURRENCIES.map((c) => `<option value="${c}" ${u.defaultCurrency === c ? "selected" : ""}>${this.#fx.label(c)}</option>`).join("")}
          </select>
        </div>

        <!-- Date format -->
        <div class="card-muted p-3 mb-3">
          <label class="text-xs text-zinc-500">Date format</label>
          <div class="text-xs text-zinc-500 mb-1">Used everywhere dates are displayed.</div>
          <select class="select" onchange="window.__app.setDateFormat(this.value)">
            <option value="auto"       ${u.dateFormat === "auto" ? "selected" : ""}>Auto (system locale)</option>
            <option value="YYYY-MM-DD" ${u.dateFormat === "YYYY-MM-DD" ? "selected" : ""}>YYYY-MM-DD (2026-05-20)</option>
            <option value="MM/DD/YYYY" ${u.dateFormat === "MM/DD/YYYY" ? "selected" : ""}>MM/DD/YYYY (05/20/2026)</option>
            <option value="DD/MM/YYYY" ${u.dateFormat === "DD/MM/YYYY" ? "selected" : ""}>DD/MM/YYYY (20/05/2026)</option>
          </select>
        </div>

        <!-- Theme -->
        <div class="card-muted p-3 mb-3">
          <label class="text-xs text-zinc-500 mb-1 block">Theme</label>
          <div class="grid grid-cols-3 gap-2">
            ${["light", "dark", "system"].map((t) => `
              <button class="btn ${u.theme === t ? "btn-primary" : "btn-outline"} justify-center"
                      onclick="window.__app.setTheme('${t}')">${t}</button>
            `).join("")}
          </div>
        </div>

        ${this.#renderHijriSection(u)}

        <!-- Migrate from CSV -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-start gap-3 mb-3">
            <div class="icon-pill" style="background:#10b98122;color:#10b981"><i data-lucide="file-down"></i></div>
            <div class="flex-1">
              <div class="font-medium text-sm">Migrate from another app</div>
              <div class="text-xs text-zinc-500">
                Download the CSV template, paste your transactions, then re-upload.
                Accounts, categories and subcategories are auto-created.
                Transfers, currencies, notes, payees and tags are preserved.
                <span class="text-zinc-700 dark:text-zinc-300">Dates:</span>
                <code>YYYY-MM-DD</code> is preferred (e.g. <code>2026-05-22</code>), but
                <code>DD/MM/YYYY</code>, <code>MM/DD/YYYY</code>, and <code>YYYY/MM/DD</code>
                also work \u2014 ambiguous slash dates follow your Settings \u2192 Date format preference.
                <span class="text-zinc-700 dark:text-zinc-300">Splits:</span> rows that share
                the same <code>SplitOf</code> value are merged into one transaction.
                <span class="text-zinc-700 dark:text-zinc-300">Debts:</span> use
                <code>borrowed</code> or <code>lent</code> as the Type.
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn btn-outline justify-center"
                    onclick="window.__app.downloadImportTemplate()">
              <i data-lucide="download"></i> Download template
            </button>
            <label class="btn btn-primary justify-center cursor-pointer">
              <i data-lucide="upload"></i> Import CSV
              <input type="file" accept=".csv,text/csv" class="hidden"
                     onchange="window.__app.startImport(this)">
            </label>
          </div>
        </div>

        <!-- Data -->
        <div class="card-muted p-3 mb-3">
          <div class="text-sm font-medium mb-2">Data</div>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn btn-outline justify-center" onclick="window.__app.exportJson()">
              <i data-lucide="download"></i> Export JSON
            </button>
            <label class="btn btn-outline justify-center cursor-pointer">
              <i data-lucide="upload"></i> Import JSON
              <input type="file" accept="application/json" class="hidden"
                     onchange="window.__app.importJson(this)">
            </label>
            <button class="btn btn-outline justify-center"
                    onclick="window.__app.openModal('csv',{})">
              <i data-lucide="file-text"></i> Export CSV
            </button>
            <button class="btn btn-outline justify-center text-rose-500"
                    onclick="window.__app.resetData()">
              <i data-lucide="rotate-ccw"></i> Reset data
            </button>
          </div>
        </div>

        <!-- Cloud sync -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-start gap-3 mb-3">
            <div class="icon-pill" style="background:#10b98122;color:#10b981"><i data-lucide="cloud"></i></div>
            <div class="flex-1">
              <div class="font-medium text-sm">Cloud Sync &amp; Multi-device</div>
              <div class="text-xs text-zinc-500">
                ${isSaaS ? "All your devices stay in sync. Sign in to access your data anywhere." : 'Connect your own free <a href="https://supabase.com" target="_blank" class="underline">Supabase</a> project. All your devices stay in sync in real time.'}
              </div>
            </div>
            ${sbUser ? `<span class="chip" style="background:#10b98122;color:#10b981"><i data-lucide="check-circle-2" style="width:11px;height:11px;display:inline"></i> Connected</span>` : ""}
          </div>

          ${sbUser ? `
            <div class="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/70 dark:border-emerald-800/40">
              <div class="w-8 h-8 rounded-full bg-emerald-600 text-white grid place-items-center text-sm font-bold flex-shrink-0">${(sbUser.email?.[0] || "?").toUpperCase()}</div>
              <div class="flex-1 min-w-0">
                <div class="text-[11px] uppercase tracking-wide text-zinc-500 leading-none mb-0.5">Signed in as</div>
                <div class="text-sm font-medium truncate">${this.#esc(sbUser.email || "")}</div>
              </div>
              <i data-lucide="badge-check" style="width:18px;height:18px;color:#10b981"></i>
            </div>` : ""}

          ${isSaaS ? `
            <div class="flex gap-2 mb-1">
              ${sbUser ? `<button class="btn btn-outline flex-1 justify-center" onclick="window.__app.signOut()"><i data-lucide="log-out"></i> Sign out</button>` : `<button class="btn btn-primary flex-1 justify-center" onclick="window.__app.closeModal(); window.__app.openModal('auth',{})"><i data-lucide="log-in"></i> Sign in / Create account</button>`}
            </div>
          ` : `
            <div class="mb-2">
              <label class="text-xs text-zinc-500">Project URL</label>
              <input class="input" type="url" id="sbUrlInput"
                     placeholder="https://xxxx.supabase.co"
                     value="${this.#esc(u.supabaseUrl || "")}"
                     oninput="window.__app.setSbUrl(this.value.trim())">
            </div>
            <div class="mb-3">
              <label class="text-xs text-zinc-500">Anon / public key</label>
              <input class="input" type="password" id="sbKeyInput"
                     placeholder="eyJhbGciOi..."
                     value="${this.#esc(u.supabaseKey || "")}"
                     oninput="window.__app.setSbKey(this.value.trim())">
            </div>
            <div class="flex gap-2 mb-3">
              <button class="btn btn-primary flex-1 justify-center"
                      onclick="window.__app.connectSupabase()">
                <i data-lucide="plug"></i> Connect &amp; Sign in
              </button>
              ${sbUser ? `<button class="btn btn-outline justify-center" onclick="window.__app.signOut()"><i data-lucide="log-out"></i> Sign out</button>` : ""}
            </div>

            <details class="text-xs">
              <summary class="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 select-none">
                <strong>One-time setup: SQL to run in Supabase \u2192</strong>
              </summary>
              <div class="mt-2 rounded-lg overflow-hidden">
                <div class="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre js-sql-block">-- Run this once in Supabase \u2192 SQL Editor
create table if not exists public.user_data (
  id   uuid references auth.users on delete cascade primary key,
  data jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table public.user_data enable row level security;
create policy "Users own their data"
  on public.user_data for all
  using  (auth.uid() = id)
  with check (auth.uid() = id);
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger user_data_updated_at
  before update on public.user_data
  for each row execute function public.touch_updated_at();
-- Enable real-time for the table:
alter publication supabase_realtime add table public.user_data;

-- \u2500\u2500 Family sharing table (run this too) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
create table if not exists public.family_shares (
  owner_id     uuid references auth.users on delete cascade not null,
  member_email text not null,
  snapshot     jsonb not null default '{}',
  updated_at   timestamptz default now(),
  primary key (owner_id, member_email)
);
alter table public.family_shares enable row level security;
create policy "owner_manages_shares"
  on public.family_shares for all
  using  (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
create policy "member_reads_shares"
  on public.family_shares for select
  using (member_email = lower((auth.jwt()->>'email')));
create trigger family_shares_updated_at
  before update on public.family_shares
  for each row execute function public.touch_updated_at();</div>
                <button class="btn btn-outline w-full mt-1 justify-center text-xs"
                        onclick="window.__app.copySql()">
                  <i data-lucide="copy"></i> Copy SQL
                </button>
              </div>
            </details>
          `}
        </div>

        <!-- AI Receipt Scanner -->
        <div class="card-muted p-3 mb-3">
          <div class="flex items-start gap-3 mb-2">
            <div class="icon-pill" style="background:#4285f422;color:#4285f4"><i data-lucide="scan-line"></i></div>
            <div class="flex-1">
              <div class="font-medium text-sm">AI Receipt Scanner</div>
              <div class="text-xs text-zinc-500">
                Powered by <strong>Gemini 2.0 Flash</strong> (Google AI).
                Free tier: 1,500 scans/day \u2014 no credit card needed.
                Get a free key at
                <a href="https://aistudio.google.com/apikey" target="_blank" class="underline">aistudio.google.com/apikey</a>.
                Reads the receipt image, maps line items to your categories, and pre-fills splits automatically.
              </div>
            </div>
          </div>
          <div class="flex gap-2 items-stretch">
            <div class="relative flex-1">
              <input id="geminiKeyInput" class="input pr-16" type="password"
                     placeholder="AIzaSy..."
                     value="${this.#esc(u.geminiApiKey || "")}"
                     oninput="window.__app.setGeminiKey(this.value.trim())">
              <button type="button"
                      class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                      onclick="(()=>{ const i=document.getElementById('geminiKeyInput'); i.type=i.type==='password'?'text':'password'; })()">
                Show
              </button>
            </div>
            <button type="button" class="btn btn-primary shrink-0" onclick="window.__app.saveGeminiKey()">
              <i data-lucide="save"></i> Save
            </button>
          </div>
          <div class="text-xs mt-1 ${u.geminiApiKey ? "text-emerald-600" : "text-zinc-500"}">
            ${u.geminiApiKey ? '<i data-lucide="check-circle-2" style="width:11px;height:11px;display:inline"></i> Key saved \u2014 receipt scanning is enabled.' : "No key saved yet. Paste a key and press Save."}
          </div>
          <div class="text-xs text-zinc-500 mt-1">Key is stored only in your browser (localStorage). Only sent to <code>generativelanguage.googleapis.com</code>.</div>
        </div>

        <div class="text-xs text-zinc-500 text-center mt-4">Pocket \xB7 v2.0</div>
      </div>`;
    }
    /**
     * Renders the Hijri calendar settings section.
     * Extracted into a private method to avoid nested template-literal
     * escaping issues in the main render() return string.
     * @param {object} u  state.user
     * @returns {string} HTML
     */
    #renderHijriSection(u) {
      const toggleBtn = `
      <button class="btn ${u.showHijri ? "btn-primary" : "btn-outline"}"
              onclick="window.__app.toggleHijri()">${u.showHijri ? "On" : "Off"}</button>`;
      const offset = u.hijriOffset ?? 0;
      const todayHijri = u.showHijri ? this.#hijri.format(/* @__PURE__ */ new Date(), { long: true }) : "";
      const offsetBadge = offset !== 0 ? `<div class="text-xs mt-1 ${offset > 0 ? "text-amber-600" : "text-blue-600"}">
           Offset applied: ${offset > 0 ? "+" : ""}${offset} day${Math.abs(offset) !== 1 ? "s" : ""}
           <button class="ml-2 underline text-zinc-500"
                   onclick="window.__app.setHijriOffset(0)">reset</button>
         </div>` : '<div class="text-xs text-zinc-400 mt-1">No offset applied \u2014 using calculated date</div>';
      const calModes = [
        ["gregorian", "Gregorian"],
        ["both", "Both dates"],
        ["hijri", "Hijri"]
      ];
      const calModeButtons = calModes.map(
        ([k, l]) => `<button class="btn ${(u.calendarMode || "both") === k ? "btn-primary" : "btn-outline"} justify-center"
               onclick="window.__app.setCalendarMode('${k}')">${l}</button>`
      ).join("");
      const expandedSection = u.showHijri ? `
      <div class="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">

        <!-- Today's corrected date -->
        <div class="rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-3 mb-3">
          <div class="text-xs text-zinc-500 mb-2">Today's Hijri date (after your correction)</div>
          <div class="text-base font-semibold">${todayHijri}</div>
          ${offsetBadge}
        </div>

        <!-- Day offset stepper -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500 mb-2 block">
            Adjust if your local moon sighting differs from the calculated date
          </label>
          <div class="flex items-center gap-3">
            <button class="btn btn-outline px-4 text-lg font-bold"
                    onclick="window.__app.adjustHijriOffset(-1)"
                    ${offset <= -7 ? "disabled" : ""}>\u2212</button>
            <div class="flex-1 text-center">
              <div class="text-2xl font-bold tracking-tight">
                ${offset > 0 ? "+" : ""}${offset}
              </div>
              <div class="text-xs text-zinc-500">days</div>
            </div>
            <button class="btn btn-outline px-4 text-lg font-bold"
                    onclick="window.__app.adjustHijriOffset(+1)"
                    ${offset >= 7 ? "disabled" : ""}>+</button>
          </div>
          <div class="text-xs text-zinc-400 text-center mt-2">
            Range: \u22127 to +7 days \xB7 Changes apply everywhere instantly
          </div>
        </div>

        <!-- Calendar view default -->
        <div>
          <label class="text-xs text-zinc-500 mb-1 block">Calendar view default</label>
          <div class="grid grid-cols-3 gap-2">
            ${calModeButtons}
          </div>
        </div>
      </div>` : "";
      return `
      <div class="card-muted p-3 mb-3">
        <div class="flex items-start gap-3">
          <div class="icon-pill" style="background:#0ea5e922;color:#0ea5e9">
            <i data-lucide="moon-star"></i>
          </div>
          <div class="flex-1">
            <div class="font-medium text-sm">Hijri calendar</div>
            <div class="text-xs text-zinc-500">Show Hijri dates and miqaats from the Mumineen Calendar</div>
          </div>
          ${toggleBtn}
        </div>
        ${expandedSection}
      </div>`;
    }
    #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/CsvModal.js
  var CsvModal = class {
    render() {
      return `
      <div class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">Export transactions</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div class="grid grid-cols-2 gap-2 mb-4">
          <button class="btn btn-outline justify-center"
                  onclick="window.__app.exportCsv('30')">Last 30 days</button>
          <button class="btn btn-outline justify-center"
                  onclick="window.__app.exportCsv('90')">Last 90 days</button>
          <button class="btn btn-outline justify-center"
                  onclick="window.__app.exportCsv('all')">All time</button>
          <button class="btn btn-primary  justify-center"
                  onclick="window.__app.exportCsv('current')">Current range</button>
        </div>

        <div class="text-xs text-zinc-500 text-center">
          CSV columns mirror the import template (Date, Type, Account, ToAccount,
          Category, Subcategory, Payee, Note, Amount, Currency, PaymentType, Tags,
          DueDate, DebtRef, SplitOf, CreatedAt, AddedBy). Split transactions emit
          one row per slice \u2014 all rows share the same <code>SplitOf</code> value
          (the parent transaction id). Re-importing the file rebuilds the splits.
        </div>
      </div>`;
    }
    downloadFailedRows(rows) {
      if (!rows?.length) return;
      const headers = Object.keys(rows[0]).filter((k) => k !== "_error");
      const lines = [
        [...headers, "_Error"].join(","),
        ...rows.map((r) => [
          ...headers.map((h) => JSON.stringify(r[h] ?? "")),
          JSON.stringify(r._error || "")
        ].join(","))
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: "import_errors.csv" });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    async #commitChunked(txDrafts, applyFn) {
      const CHUNK = 25;
      for (let i = 0; i < txDrafts.length; i += CHUNK) {
        txDrafts.slice(i, i + CHUNK).forEach(applyFn);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    static normaliseType(raw) {
      let type = (raw || "").toLowerCase().trim();
      if (type === "debit") type = "expense";
      if (type === "credit") type = "income";
      if (type === "borrow") type = "borrowed";
      if (type === "lend" || type === "loan") type = "lent";
      return type;
    }
  };

  // src/ui/modals/DebtModal.js
  var DebtModal = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
    }
    /** Entry point registered in the Modal system.
     *  opts.mode === 'payment' renders the payment modal instead. */
    render(opts = {}) {
      return opts.mode === "payment" ? this.#renderPayment(opts) : this.#renderDebt(opts);
    }
    // ── New / edit debt ──────────────────────────────────────────────────
    #renderDebt({ id } = {}) {
      const state = this.#store.getState();
      const editing = id ? state.debts.find((x) => x.id === id) : null;
      const d = editing || {
        type: "borrowed",
        counterparty: "",
        principal: 0,
        currency: state.user.defaultCurrency || state.user.homeCurrency,
        accountId: state.accounts[0]?.id,
        dateTaken: DateService.todayIso(),
        dueDate: "",
        note: "",
        status: "active"
      };
      const principalDisp = editing ? this.#fx.fromMinor(d.principal, d.currency) : "";
      const paymentCount = editing ? state.transactions.filter((t) => t.debtId === editing.id && t.id !== editing.initialTxId).length : 0;
      return `
      <form onsubmit="window.__app.submitDebt(event,'${editing?.id || ""}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? "Edit debt" : "New debt"}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <!-- Type: borrowed / lent -->
        <div class="grid grid-cols-2 gap-2 mb-4">
          <label class="cursor-pointer">
            <input type="radio" name="type" value="borrowed"
                   ${d.type === "borrowed" ? "checked" : ""}
                   class="peer sr-only" ${editing ? "disabled" : ""}>
            <div class="btn btn-outline justify-center
                        peer-checked:bg-rose-50 peer-checked:text-rose-600 peer-checked:border-rose-200
                        dark:peer-checked:bg-rose-950 dark:peer-checked:text-rose-300 w-full">
              <i data-lucide="arrow-down-left"></i> I borrowed
            </div>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="type" value="lent"
                   ${d.type === "lent" ? "checked" : ""}
                   class="peer sr-only" ${editing ? "disabled" : ""}>
            <div class="btn btn-outline justify-center
                        peer-checked:bg-emerald-50 peer-checked:text-emerald-600 peer-checked:border-emerald-200
                        dark:peer-checked:bg-emerald-950 dark:peer-checked:text-emerald-300 w-full">
              <i data-lucide="arrow-up-right"></i> I lent
            </div>
          </label>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Counterparty</label>
          <input class="input" name="counterparty" required
                 value="${this.#esc(d.counterparty)}"
                 placeholder="Name of person or entity" autofocus>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Principal</label>
            <input class="input" name="principal" type="number" step="0.01" required
                   value="${principalDisp}" ${editing ? "readonly" : ""}>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency" ${editing ? "disabled" : ""}>
              ${CURRENCIES.map((c) => `<option value="${c}" ${d.currency === c ? "selected" : ""}>${this.#fx.label(c)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Linked account</label>
          <select class="select" name="accountId" required ${editing ? "disabled" : ""}>
            ${state.accounts.map((a) => `<option value="${a.id}" ${d.accountId === a.id ? "selected" : ""}>${this.#esc(a.name)}</option>`).join("")}
          </select>
          <div class="text-xs text-zinc-500 mt-1">
            ${d.type === "borrowed" ? "Money will be added to this account on the date taken" : "Money will be deducted from this account on the date taken"}
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Date taken</label>
            <input class="input" type="date" name="dateTaken"
                   value="${d.dateTaken}" ${editing ? "readonly" : ""}>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Due date (optional)</label>
            <input class="input" type="date" name="dueDate" value="${d.dueDate || ""}">
          </div>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Note</label>
          <textarea class="textarea" name="note" rows="2"
                    placeholder="optional...">${this.#esc(d.note || "")}</textarea>
        </div>

        ${editing ? `
          <div class="card-muted p-3 mb-4 space-y-2">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="markPaid" ${editing.status === "paid" ? "checked" : ""}>
              <span>Mark as fully paid off</span>
            </label>
            ${paymentCount > 0 ? `
              <label class="flex items-start gap-2 text-sm">
                <input type="checkbox" id="destroyPayments" class="mt-0.5">
                <span>
                  <span class="text-rose-600 font-medium">Also destroy ${paymentCount} linked payment transaction${paymentCount === 1 ? "" : "s"}</span>
                  when deleting. Account balances will be restored.
                </span>
              </label>` : ""}
          </div>` : ""}

        <div class="flex items-center gap-2">
          ${editing ? `
            <button type="button" class="btn btn-outline text-rose-500"
                    onclick="window.__app.deleteDebt('${editing.id}', document.getElementById('destroyPayments')?.checked)">
              <i data-lucide="trash-2"></i> Delete
            </button>` : ""}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i data-lucide="check"></i> ${editing ? "Save" : "Record debt"}
          </button>
        </div>
      </form>`;
    }
    // ── Record a debt payment ────────────────────────────────────────────
    #renderPayment({ id } = {}) {
      const state = this.#store.getState();
      const debt = state.debts?.find((d) => d.id === id);
      if (!debt) return `<div class="p-5">Debt not found</div>`;
      const isBorrowed = debt.type === "borrowed";
      const rem = this.#debtRemaining(debt, state);
      const remDisp = this.#fx.fromMinor(rem, debt.currency);
      return `
      <form onsubmit="window.__app.submitDebtPayment(event,'${id}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">
            ${isBorrowed ? "Pay" : "Receive payment from"} ${this.#esc(debt.counterparty)}
          </h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div class="card-muted p-3 mb-3">
          <div class="text-xs text-zinc-500">Remaining</div>
          <div class="text-2xl font-semibold">${this.#fx.formatMoney(rem, debt.currency)}</div>
          <div class="text-xs text-zinc-500">of ${this.#fx.formatMoney(debt.principal, debt.currency)} total</div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Amount</label>
            <input class="input" name="amount" type="number" step="0.01" required
                   value="${remDisp}" max="${remDisp}" autofocus>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Date</label>
            <input class="input" type="date" name="date"
                   value="${DateService.todayIso()}">
          </div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">From account</label>
          <select class="select" name="accountId" required>
            ${state.accounts.map((a) => `<option value="${a.id}" ${debt.accountId === a.id ? "selected" : ""}>${this.#esc(a.name)}</option>`).join("")}
          </select>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Note</label>
          <textarea class="textarea" name="note" rows="2" placeholder="optional..."></textarea>
        </div>

        <div class="flex items-center gap-2">
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i data-lucide="check"></i> Record payment
          </button>
        </div>
      </form>`;
    }
    // ── Helpers ──────────────────────────────────────────────────────────
    /** Compute remaining balance of a debt (principal minus sum of payments, cross-currency aware). */
    #debtRemaining(debt, state) {
      const payments = state.transactions.filter((t) => t.debtId === debt.id && t.id !== debt.initialTxId);
      const paid = payments.reduce((sum, t) => {
        const fromCcy = t.currency || debt.currency;
        return sum + this.#fx.convert(t.amount || 0, fromCcy, debt.currency);
      }, 0);
      return Math.max(0, debt.principal - paid);
    }
    #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/FamilyModal.js
  var FamilyModal = class {
    /** @type {Store} */
    #store;
    /** Accumulated permissions while the modal is open.
     *  accountId → access-level string ('view' | 'add' | 'edit' | 'full') */
    #pendingPerms = {};
    constructor() {
      this.#store = Store.getInstance();
    }
    /** Called by Modal.open() before injecting HTML into the card. */
    onOpen(opts) {
      this.#pendingPerms = {};
      const state = this.#store.getState();
      const member = opts?.id ? state.family?.find((m) => m.id === opts.id) : null;
      if (member && Array.isArray(member.permissions)) {
        member.permissions.forEach((p) => {
          this.#pendingPerms[p.accountId] = p.access;
        });
      }
    }
    /** Returns a snapshot of the current permission map so app.js can read it. */
    getPendingPerms() {
      return { ...this.#pendingPerms };
    }
    /** Set a single account permission (called live as user clicks radio buttons). */
    setPendingPerm(accountId, level) {
      this.#pendingPerms[accountId] = level;
    }
    /** Remove a permission entry when the toggle is turned off. */
    removePendingPerm(accountId) {
      delete this.#pendingPerms[accountId];
    }
    /**
     * Visually highlight the selected level label for an account and update
     * the matching radio input's checked state.
     * Call this from app.js after setPendingPerm() to keep the UI in sync.
     */
    highlightPermLevel(accountId, level) {
      const container = document.getElementById(`accLevels_${accountId}`);
      if (!container) return;
      container.querySelectorAll(".perm-lvl-label").forEach((lbl) => {
        const isSelected = lbl.dataset.lvl === level;
        const color = lbl.dataset.color || "#e4e4e7";
        lbl.style.color = isSelected ? color : "";
        lbl.style.borderColor = isSelected ? color : "#e4e4e7";
        const radio = lbl.querySelector('input[type="radio"]');
        if (radio) radio.checked = isSelected;
      });
    }
    render(opts = {}) {
      const { id } = opts;
      const state = this.#store.getState();
      const editing = id ? state.family?.find((m2) => m2.id === id) : null;
      const m = editing || {
        name: "",
        email: "",
        color: MEMBER_COLORS[(state.family?.length || 0) % MEMBER_COLORS.length],
        initials: "",
        permissions: []
      };
      const accounts = (state.accounts || []).filter((a) => !a.archived);
      const permMap = {};
      (m.permissions || []).forEach((p) => {
        permMap[p.accountId] = p.access;
      });
      return `
      <div class="p-5">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-lg font-semibold">${editing ? "Edit member" : "Add family member"}</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <form id="familyMemberForm"
              onsubmit="window.__app.submitFamilyMember(event,'${editing?.id || ""}')">

          <!-- Avatar colour row -->
          <div class="flex items-center gap-3 mb-4">
            <div id="memberAvatar"
                 class="w-12 h-12 rounded-full grid place-items-center text-white font-bold text-lg flex-shrink-0"
                 style="background:${m.color}">
              ${m.initials || (m.name ? m.name.slice(0, 2).toUpperCase() : "?")}
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${MEMBER_COLORS.map((c) => `
                <button type="button"
                        onclick="window.__app.pickMemberColor('${c}')"
                        class="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                        style="background:${c};border-color:${m.color === c ? "#09090b" : "transparent"}"
                        data-color="${c}"></button>
              `).join("")}
            </div>
          </div>
          <input type="hidden" name="color" id="memberColorInput" value="${m.color}">

          <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label class="text-xs text-zinc-500">Name *</label>
              <input class="input" name="name" required
                     value="${this.#esc(m.name)}"
                     placeholder="e.g. Sara"
                     oninput="const av=document.getElementById('memberAvatar'); av.textContent=this.value.slice(0,2).toUpperCase()||'?'">
            </div>
            <div>
              <label class="text-xs text-zinc-500">Initials</label>
              <input class="input" name="initials" maxlength="2"
                     value="${this.#esc(m.initials || "")}" placeholder="Auto">
            </div>
          </div>

          <div class="mb-4">
            <label class="text-xs text-zinc-500">Email (optional)</label>
            <input class="input" name="email" type="email"
                   value="${this.#esc(m.email || "")}" placeholder="sara@example.com">
          </div>

          <!-- Account permissions -->
          <div class="mb-1">
            <div class="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Account access</div>
            ${accounts.length === 0 ? `<div class="text-xs text-zinc-400 italic">No accounts found.</div>` : `<div class="space-y-2" id="accountPermsList">
                   ${accounts.map((acc) => this.#accountPermRow(acc, permMap)).join("")}
                 </div>`}
          </div>

          <div class="flex items-center gap-2 mt-5">
            ${editing ? `
              <button type="button" class="btn btn-outline text-rose-500"
                      onclick="window.__app.deleteFamilyMember('${editing.id}')">
                <i data-lucide="trash-2"></i> Remove
              </button>` : ""}
            <div class="flex-1"></div>
            <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">
              <i data-lucide="check"></i> Save
            </button>
          </div>
        </form>
      </div>`;
    }
    // ── Private ──────────────────────────────────────────────────────────
    #accountPermRow(acc, permMap) {
      const current = permMap[acc.id] || "";
      const typeIcon = ACCOUNT_TYPE_ICONS[acc.type] || "wallet";
      const accColor = acc.color || "#e4e4e7";
      const iconColor = acc.color || "#71717a";
      return `
      <div class="card-muted p-3 rounded-xl">
        <div class="flex items-center gap-2 mb-2">
          <div class="icon-pill w-7 h-7 rounded-lg flex-shrink-0"
               style="background:${accColor}22;color:${iconColor}">
            <i data-lucide="${typeIcon}" style="width:13px;height:13px"></i>
          </div>
          <div class="flex-1">
            <div class="text-sm font-medium">${this.#esc(acc.name)}</div>
            <div class="text-xs text-zinc-500">${acc.currency}</div>
          </div>
          <!-- Toggle switch -->
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only peer" id="accToggle_${acc.id}"
                   ${current ? "checked" : ""}
                   onchange="window.__app.toggleAccountPerm('${acc.id}', this.checked)">
            <div class="w-9 h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full peer
                        peer-checked:bg-zinc-900 dark:peer-checked:bg-white transition-colors"></div>
            <div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white dark:bg-zinc-900 rounded-full shadow
                        transition-transform peer-checked:translate-x-4"></div>
          </label>
        </div>

        <!-- Access level picker (visible when toggled on) -->
        <div id="accLevels_${acc.id}" class="${current ? "" : "hidden"}">
          <div class="grid grid-cols-2 gap-1.5">
            ${FAMILY_ACCESS_LEVELS.map((lvl) => {
        const sel = current === lvl.id;
        return `
              <label class="perm-lvl-label flex items-start gap-2 p-2 rounded-lg cursor-pointer border transition-colors
                            hover:bg-zinc-50 dark:hover:bg-zinc-800"
                     data-acc="${acc.id}" data-lvl="${lvl.id}" data-color="${lvl.color}"
                     style="${sel ? `color:${lvl.color};border-color:${lvl.color}` : "border-color:#e4e4e7"}"
                     onclick="window.__app.updatePermLevel('${acc.id}', '${lvl.id}')">
                <input type="radio" name="perm_${acc.id}" value="${lvl.id}"
                       class="sr-only"
                       ${sel ? "checked" : ""}>
                <i data-lucide="${lvl.icon}"
                   style="width:13px;height:13px;margin-top:2px;flex-shrink:0;color:${lvl.color}"></i>
                <div>
                  <div class="text-xs font-medium">${lvl.label}</div>
                  <div class="text-xs text-zinc-500 leading-tight">${lvl.desc}</div>
                </div>
              </label>`;
      }).join("")}
          </div>
        </div>
      </div>`;
    }
    #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/ReconcileModal.js
  var ReconcileModal = class {
    /** @type {Store}          */
    #store;
    /** @type {AccountService} */
    #accounts;
    /** @type {CurrencyService}*/
    #fx;
    // Per-open state (readable by app.js via getters)
    #accountId = null;
    #ledgerSum = 0;
    #residual = 0;
    constructor() {
      this.#store = Store.getInstance();
      this.#accounts = new AccountService();
      this.#fx = new CurrencyService();
    }
    // ── Public accessors (read by app.js action handlers) ────────────────
    get accountId() {
      return this.#accountId;
    }
    get ledgerSum() {
      return this.#ledgerSum;
    }
    get residual() {
      return this.#residual;
    }
    // ── Modal strategy contract ───────────────────────────────────────────
    onOpen(opts) {
      const { id } = opts || {};
      this.#accountId = id || null;
      const state = this.#store.getState();
      const a = state.accounts.find((x) => x.id === id);
      this.#ledgerSum = a ? this.#accounts.ledgerSum(a, state.transactions) : 0;
      this.#residual = a ? a.balance - this.#ledgerSum : 0;
    }
    render(opts = {}) {
      const { id } = opts;
      const state = this.#store.getState();
      const a = state.accounts.find((x) => x.id === id);
      if (!a) return "";
      const residual = this.#residual;
      const ledger = this.#ledgerSum;
      const sign = residual >= 0 ? "+" : "-";
      const fmtRes = this.#fx.formatMoney(Math.abs(residual), a.currency);
      const fmtLed = this.#fx.formatMoney(ledger, a.currency);
      const fmtBal = this.#fx.formatMoney(a.balance, a.currency);
      return `
      <div class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">Reconcile ${this.#esc(a.name)}</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div class="card-muted p-3 mb-4">
          <div class="grid grid-cols-3 gap-2 text-center">
            <div>
              <div class="text-xs text-zinc-500">Account balance</div>
              <div class="text-base font-semibold">${fmtBal}</div>
            </div>
            <div>
              <div class="text-xs text-zinc-500">Transactions sum</div>
              <div class="text-base font-semibold">${fmtLed}</div>
            </div>
            <div>
              <div class="text-xs text-zinc-500">Residual</div>
              <div class="text-base font-semibold text-amber-600">${sign}${fmtRes}</div>
            </div>
          </div>
        </div>

        <div class="text-sm text-zinc-700 dark:text-zinc-300 mb-3">How would you like to reconcile?</div>

        <!-- Option A: add opening balance entry -->
        <button type="button"
                class="card w-full p-4 mb-3 text-left hover:shadow-md transition"
                onclick="window.__app.reconcileAddEntry('${id}')">
          <div class="flex items-start gap-3">
            <div class="icon-pill" style="background:#10b98122;color:#10b981">
              <i data-lucide="plus-square"></i>
            </div>
            <div class="flex-1">
              <div class="font-semibold flex items-center gap-2">
                Add opening balance entry
                <span class="chip" style="background:#10b98122;color:#10b981">Recommended</span>
              </div>
              <div class="text-xs text-zinc-500 mt-1">
                Logs a <code>${sign}${fmtRes}</code> transaction tagged <em>opening-balance</em>,
                dated before your earliest entry. The displayed balance stays at
                <b>${fmtBal}</b>. Best when the legacy balance was real money.
              </div>
            </div>
            <i data-lucide="chevron-right" class="text-zinc-400"></i>
          </div>
        </button>

        <!-- Option B: recalculate balance -->
        <button type="button"
                class="card w-full p-4 mb-3 text-left hover:shadow-md transition"
                onclick="window.__app.reconcileRecalculate('${id}')">
          <div class="flex items-start gap-3">
            <div class="icon-pill" style="background:#f59e0b22;color:#f59e0b">
              <i data-lucide="calculator"></i>
            </div>
            <div class="flex-1">
              <div class="font-semibold">Recalculate balance from transactions</div>
              <div class="text-xs text-zinc-500 mt-1">
                No new entry. Balance becomes <b>${fmtLed}</b>.
                Best when transactions are the source of truth.
              </div>
            </div>
            <i data-lucide="chevron-right" class="text-zinc-400"></i>
          </div>
        </button>

        <div class="flex justify-end gap-2 mt-2">
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
        </div>
      </div>`;
    }
    // ── Private ───────────────────────────────────────────────────────────
    #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/AuthModal.js
  var AuthModal = class {
    /** @type {Store} */
    #store;
    constructor() {
      this.#store = Store.getInstance();
    }
    render() {
      const state = this.#store.getState();
      const isSaaS = window.__app?.isManagedMode?.() ?? true;
      const hasUrl = !!state.user.supabaseUrl;
      return `
      <div class="p-5" style="min-width:320px">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-lg font-semibold">Cloud sync</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        ${!isSaaS && !hasUrl ? `
          <div class="card-muted p-4 mb-4 text-sm text-zinc-600 dark:text-zinc-400">
            <strong>Setup needed:</strong> Add your Supabase project URL and anon key in
            <button class="underline"
                    onclick="window.__app.closeModal(); window.__app.openModal('settings',{})">
              Settings \u2192 Cloud sync
            </button>
            first.
          </div>
        ` : ""}

        <!-- Google OAuth \u2014 only sign-in method -->
        <button onclick="window.__app.signInWithGoogle()"
                class="btn btn-outline w-full justify-center gap-3 mb-5"
                style="height:44px;font-size:.95rem">
          <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.84l6.08-6.08C34.36 3.09 29.45 1 24 1 14.82 1 7.07 6.48 3.64 14.22l7.08 5.5C12.4 13.72 17.73 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.1 24.5c0-1.64-.15-3.22-.42-4.74H24v8.98h12.43c-.54 2.9-2.18 5.36-4.64 7.02l7.18 5.58C43.27 37.26 46.1 31.35 46.1 24.5z"/>
            <path fill="#FBBC05" d="M10.72 28.28A14.6 14.6 0 0 1 9.5 24c0-1.49.26-2.94.72-4.28l-7.08-5.5A23.94 23.94 0 0 0 .5 24c0 3.86.92 7.5 2.64 10.72l7.58-6.44z"/>
            <path fill="#34A853" d="M24 47c5.45 0 10.02-1.8 13.36-4.9l-7.18-5.58c-1.98 1.33-4.5 2.12-6.18 2.12-6.27 0-11.6-4.22-13.28-9.94l-7.58 6.44C7.07 41.52 14.82 47 24 47z"/>
          </svg>
          Continue with Google
        </button>

        <div class="text-xs text-zinc-400 text-center">
          ${isSaaS ? "Your data is encrypted and privately stored. Only you can access it." : "Your data is end-to-end owned by you. Stored in your own Supabase project."}
        </div>
      </div>`;
    }
  };

  // src/ui/modals/RegularItemModal.js
  var ITEM_ICONS = [
    "coffee",
    "shopping-basket",
    "bus",
    "dumbbell",
    "utensils",
    "heart-pulse",
    "book",
    "music",
    "film",
    "gift",
    "paw-print",
    "baby",
    "graduation-cap",
    "wifi",
    "phone",
    "home",
    "car",
    "plane",
    "tag"
  ];
  var ITEM_COLORS = [
    "#f97316",
    "#3b82f6",
    "#10b981",
    "#8b5cf6",
    "#ec4899",
    "#ef4444",
    "#f59e0b",
    "#06b6d4",
    "#84cc16",
    "#6366f1"
  ];
  var RegularItemModal = class {
    /** @type {Store} */
    #store;
    /** @type {CurrencyService} */
    #fx;
    constructor() {
      this.#store = Store.getInstance();
      this.#fx = new CurrencyService();
    }
    render(opts = {}) {
      const { id } = opts;
      const state = this.#store.getState();
      const editing = id ? (state.regularItems || []).find((i) => i.id === id) : null;
      const home = state.user.homeCurrency || "USD";
      const data = editing ? { ...editing } : {
        name: "",
        defaultAmount: 0,
        currency: home,
        accountId: state.accounts[0]?.id || "",
        categoryId: "",
        icon: "coffee",
        color: ITEM_COLORS[0]
      };
      const amountVal = editing ? this.#fx.fromMinor(editing.defaultAmount, editing.currency) : 0;
      const expenseCats = state.categories.filter((c) => c.type === "expense" || !c.type);
      return `
      <form id="regularItemForm"
            onsubmit="window.__app.submitRegularItem(event,'${editing?.id || ""}')"
            class="p-5" style="min-width:320px;max-width:480px">

        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? "Edit item" : "New regular item"}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <!-- Name -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500">Name</label>
          <input class="input" name="name" required placeholder="e.g. Morning coffee"
                 value="${this.#esc(data.name)}" autofocus>
        </div>

        <!-- Amount + Currency -->
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Default amount</label>
            <input class="input" name="defaultAmount" type="number" step="0.01" min="0"
                   placeholder="0.00" value="${amountVal || ""}">
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency">
              ${CURRENCIES.map((c) => `<option value="${c}" ${data.currency === c ? "selected" : ""}>${c}</option>`).join("")}
            </select>
          </div>
        </div>

        <!-- Account -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500">Default account</label>
          <select class="select" name="accountId">
            <option value="">\u2014 None \u2014</option>
            ${state.accounts.map((a) => `<option value="${a.id}" ${data.accountId === a.id ? "selected" : ""}>${this.#esc(a.name)}</option>`).join("")}
          </select>
        </div>

        <!-- Category -->
        <div class="mb-4">
          <label class="text-xs text-zinc-500">Default category</label>
          <select class="select" name="categoryId">
            <option value="">\u2014 Uncategorised \u2014</option>
            ${expenseCats.map((c) => `<option value="${c.id}" ${data.categoryId === c.id ? "selected" : ""}>${this.#esc(c.name)}</option>`).join("")}
          </select>
        </div>

        <!-- Frequency -->
        <div class="mb-4">
          <label class="text-xs text-zinc-500">Frequency</label>
          <select class="select" name="frequency">
            <option value="daily"   ${data.frequency === "daily" ? "selected" : ""}>Daily</option>
            <option value="weekly"  ${data.frequency === "weekly" ? "selected" : ""}>Weekly</option>
            <option value="monthly" ${!data.frequency || data.frequency === "monthly" ? "selected" : ""}>Monthly</option>
          </select>
        </div>

        <!-- Icon -->
        <div class="mb-3">
          <label class="text-xs text-zinc-500 block mb-1">Icon</label>
          <div class="flex flex-wrap gap-2">
            ${ITEM_ICONS.map((ic) => `
              <label class="cursor-pointer">
                <input type="radio" name="icon" value="${ic}" class="sr-only" ${data.icon === ic ? "checked" : ""}>
                <div class="w-9 h-9 rounded-xl grid place-items-center border-2 transition-colors
                            ${data.icon === ic ? "border-zinc-900 dark:border-white bg-zinc-100 dark:bg-zinc-800" : "border-transparent hover:border-zinc-300"}">
                  <i data-lucide="${ic}" style="width:16px;height:16px"></i>
                </div>
              </label>`).join("")}
          </div>
        </div>

        <!-- Color -->
        <div class="mb-5">
          <label class="text-xs text-zinc-500 block mb-1">Color</label>
          <div class="flex flex-wrap gap-2">
            ${ITEM_COLORS.map((col) => `
              <label class="cursor-pointer">
                <input type="radio" name="color" value="${col}" class="sr-only" ${data.color === col ? "checked" : ""}>
                <div class="w-7 h-7 rounded-full border-2 transition-colors
                            ${data.color === col ? "border-zinc-900 dark:border-white" : "border-transparent"}"
                     style="background:${col}"></div>
              </label>`).join("")}
          </div>
        </div>

        <div class="flex items-center gap-2">
          ${editing ? `
            <button type="button" class="btn btn-outline text-rose-500"
                    onclick="window.__app.deleteRegularItem('${editing.id}')">
              <i data-lucide="trash-2"></i> Delete
            </button>` : ""}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i data-lucide="check"></i> Save
          </button>
        </div>
      </form>`;
    }
    #esc(s) {
      return (s || "").toString().replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]
      );
    }
  };

  // src/ui/modals/DayLogsModal.js
  var DayLogsModal = class {
    #store;
    #hijriService;
    #currencyService;
    constructor({ store, hijriService, currencyService }) {
      this.#store = store;
      this.#hijriService = hijriService;
      this.#currencyService = currencyService;
    }
    render({ date } = {}) {
      if (!date) return '<div class="p-5 text-sm text-zinc-500">No date specified.</div>';
      const s = this.#store.getState();
      const items = s.regularItems || [];
      const logs = (s.transactions || []).filter((t) => t.regularItemId && t.date === date);
      const hijriStr = (() => {
        try {
          return this.#hijriService.format(date);
        } catch {
          return "";
        }
      })();
      const logRows = logs.map((log) => {
        const item = items.find((i) => i.id === log.regularItemId);
        const cur = log.currency || s.user.homeCurrency;
        const qty = log.qty ?? 1;
        const unitAmt = log.unitAmount != null ? log.unitAmount : log.amount;
        return `
        <div class="flex items-center justify-between p-3 card mb-2">
          <div>
            <div class="text-sm font-medium">${this.#esc(item?.name || "Item")}</div>
            <div class="text-xs text-zinc-500">Qty ${qty} \xD7 ${this.#currencyService.formatMoney(unitAmt, cur)}</div>
          </div>
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm">${this.#currencyService.formatMoney(log.amount, cur)}</span>
            <button class="btn btn-ghost p-1 text-red-500"
              onclick="window.__app.deleteRegularLog('${this.#esc(log.id)}','${this.#esc(date)}')">
              <i data-lucide="trash-2" style="width:16px;height:16px"></i>
            </button>
          </div>
        </div>`;
      }).join("");
      const itemOptions = items.map((it) => {
        const price = it.defaultAmount ?? 0;
        const itCur = it.currency || s.user.homeCurrency;
        const priceDisplay = this.#currencyService.fromMinor(price, itCur);
        return `<option value="${this.#esc(it.id)}" data-price="${priceDisplay}" data-currency="${this.#esc(itCur)}">${this.#esc(it.name)}</option>`;
      }).join("");
      return `
      <div class="p-5" style="min-width:320px;max-width:480px">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="font-semibold">${this.#esc(date)}</div>
            ${hijriStr ? `<div class="text-xs text-zinc-500">${this.#esc(hijriStr)}</div>` : ""}
          </div>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        ${logs.length > 0 ? `<div class="mb-4">${logRows}</div>` : `<p class="text-sm text-zinc-500 mb-4">No entries for this day.</p>`}

        ${items.length > 0 ? `
        <div class="text-sm font-semibold mb-3">Add entry</div>
        <form onsubmit="window.__app.submitRegularLog(event,'${this.#esc(date)}')">
          <label class="block text-xs font-medium mb-1 text-zinc-500">Item</label>
          <select id="dayLogItem" name="itemId" class="select mb-3"
            onchange="window.__app.prefillRegularLog(this)" required>
            <option value="">\u2014 select \u2014</option>
            ${itemOptions}
          </select>
          <div class="flex gap-2 mb-3">
            <div class="flex-1">
              <label class="block text-xs font-medium mb-1 text-zinc-500">Qty</label>
              <input type="number" name="qty" id="dayLogQty" class="input"
                value="1" min="1" step="1" oninput="window.__app.updateRegularLogTotal()">
            </div>
            <div class="flex-1">
              <label class="block text-xs font-medium mb-1 text-zinc-500">Unit price</label>
              <input type="number" name="unitPrice" id="dayLogUnit" class="input"
                placeholder="0.00" min="0" step="any" oninput="window.__app.updateRegularLogTotal()">
            </div>
          </div>
          <label class="block text-xs font-medium mb-1 text-zinc-500">Total</label>
          <input type="number" name="total" id="dayLogTotal" class="input mb-4"
            placeholder="0.00" step="any" readonly>
          <button class="btn btn-primary w-full" type="submit">Add entry</button>
        </form>` : `<p class="text-sm text-zinc-500 mt-2">No regular items configured yet.</p>`}
      </div>`;
    }
    #esc(s) {
      return (s == null ? "" : String(s)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
    }
  };

  // src/ui/modals/CurrencySetupModal.js
  var CurrencySetupModal = class {
    #store;
    #hijri;
    #step;
    // 1 | 2
    constructor({ store }) {
      this.#store = store;
      this.#hijri = new HijriCalendarService();
      this.#step = 1;
    }
    /** Reset to step 1 (called each time the modal is opened). */
    onOpen() {
      this.#step = 1;
    }
    render() {
      return this.#step === 1 ? this.#renderStep1() : this.#renderStep2();
    }
    // ── Step 1: currency ───────────────────────────────────────────────
    #renderStep1() {
      const cur = this.#store.getState().user?.homeCurrency || "USD";
      const options = CURRENCIES.map(
        (c) => `<option value="${c}" ${c === cur ? "selected" : ""}>${c}</option>`
      ).join("");
      return `
      <div class="p-6" style="min-width:320px;max-width:420px">
        <!-- Step indicator -->
        <div class="flex items-center gap-2 mb-5">
          <div class="flex items-center gap-1.5">
            <div class="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs grid place-items-center font-bold">1</div>
            <div class="text-xs font-medium">Currency</div>
          </div>
          <div class="flex-1 h-px bg-zinc-200 dark:bg-zinc-700"></div>
          <div class="flex items-center gap-1.5">
            <div class="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-400 text-xs grid place-items-center font-bold">2</div>
            <div class="text-xs text-zinc-400">Calendar</div>
          </div>
        </div>

        <div class="w-12 h-12 rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 grid place-items-center text-xl font-bold mb-4">P</div>
        <h2 class="text-xl font-semibold mb-1">Welcome to Pocket!</h2>
        <p class="text-sm text-zinc-500 mb-5">Choose your home currency. All balances and reports will be shown in this currency.</p>

        <label class="block text-sm font-medium mb-1">Home currency</label>
        <select id="setupCurrency" class="select mb-6">${options}</select>

        <button class="btn btn-primary w-full" onclick="window.__app.currencySetupNext()">
          Next <i data-lucide="arrow-right"></i>
        </button>
      </div>`;
    }
    // ── Step 2: Hijri offset calibration ───────────────────────────────
    #renderStep2() {
      const u = this.#store.getState().user;
      const offset = u?.hijriOffset ?? 0;
      const todayHijri = this.#hijri.format(/* @__PURE__ */ new Date(), { long: true });
      return `
      <div class="p-6" style="min-width:320px;max-width:420px">
        <!-- Step indicator -->
        <div class="flex items-center gap-2 mb-5">
          <div class="flex items-center gap-1.5">
            <div class="w-6 h-6 rounded-full bg-emerald-500 text-white text-xs grid place-items-center">
              <i data-lucide="check" style="width:12px;height:12px"></i>
            </div>
            <div class="text-xs text-zinc-400">Currency</div>
          </div>
          <div class="flex-1 h-px bg-zinc-200 dark:bg-zinc-700"></div>
          <div class="flex items-center gap-1.5">
            <div class="w-6 h-6 rounded-full bg-zinc-900 text-white text-xs grid place-items-center font-bold">2</div>
            <div class="text-xs font-medium">Calendar</div>
          </div>
        </div>

        <div class="w-10 h-10 rounded-xl grid place-items-center mb-4" style="background:#0ea5e922;color:#0ea5e9">
          <i data-lucide="moon-star" style="width:22px;height:22px"></i>
        </div>
        <h2 class="text-xl font-semibold mb-1">Hijri date calibration</h2>
        <p class="text-sm text-zinc-500 mb-4">
          Pocket calculates the Hijri date automatically. If your local moon sighting
          puts it a day earlier or later, adjust it here.
        </p>

        <!-- Live date display -->
        <div class="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 mb-5 text-center">
          <div class="text-xs text-zinc-500 mb-1">Today shows as</div>
          <div class="text-lg font-semibold" id="setupHijriDisplay">${todayHijri}</div>
          ${offset !== 0 ? `<div class="text-xs mt-1 ${offset > 0 ? "text-amber-600" : "text-blue-600"}">
                 ${offset > 0 ? "+" : ""}${offset} day${Math.abs(offset) !== 1 ? "s" : ""} applied
               </div>` : `<div class="text-xs text-zinc-400 mt-1">Calculated date \xB7 no adjustment</div>`}
        </div>

        <!-- Stepper -->
        <div class="flex items-center gap-4 mb-2">
          <button class="btn btn-outline flex-1 text-xl font-bold justify-center py-3"
                  onclick="window.__app.adjustHijriOffset(-1)"
                  ${offset <= -7 ? "disabled" : ""}>\u2212</button>
          <div class="flex-1 text-center">
            <div class="text-3xl font-bold">${offset > 0 ? "+" : ""}${offset}</div>
            <div class="text-xs text-zinc-500">days</div>
          </div>
          <button class="btn btn-outline flex-1 text-xl font-bold justify-center py-3"
                  onclick="window.__app.adjustHijriOffset(+1)"
                  ${offset >= 7 ? "disabled" : ""}>+</button>
        </div>
        <div class="text-xs text-zinc-400 text-center mb-5">
          You can always change this later in Settings \u2192 Hijri calendar
        </div>

        <button class="btn btn-primary w-full" onclick="window.__app.saveCurrencySetup()">
          <i data-lucide="check"></i> Done \u2014 open Pocket
        </button>
      </div>`;
    }
    /** Called by app.js to advance from step 1 → step 2. */
    advanceToStep2() {
      this.#step = 2;
    }
    #esc(s) {
      return (s == null ? "" : String(s)).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
    }
  };

  // src/app.js
  var ACCOUNT_TYPE_KEYWORDS = {
    cash: ["cash", "wallet", "pocket", "petty"],
    card: ["credit", "card", "visa", "mastercard", "amex", "american express", "discover", "platinum"],
    savings: ["savings", "save", "hys", "high-yield", "reserve", "emergency", "rainy day"],
    invest: ["invest", "ira", "roth", "401k", "brokerage", "stocks", "crypto"],
    bank: []
  };
  var CATEGORY_KEYWORD_DEFAULTS = [
    { keys: ["food", "drink", "grocery", "restaurant", "dining", "meal", "cafe", "coffee", "snack", "pizza", "burger"], icon: "utensils", color: "#f97316" },
    { keys: ["transport", "transit", "uber", "lyft", "taxi", "gas", "fuel", "car", "metro", "bus", "train", "flight", "travel"], icon: "car", color: "#3b82f6" },
    { keys: ["shop", "clothing", "retail", "amazon", "walmart", "store", "apparel"], icon: "shopping-bag", color: "#ec4899" },
    { keys: ["health", "medical", "pharmacy", "doctor", "dental", "hospital", "vitamin"], icon: "heart-pulse", color: "#ef4444" },
    { keys: ["housing", "rent", "mortgage", "home", "maintenance"], icon: "home", color: "#a16207" },
    { keys: ["entertainment", "movies", "netflix", "spotify", "games", "disney", "concert", "music"], icon: "film", color: "#8b5cf6" },
    { keys: ["bills", "utility", "utilities", "electric", "internet", "wifi", "phone", "water"], icon: "receipt", color: "#0891b2" },
    { keys: ["education", "school", "tuition", "book", "course"], icon: "graduation-cap", color: "#10b981" },
    { keys: ["salary", "payroll", "wage", "income", "paycheck"], icon: "banknote", color: "#22c55e" },
    { keys: ["freelance", "contract", "gig", "consulting"], icon: "briefcase", color: "#14b8a6" },
    { keys: ["savings", "save", "deposit"], icon: "landmark", color: "#06b6d4" },
    { keys: ["transfer"], icon: "arrow-right-left", color: "#737373" },
    { keys: ["gift", "present"], icon: "gift", color: "#d946ef" },
    { keys: ["fitness", "gym", "sport", "workout"], icon: "dumbbell", color: "#84cc16" },
    { keys: ["baby", "child", "kid", "daycare"], icon: "baby", color: "#fb7185" },
    { keys: ["pet", "dog", "cat", "vet"], icon: "paw-print", color: "#d97706" }
  ];
  var Application = class _Application {
    // ── Singleton ──────────────────────────────────────────────────────────────
    static #instance = null;
    static getInstance() {
      if (!_Application.#instance) _Application.#instance = new _Application();
      return _Application.#instance;
    }
    // ── Core ───────────────────────────────────────────────────────────────────
    /** @type {Store}    */
    #store;
    /** @type {EventBus} */
    #bus;
    /** @type {Router}   */
    #router;
    // ── Domain services ────────────────────────────────────────────────────────
    /** @type {CurrencyService}      */
    #fx;
    /** @type {HijriCalendarService} */
    #hijri;
    /** @type {AccountService}       */
    #accounts;
    /** @type {CategoryService}      */
    #categories;
    /** @type {TransactionService}   */
    #transactions;
    /** @type {BudgetService}        */
    #budgets;
    /** @type {RecurringService}     */
    #recurring;
    /** @type {SyncService}          */
    #sync;
    /** @type {ThemeService}         */
    #themeService;
    /** @type {PaymentTypeService}   */
    #paymentTypeService;
    /** @type {ExchangeRateService}  */
    #fxRates;
    // ── UI components ──────────────────────────────────────────────────────────
    /** @type {Toast}      */
    #toast;
    /** @type {Modal}      */
    #modal;
    /** @type {Navigation} */
    #nav;
    // ── Views (lazy-created on first navigate) ─────────────────────────────────
    #views = (
      /** @type {Map<string,object>} */
      /* @__PURE__ */ new Map()
    );
    // ── Modals (registered instances) ─────────────────────────────────────────
    #txModal = null;
    // TransactionModal — kept for split-state access
    #familyModal = null;
    // FamilyModal — kept for pendingPerms access
    #debtModal = null;
    // DebtModal — kept for payment-mode routing
    #reconcileModal = null;
    // ReconcileModal — kept for ledger-sum access
    #dayLogsModal = null;
    // DayLogsModal
    #currencySetupModal = null;
    // CurrencySetupModal
    // ── Per-session UI state ──────────────────────────────────────────────────
    #reportRange = "30";
    #importPlan = null;
    #swipeTxId = null;
    #swipeStartX = 0;
    #swipeStartY = 0;
    #swipeLastX = 0;
    // updated on every move; used by swipeEnd (no event arg needed)
    #swipeDeltaX = 0;
    #swipeAxis = null;
    // 'x' | 'y' | null
    #swipeTriggered = false;
    #swipeShareIndex = -1;
    #swipeIsOwnContrib = false;
    #swipeWrapper = null;
    // the .tx-swipe-wrapper element, stored on start
    // ── Private constructor (use getInstance()) ────────────────────────────────
    constructor() {
      if (_Application.#instance) throw new Error("Use Application.getInstance()");
      this.#store = Store.getInstance();
      this.#bus = EventBus.getInstance();
      this.#router = Router.getInstance();
      this.#fx = new CurrencyService();
      this.#hijri = new HijriCalendarService();
      this.#accounts = new AccountService();
      this.#categories = new CategoryService();
      this.#transactions = new TransactionService();
      this.#budgets = new BudgetService();
      this.#recurring = new RecurringService();
      this.#sync = new SyncService();
      this.#themeService = new ThemeService(this.#store);
      this.#paymentTypeService = new PaymentTypeService(this.#store);
      this.#fxRates = new ExchangeRateService();
      this.#toast = new Toast();
      this.#modal = new Modal();
      this.#nav = new Navigation();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Initialisation
    // ──────────────────────────────────────────────────────────────────────────
    /** Boot the application. Call once after DOMContentLoaded. */
    async init() {
      this.#store.setDeriveHook(() => this.#accounts.recompute());
      this.#store.init(() => SeedFactory.create(), (s) => StateMigrator.migrate(s));
      this.#ensureUserDefaults();
      this.#accounts.recompute();
      if (this.#store.repositoryCorrupted) {
        this.#bus.emit("toast", { message: "Saved data was unreadable \u2014 a backup was kept (pocket.v1.corrupt)" });
      }
      this.#fxRates.seedFromState();
      this.#fxRates.refresh().catch(() => {
      });
      this.#recurring.process();
      this.#applyTheme();
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        if (this.#store.getState().user.theme === "system") this.#applyTheme();
      });
      window.__app = this;
      const container = document.getElementById("app");
      this.#toast.mount(container);
      this.#modal.mount(container);
      this.#nav.mount({
        onNavigate: (id) => this.navigate(id),
        onAdd: () => this.openModal("transaction", {}),
        onMore: () => this.openModal("more", {}),
        onSignOut: () => this.signOut()
      });
      this.#txModal = new TransactionModal();
      this.#familyModal = new FamilyModal();
      this.#debtModal = new DebtModal();
      this.#reconcileModal = new ReconcileModal();
      this.#dayLogsModal = new DayLogsModal({
        store: this.#store,
        hijriService: this.#hijri,
        currencyService: this.#fx
      });
      this.#currencySetupModal = new CurrencySetupModal({ store: this.#store });
      this.#modal.register("transaction", this.#txModal);
      this.#modal.register("account", new AccountModal());
      this.#modal.register("category", new CategoryModal());
      this.#modal.register("budget", new BudgetModal());
      this.#modal.register("settings", new SettingsModal());
      this.#modal.register("csv", new CsvModal());
      this.#modal.register("debt", this.#debtModal);
      this.#modal.register("debtPayment", this.#debtModal);
      this.#modal.register("familyMember", this.#familyModal);
      this.#modal.register("auth", new AuthModal());
      this.#modal.register("regularItem", new RegularItemModal());
      this.#modal.register("reconcile", this.#reconcileModal);
      this.#modal.register("dayLogs", this.#dayLogsModal);
      this.#modal.register("currencySetup", this.#currencySetupModal);
      this.#bus.on("route:changed", ({ route }) => this.#renderView(route));
      this.#bus.on("toast", ({ message }) => this.#toast.show(message));
      this.#bus.on("state:changed", () => this.#render());
      this.#bus.on("auth:changed", ({ user, showSignIn }) => {
        this.#nav.renderAuthPill(user ?? null);
        if (!user) {
          this.#render();
          if (showSignIn) {
            setTimeout(() => {
              if (!this.#sync.currentUser) this.openModal("auth");
            }, 300);
          }
        }
      });
      this.#render();
      if (this.#sync.init()) {
        this.#sync.restoreSession().then((result = {}) => {
          const { needsSignIn, isFirstSignIn } = result;
          this.#render();
          this.#nav.renderAuthPill(this.#sync.currentUser);
          if (isFirstSignIn) {
            setTimeout(() => this.openModal("currencySetup"), 600);
          }
          if (needsSignIn) {
            setTimeout(() => {
              if (!this.#sync.currentUser) this.openModal("auth");
            }, 300);
          }
        });
      }
      if (window.location.hash === "#signin") {
        history.replaceState(null, "", window.location.pathname);
        setTimeout(() => {
          if (!this.#sync.currentUser) this.openModal("auth");
        }, 500);
      }
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Navigation
    // ──────────────────────────────────────────────────────────────────────────
    navigate(id) {
      if (id === "__add") return this.openModal("transaction", {});
      if (id === "__more") return this.#openMoreMenu();
      this.#router.navigate(id);
      this.#render();
    }
    /** Open a bottom-sheet "More" menu showing nav items not in the mobile tab bar. */
    #openMoreMenu() {
      const MORE_ITEMS = [
        { id: "accounts", label: "Accounts", icon: "wallet" },
        { id: "budgets", label: "Budgets", icon: "target" },
        { id: "debts", label: "Debts", icon: "hand-coins" },
        { id: "categories", label: "Categories", icon: "tags" },
        { id: "reports", label: "Reports", icon: "pie-chart" },
        { id: "family", label: "Family", icon: "users" }
      ];
      const items = MORE_ITEMS.map((n) => `
      <button type="button"
              onclick="window.__app.closeModal();window.__app.navigate('${n.id}')"
              class="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl
                     bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700
                     transition-colors text-zinc-700 dark:text-zinc-200">
        <i data-lucide="${n.icon}" style="width:24px;height:24px"></i>
        <span class="text-xs font-medium">${n.label}</span>
      </button>`).join("");
      this.#modal.open("_raw", {
        html: `
        <div class="p-5" style="min-width:320px;max-width:420px">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-base font-semibold">More</h3>
            <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
              <i data-lucide="x"></i>
            </button>
          </div>
          <div class="grid grid-cols-3 gap-3">
            ${items}
          </div>
          <div class="pt-3 border-t border-zinc-200 dark:border-zinc-800 mt-2">
            <button class="btn btn-outline w-full gap-2"
              onclick="window.__app.closeModal(); setTimeout(()=>window.__app.openModal('settings',{}),50)">
              <i data-lucide="settings"></i> Settings
            </button>
          </div>
        </div>`
      });
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Modal operations
    // ──────────────────────────────────────────────────────────────────────────
    openModal(name, opts = {}) {
      if (name === "debtPayment") {
        this.#modal.open("debtPayment", { ...opts, mode: "payment" });
      } else {
        this.#modal.open(name, opts);
      }
      lucide?.createIcons?.();
    }
    closeModal() {
      this.#modal.close();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Sync helpers (exposed to modals / nav)
    // ──────────────────────────────────────────────────────────────────────────
    isManagedMode() {
      return this.#sync.isManagedMode();
    }
    getSbUser() {
      return this.#sync.currentUser ?? null;
    }
    async signInWithGoogle() {
      await this.#sync.signInWithGoogle();
    }
    /**
     * Sign out — always succeeds locally even if the Supabase revocation request
     * fails (network down, session already expired, etc.).
     * The auth pill updates instantly; the sign-in modal is shown automatically
     * via the auth:changed event with showSignIn: true.
     */
    async signOut() {
      try {
        await this.#sync.signOut();
      } catch (_) {
      }
      this.#render();
    }
    setSbUrl(v) {
      const s = this.#store.getState();
      s.user.supabaseUrl = v;
      this.#store.persist();
    }
    setSbKey(v) {
      const s = this.#store.getState();
      s.user.supabaseKey = v;
      this.#store.persist();
    }
    connectSupabase() {
      if (this.#sync.init()) {
        this.#toast.show("Supabase connected \u2014 sign in to sync");
        this.openModal("auth", {});
      } else {
        this.#toast.show("Invalid URL or key");
      }
    }
    copySql() {
      const el = document.querySelector(".js-sql-block");
      if (!el) return;
      navigator.clipboard.writeText(el.textContent).then(() => this.#toast.show("SQL copied"));
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Settings mutations
    // ──────────────────────────────────────────────────────────────────────────
    setHomeCurrency(v) {
      this.#store.getState().user.homeCurrency = v;
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show("Home currency: " + v);
    }
    setDefaultCurrency(v) {
      this.#store.getState().user.defaultCurrency = v;
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show("Default currency: " + v);
    }
    setDateFormat(v) {
      this.#store.getState().user.dateFormat = v;
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show("Date format: " + v);
    }
    toggleTheme() {
      const next = this.#themeService.toggle();
      this.#toast.show(`Theme: ${next}`);
      this.#render();
    }
    setTheme(v) {
      this.#themeService.set(v);
      this.closeModal();
      this.#render();
      this.#toast.show(`Theme: ${v}`);
    }
    get paymentTypeService() {
      return this.#paymentTypeService;
    }
    addCustomPaymentType(sel) {
      const val = sel.value;
      if (val !== "__add_payment__") {
        sel.dataset.prev = val;
        return;
      }
      const name = prompt("Custom payment type name:");
      if (!name?.trim()) {
        sel.value = sel.dataset.prev || "card";
        return;
      }
      const added = this.#paymentTypeService.addCustom(name);
      if (added) {
        sel.dataset.prev = added;
        this.#modal.refresh();
      }
    }
    toggleHijri() {
      const u = this.#store.getState().user;
      u.showHijri = !u.showHijri;
      this.#store.persist();
      this.closeModal();
      this.#render();
    }
    /**
     * Adjust the Hijri date offset by delta days (−1 or +1 from the stepper).
     * Clamps to the range −7 … +7.
     * Immediately re-renders so the preview updates live.
     * @param {number} delta
     */
    adjustHijriOffset(delta) {
      const s = this.#store.getState();
      const current = s.user.hijriOffset ?? 0;
      s.user.hijriOffset = Math.max(-7, Math.min(7, current + delta));
      this.#store.persist();
      this.#modal.refresh();
    }
    /**
     * Explicitly set the Hijri offset (called from the stepper input).
     * @param {number} value
     */
    setHijriOffset(value) {
      const n = parseInt(value, 10);
      if (isNaN(n)) return;
      const s = this.#store.getState();
      s.user.hijriOffset = Math.max(-7, Math.min(7, n));
      this.#store.persist();
      this.#modal.refresh();
    }
    setCalendarMode(v) {
      this.#store.getState().user.calendarMode = v;
      this.#store.persist();
      this.#render();
      this.#toast.show(`Calendar mode: ${v}`);
    }
    setGeminiKey(v) {
      this.#store.getState().user.geminiApiKey = v;
      this.#store.persist();
    }
    /**
     * Explicit "Save" for the AI key — persists the current input value and gives
     * the user clear confirmation that the app has accepted it (the field also
     * autosaves on input, but the button removes the "did it take?" doubt).
     */
    saveGeminiKey() {
      const inp = document.getElementById("geminiKeyInput");
      const v = (inp?.value || "").trim();
      this.#store.getState().user.geminiApiKey = v;
      this.#store.persist();
      this.#modal.refresh?.();
      lucide?.createIcons?.();
      if (!v) {
        this.#toast.show("API key cleared");
      } else if (!/^AIza[\w-]{10,}$/.test(v)) {
        this.#toast.show("Saved \u2014 but this doesn\u2019t look like a Google AI key");
      } else {
        this.#toast.show("\u2713 API key saved \u2014 receipt scanning enabled");
      }
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Transaction CRUD
    // ──────────────────────────────────────────────────────────────────────────
    async submitTx(event, id) {
      event.preventDefault();
      const fd = new FormData(event.target);
      const data = Object.fromEntries(fd.entries());
      const state = this.#store.getState();
      const sharedMode = this.#txModal?.sharedTxMode;
      const allShared = this.#sync.sharedData || [];
      const sharedMatch = !sharedMode && allShared.find(
        (s) => (s.accounts || []).some((a) => a.id === data.accountId)
      );
      if ((sharedMode || sharedMatch) && !id) {
        const currency2 = data.currency;
        const minor2 = this.#fx.toMinor(data.amount, currency2);
        const sharedAcc = sharedMode ? allShared[sharedMode.shareIndex] : sharedMatch;
        if (!sharedAcc?._ownerId) return this.#toast.show("Shared account not found");
        const accountId = sharedMode ? sharedMode.accountId || data.accountId : data.accountId;
        const ownerHome = sharedAcc.homeCurrency || state.user.homeCurrency;
        const tx = {
          id: IdGenerator.generate("tx"),
          accountId,
          categoryId: data.categoryId || null,
          amount: minor2,
          currency: currency2,
          exchangeRate: (RATES[currency2] || 1) / (RATES[ownerHome] || 1),
          refAmount: this.#fx.convert(minor2, currency2, ownerHome),
          payee: data.payee || "",
          note: data.note || "",
          date: data.date,
          hijriDate: this.#hijri.toHijri(data.date),
          type: data.type || "expense",
          paymentType: data.paymentType || "card",
          recordState: "cleared",
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          addedBy: this.#sync.currentUser?.email || null
        };
        try {
          await this.#sync.submitContribution(sharedAcc._ownerId, tx);
          this.closeModal();
          this.#toast.show("Transaction submitted");
          this.navigateToSharedAccount(sharedMode?.shareIndex ?? 0, accountId);
          this.#sync.scheduleSharesRefresh(3e3);
          this.#sync.scheduleSharesRefresh(8e3);
        } catch (e) {
          this.#toast.show("Failed to submit: " + (e.message || e));
        }
        return;
      }
      const currency = data.currency;
      const minor = this.#fx.toMinor(data.amount, currency);
      const exchRate = (RATES[currency] || 1) / (RATES[state.user.homeCurrency] || 1);
      const refAmt = this.#fx.convert(minor, currency, state.user.homeCurrency);
      let xfer = null;
      if (data.type === "transfer") {
        if (!data.accountId || !data.transferToAccountId || data.accountId === data.transferToAccountId) {
          return this.#toast.show("Pick two different accounts");
        }
        const toAcc = state.accounts.find((a) => a.id === data.transferToAccountId);
        if (!toAcc) return this.#toast.show("Pick a destination account");
        const toCcy = toAcc.currency;
        let rate = Number(data.transferRate);
        if (!isFinite(rate) || rate <= 0) rate = (RATES[toCcy] || 1) / (RATES[currency] || 1);
        const dstMinor = currency === toCcy ? minor : this.#fx.toMinor(this.#fx.fromMinor(minor, currency) * rate, toCcy);
        xfer = { rate, toCcy, dstMinor };
      }
      let splits = null;
      const modal = this.#txModal;
      if (modal?.splitsEnabled && data.type !== "transfer") {
        const currentSplits = modal.splits || [];
        const cleaned = [];
        for (let i = 0; i < currentSplits.length; i++) {
          const cv = fd.get(`split_cat_${i}`);
          const ac = fd.get(`split_acc_${i}`);
          const av = fd.get(`split_amt_${i}`);
          const amt = this.#fx.toMinor(Number(av || 0), currency);
          if (amt > 0) cleaned.push({ categoryId: cv || null, accountId: ac || data.accountId, amount: amt });
        }
        if (!cleaned.length) return this.#toast.show("Add at least one split with an amount");
        const missingAcc = cleaned.find((s) => !s.accountId || !state.accounts.find((a) => a.id === s.accountId));
        if (missingAcc) return this.#toast.show("Pick an account for every split");
        const sum = cleaned.reduce((s, x) => s + x.amount, 0);
        if (Math.abs(sum - minor) > 1) {
          return this.#toast.show(
            `Splits must add up to ${this.#fx.formatMoney(minor, currency)} (currently ${this.#fx.formatMoney(sum, currency)})`
          );
        }
        splits = cleaned;
        data.accountId = splits[0].accountId;
      }
      let recurring = null;
      if (data.type !== "transfer" && fd.get("recurringEnabled")) {
        recurring = {
          rule: fd.get("recurringRule") || "monthly",
          interval: Math.max(1, Number(fd.get("recurringInterval")) || 1),
          until: fd.get("recurringUntil") || null
        };
      }
      let txAcctMinor;
      if (data.type !== "transfer" && !splits) {
        const accForFx = state.accounts.find((a) => a.id === data.accountId);
        const txRate = parseFloat(data.txFxRate);
        if (accForFx && accForFx.currency !== currency && isFinite(txRate) && txRate > 0) {
          txAcctMinor = this.#fx.toMinor(this.#fx.fromMinor(minor, currency) * txRate, accForFx.currency);
        }
      }
      if (id) {
        const tx = state.transactions.find((x) => x.id === id);
        if (!tx) return;
        if (data.type === "transfer" && tx.type === "transfer" && tx.transferPairId) {
          const pair = state.transactions.find((x) => x.id === tx.transferPairId);
          Object.assign(tx, {
            accountId: data.accountId,
            categoryId: null,
            amount: minor,
            currency,
            exchangeRate: exchRate,
            refAmount: refAmt,
            payee: data.payee || "Transfer",
            note: data.note,
            date: data.date,
            paymentType: "transfer",
            type: "transfer",
            splits: null,
            transferRate: xfer?.rate ?? null,
            transferDir: "out",
            // Amount/currency changed → drop the frozen impact so it re-freezes.
            acctMinor: void 0
          });
          if (pair) {
            Object.assign(pair, {
              accountId: data.transferToAccountId,
              categoryId: null,
              amount: xfer ? xfer.dstMinor : minor,
              currency: xfer ? xfer.toCcy : currency,
              exchangeRate: (RATES[xfer?.toCcy || currency] || 1) / (RATES[state.user.homeCurrency] || 1),
              refAmount: this.#fx.convert(xfer ? xfer.dstMinor : minor, xfer ? xfer.toCcy : currency, state.user.homeCurrency),
              payee: data.payee || "Transfer",
              note: data.note,
              date: data.date,
              paymentType: "transfer",
              type: "transfer",
              splits: null,
              transferRate: xfer?.rate ?? null,
              transferDir: "in",
              acctMinor: void 0
            });
          }
        } else {
          this.#transactions.update(id, {
            accountId: data.accountId,
            categoryId: splits ? null : data.categoryId || null,
            amount: minor,
            currency,
            exchangeRate: exchRate,
            refAmount: refAmt,
            payee: data.payee,
            note: data.note,
            date: data.date,
            hijriDate: this.#hijri.toHijri(data.date),
            // refresh snapshot when date changes
            paymentType: data.paymentType,
            type: data.type,
            splits,
            recurring,
            ...txAcctMinor !== void 0 ? { acctMinor: txAcctMinor } : {}
          });
        }
      } else {
        if (data.type === "transfer") {
          const fromId = IdGenerator.generate("tx");
          const toId = IdGenerator.generate("tx");
          const toCcy = xfer?.toCcy ?? currency;
          const dst = xfer?.dstMinor ?? minor;
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const txFrom = {
            id: fromId,
            accountId: data.accountId,
            categoryId: null,
            amount: minor,
            currency,
            exchangeRate: exchRate,
            refAmount: refAmt,
            payee: data.payee || "Transfer",
            note: data.note,
            date: data.date,
            hijriDate: this.#hijri.toHijri(data.date),
            paymentType: "transfer",
            recordState: "cleared",
            type: "transfer",
            transferPairId: toId,
            transferRate: xfer?.rate ?? null,
            transferDir: "out",
            tags: [],
            createdAt: now,
            addedBy: this.#sync.currentUser?.email || null
          };
          const txTo = {
            id: toId,
            accountId: data.transferToAccountId,
            categoryId: null,
            amount: dst,
            currency: toCcy,
            exchangeRate: (RATES[toCcy] || 1) / (RATES[state.user.homeCurrency] || 1),
            refAmount: this.#fx.convert(dst, toCcy, state.user.homeCurrency),
            payee: data.payee || "Transfer",
            note: data.note,
            date: data.date,
            hijriDate: this.#hijri.toHijri(data.date),
            paymentType: "transfer",
            recordState: "cleared",
            type: "transfer",
            transferPairId: fromId,
            transferRate: xfer?.rate ?? null,
            transferDir: "in",
            tags: [],
            createdAt: now,
            addedBy: this.#sync.currentUser?.email || null
          };
          state.transactions.push(txFrom, txTo);
        } else {
          this.#transactions.create({
            accountId: data.accountId,
            categoryId: splits ? null : data.categoryId || null,
            amount: minor,
            currency,
            exchangeRate: exchRate,
            refAmount: refAmt,
            payee: data.payee,
            note: data.note,
            date: data.date,
            paymentType: data.paymentType,
            type: data.type,
            splits,
            recurring,
            acctMinor: txAcctMinor,
            addedBy: this.#sync.currentUser?.email || null
          });
          if (data.payee && !splits && data.categoryId) {
            if (!state.merchantCategories) state.merchantCategories = {};
            state.merchantCategories[data.payee.toLowerCase()] = data.categoryId;
          }
        }
      }
      if (recurring) this.#recurring.process();
      this.#store.flush();
      this.closeModal();
      this.#render();
      this.#toast.show(id ? "Transaction updated" : "Transaction added");
      this.#sync.schedulePush?.();
    }
    deleteTx(id) {
      if (!confirm("Delete this transaction?")) return;
      if (!this.#transactions.find(id)) return;
      this.#transactions.delete(id);
      this.closeModal();
      this.#render();
      this.#toast.show("Transaction deleted");
      this.#sync.schedulePush?.();
    }
    /**
     * Member-side delete for a transaction they contributed to a shared account.
     * Sends a delete-marker contribution row to the owner and applies an
     * optimistic removal to the local shared view immediately.
     */
    async deleteSharedContrib(shareIndex, txId) {
      if (!confirm("Delete this transaction?")) return;
      const state = this.#store.getState();
      const share = (state._sharedData || [])[shareIndex];
      if (!share?._ownerId) return this.#toast.show("Shared account not found");
      try {
        await this.#sync.deleteContribution(share._ownerId, txId);
        this.#render();
        this.#toast.show("Transaction deleted");
      } catch (e) {
        this.#toast.show("Failed to delete: " + (e.message || e));
      }
    }
    // Bulk delete — collects selectedIds from whichever view is active
    bulkDeleteTx() {
      const view = this.#views.get(this.#router.current);
      const ids = view?.selectedIds ?? /* @__PURE__ */ new Set();
      if (!ids.size) return;
      if (!confirm(`Delete ${ids.size} transaction${ids.size === 1 ? "" : "s"}?`)) return;
      const count = ids.size;
      this.#transactions.bulkDelete([...ids]);
      if (view?.clearMultiSelect) view.clearMultiSelect();
      this.#render();
      this.#toast.show(`${count} transactions deleted`);
      this.#sync.schedulePush?.();
    }
    // Shared (family) tx ops — delegate to SyncService.
    // Full-access members delete another member's tx by sending the owner a
    // delete-marker contribution (SyncService.deleteContribution), which also
    // applies an optimistic local revert.
    async deleteSharedTx(shareIndex, txId) {
      if (!confirm("Delete this transaction?")) return;
      const share = this.#sync.sharedData?.[shareIndex];
      if (!share?._ownerId) return this.#toast.show("Shared account not found");
      try {
        await this.#sync.deleteContribution(share._ownerId, txId);
        this.#render();
        this.#toast.show("Transaction deleted");
      } catch (e) {
        this.#toast.show("Failed to delete: " + (e.message || e));
      }
    }
    /** Submit a delete contribution for a shared-account transaction. */
    async deleteSharedTxContrib(shareIndex, txId) {
      if (!confirm("Delete this transaction from the shared account?")) return;
      const sharedData = this.#sync.sharedData;
      const share = sharedData?.[shareIndex];
      if (!share?._ownerId) return this.#toast.show("Shared account not found");
      try {
        await this.#sync.deleteContribution(share._ownerId, txId);
        this.closeModal();
        this.#toast.show("Delete request submitted to owner");
      } catch (e) {
        this.#toast.show("Failed: " + (e.message || e));
      }
    }
    openSharedTxModal(shareIndex, accountId) {
      this.openModal("transaction", { sharedTxMode: { shareIndex, accountId } });
    }
    openSharedTxEdit(shareIndex, accountId, txId) {
      this.openModal("transaction", { sharedTxMode: { shareIndex, accountId, editTxId: txId } });
    }
    /**
     * Called by submitTx after a shared-account tx edit succeeds.
     * Navigates to the shared account detail so the member can see the updated tx.
     * The shareIndex/accountId are passed so we can set the correct view state.
     */
    navigateToSharedAccount(shareIndex, accountId) {
      const v = this.#getOrCreateView("accountDetail");
      v.setAccount(accountId, { shareIndex });
      this.#router.navigate("accountDetail");
      this.#render();
    }
    // ── Multi-select (Transactions view) ────────────────────────────────────
    toggleMultiSelect() {
      const v = this.#views.get("transactions");
      v?.toggleMultiSelect?.();
      this.#render();
    }
    selectAllTx() {
      const v = this.#views.get("transactions");
      v?.selectAll?.();
      this.#render();
    }
    deselectAllTx() {
      const v = this.#views.get("transactions");
      v?.deselectAll?.();
      this.#render();
    }
    toggleTxSelection(id) {
      const v = this.#views.get("transactions");
      v?.toggleSelection?.(id);
      this.#render();
    }
    // ── Multi-select (Account detail view) ──────────────────────────────────
    toggleAccountMultiSelect() {
      const v = this.#views.get("accountDetail");
      v?.toggleMultiSelect?.();
      this.#render();
    }
    selectAllAccTx() {
      const v = this.#views.get("accountDetail");
      v?.selectAll?.();
      this.#render();
    }
    deselectAllAccTx() {
      const v = this.#views.get("accountDetail");
      v?.deselectAll?.();
      this.#render();
    }
    bulkDeleteAccTx() {
      const v = this.#views.get("accountDetail");
      if (!v) return;
      const ids = v.selectedIds ?? /* @__PURE__ */ new Set();
      if (!ids.size) return;
      if (!confirm(`Delete ${ids.size} transaction${ids.size === 1 ? "" : "s"}?`)) return;
      const count = ids.size;
      this.#transactions.bulkDelete([...ids]);
      v.clearMultiSelect?.();
      this.#render();
      this.#toast.show(`${count} transactions deleted`);
      this.#sync.schedulePush?.();
    }
    /** Bulk delete selected transactions in a shared account view. */
    async bulkDeleteSharedAccTx(shareIndex) {
      const v = this.#views.get("accountDetail");
      if (!v) return;
      const ids = [...v.selectedIds ?? /* @__PURE__ */ new Set()];
      if (!ids.length) return;
      if (!confirm(`Delete ${ids.length} transaction${ids.length === 1 ? "" : "s"}?`)) return;
      const state = this.#store.getState();
      const share = (state._sharedData || [])[shareIndex];
      if (!share?._ownerId) {
        this.#toast.show("Shared account not found");
        return;
      }
      let done = 0, failed = 0;
      for (const txId of ids) {
        try {
          await this.#sync.deleteContribution(share._ownerId, txId);
          done++;
        } catch (_) {
          failed++;
        }
      }
      v.clearMultiSelect?.();
      this.#render();
      if (failed) this.#toast.show(`${done} deleted, ${failed} failed`);
      else this.#toast.show(`${done} transaction${done > 1 ? "s" : ""} deleted`);
    }
    // ── Transaction filters ──────────────────────────────────────────────────
    txFilterToggle(field, value) {
      const v = this.#views.get("transactions");
      v?.toggleFilterItem?.(field, value);
      this.#render();
    }
    txFilterSet(key, value) {
      const v = this.#views.get("transactions");
      v?.setFilter?.(key, value);
      this.#render();
    }
    txFilterSetRange(from, to) {
      const v = this.#views.get("transactions");
      v?.setFilter?.("dateFrom", from);
      v?.setFilter?.("dateTo", to);
      v?.setFilter?.("range", "custom");
      this.#render();
    }
    /**
     * Clear transaction filters.
     * @param {'dates'|'amounts'|undefined} group  Omit to clear everything.
     */
    txFilterClear(group) {
      const v = this.#views.get("transactions");
      if (!v) return;
      if (group === "dates") {
        v.setFilter?.("dateFrom", "");
        v.setFilter?.("dateTo", "");
      } else if (group === "amounts") {
        v.setFilter?.("amountMin", "");
        v.setFilter?.("amountMax", "");
      } else {
        v.clearFilters?.();
      }
      this.#render();
    }
    /** Alias used by "Clear all filters" buttons in TransactionsView. */
    clearTxFilters() {
      this.txFilterClear();
    }
    toggleTxFilterPanel() {
      const v = this.#views.get("transactions");
      v?.toggleFilterPanel?.();
      this.#render();
    }
    // ── Transaction modal helpers ────────────────────────────────────────────
    toggleSplits() {
      this.#txModal?.toggleSplits?.();
      this.#modal.refresh();
      lucide?.createIcons?.();
    }
    addSplit(defaultAccountId = null) {
      this.#txModal?.addSplit?.(defaultAccountId || document.querySelector("[name=accountId]")?.value || null);
      this.#modal.refresh();
      lucide?.createIcons?.();
    }
    removeSplit(i) {
      this.#txModal?.removeSplit?.(i);
      this.#modal.refresh();
      lucide?.createIcons?.();
    }
    setSplitAmount(i, val, currency) {
      this.#txModal?.setSplitAmount?.(i, val, currency);
    }
    setSplitField(i, field, val) {
      this.#txModal?.setSplitField?.(i, field, val);
    }
    /**
     * Lightweight DOM patch for the split tracker bar — called by oninput on each
     * split amount field.  Patches only #splitTotalBar and #splitDiffLine so focus
     * is never lost (no full modal re-render).
     */
    updateSplitTotal() {
      const modal = this.#txModal;
      if (!modal) return;
      const barEl = document.getElementById("splitTotalBar");
      const diffEl = document.getElementById("splitDiffLine");
      if (!barEl && !diffEl) return;
      const form = document.getElementById("txForm");
      const currency = form?.elements?.currency?.value || this.#store.getState().user.defaultCurrency || "USD";
      const totalMinor = this.#fx.toMinor(Number(form?.elements?.amount?.value || 0), currency);
      const splits = modal.splits || [];
      let sumMinor = 0;
      for (let i = 0; i < splits.length; i++) {
        const v = form?.elements?.[`split_amt_${i}`]?.value;
        sumMinor += this.#fx.toMinor(Number(v || 0), currency);
      }
      const diff = totalMinor - sumMinor;
      const diffAbs = Math.abs(diff);
      const sumFmt = this.#fx.formatMoney(sumMinor, currency);
      const totFmt = this.#fx.formatMoney(totalMinor, currency);
      if (barEl) {
        barEl.innerHTML = `
        <div class="text-xs text-zinc-500">Split total</div>
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">${sumFmt}</span>
          <span class="text-xs text-zinc-400">of</span>
          <span class="text-sm font-semibold">${totFmt}</span>
        </div>`;
      }
      if (diffEl) {
        if (diffAbs < 1) {
          diffEl.innerHTML = `<div class="flex items-center gap-1 text-xs mt-1 text-emerald-500"><i data-lucide="check" style="width:11px;height:11px"></i> Splits match total</div>`;
        } else {
          const color = diff < 0 ? "text-rose-500" : "text-amber-500";
          const label = diff < 0 ? `${this.#fx.formatMoney(diffAbs, currency)} over` : `${this.#fx.formatMoney(diffAbs, currency)} remaining`;
          diffEl.innerHTML = `<div class="flex items-center gap-1 text-xs mt-1"><span class="${color} font-medium">${label}</span></div>`;
        }
        lucide?.createIcons?.();
      }
    }
    /**
     * Switch transaction type while preserving all current form values — payee,
     * note, date, payment, amount, and split state.
     */
    setTxType(type) {
      const form = document.getElementById("txForm");
      const snapshot = form ? Object.fromEntries(new FormData(form).entries()) : {};
      snapshot.type = type;
      snapshot.amount = Number(snapshot.amount) || 0;
      if (form?.elements?.recurringEnabled?.checked) {
        snapshot.recurring = {
          rule: form.elements.recurringRule?.value || "monthly",
          interval: Number(form.elements.recurringInterval?.value) || 1,
          until: form.elements.recurringUntil?.value || null
        };
      }
      const savedSharedMode = this.#txModal?.sharedTxMode;
      this.#txModal?.setType?.(type);
      this.#modal.refresh();
      lucide?.createIcons?.();
      if (form && snapshot.payee) {
        const el = document.querySelector("[name=payee]");
        if (el) el.value = snapshot.payee;
      }
      if (form && snapshot.note) {
        const el = document.querySelector("[name=note]");
        if (el) el.value = snapshot.note;
      }
      if (form && snapshot.date) {
        const el = document.querySelector("[name=date]");
        if (el) el.value = snapshot.date;
      }
      if (form && snapshot.paymentType) {
        const el = document.querySelector("[name=paymentType]");
        if (el) el.value = snapshot.paymentType;
      }
    }
    toggleRecurringFields() {
      const el = document.getElementById("recurringFields");
      const inp = document.getElementById("recurringEnabled");
      if (el && inp) el.classList.toggle("hidden", !inp.checked);
    }
    /**
     * Keyword + merchant-learning category suggestion shown below the payee field.
     * Learned mappings (state.merchantCategories) take priority over keyword hints.
     */
    suggestCategory(payee) {
      const el = document.getElementById("catSuggest");
      if (!el) return;
      if (!payee || payee.length < 2) {
        el.innerHTML = "";
        return;
      }
      const state = this.#store.getState();
      const p = payee.toLowerCase();
      const learned = state.merchantCategories?.[p];
      if (learned) {
        const cat = state.categories.find((c) => c.id === learned);
        if (cat) {
          el.innerHTML = `<i data-lucide="sparkles" style="width:12px;height:12px;display:inline"></i>
          Suggested: <button type="button" class="underline"
            onclick="window.__app.applySuggestedCategory('${cat.id}')">
            ${this.#esc(cat.name)}
          </button> <span class="text-zinc-500">(learned)</span>`;
          lucide?.createIcons?.();
          return;
        }
      }
      const KEYWORDS = {
        "Food & Drink": ["food", "market", "grocery", "starbucks", "coffee", "chipotle", "trader", "whole foods", "restaurant", "cafe", "pizza", "burger"],
        "Transport": ["uber", "lyft", "shell", "gas", "fuel", "metro", "taxi", "parking", "transit"],
        "Shopping": ["amazon", "h&m", "zara", "target", "walmart", "store", "shop", "clothing"],
        "Entertainment": ["netflix", "spotify", "cinema", "movie", "game", "disney", "hbo"],
        "Health": ["pharmacy", "walgreens", "cvs", "clinic", "doctor", "dentist"],
        "Housing": ["rent", "mortgage", "landlord"],
        "Bills": ["electric", "internet", "wifi", "phone", "utility", "water"],
        "Education": ["coursera", "udemy", "school", "tuition", "book"]
      };
      for (const [name, words] of Object.entries(KEYWORDS)) {
        if (words.some((w) => p.includes(w))) {
          const cat = state.categories.find((c) => c.name === name);
          if (cat) {
            el.innerHTML = `<i data-lucide="sparkles" style="width:12px;height:12px;display:inline"></i>
            Suggested: <button type="button" class="underline"
              onclick="window.__app.applySuggestedCategory('${cat.id}')">
              ${this.#esc(cat.name)}
            </button> <span class="text-zinc-500">(AI \xB7 0.86 conf)</span>`;
            lucide?.createIcons?.();
            return;
          }
        }
      }
      el.innerHTML = "";
    }
    /** Apply a category suggestion — sets the category select in the open tx modal. */
    applySuggestedCategory(id) {
      const sel = document.querySelector("select[name=categoryId]");
      if (sel) {
        sel.value = id;
        this.#toast.show("Category applied");
      }
    }
    updateHijriPreview(iso) {
      const el = document.getElementById("hijriDatePreview");
      if (!el || !iso) return;
      try {
        const state = this.#store.getState();
        if (!state.user.showHijri) {
          el.textContent = "";
          return;
        }
        const h = this.#hijri.toHijri(iso);
        el.textContent = `${h.day} ${this.#hijri.monthsLong[h.month]} ${h.year}`;
      } catch {
        el.textContent = "";
      }
    }
    /**
     * Refresh the transfer FX panel.
     * @param {boolean} userChangedRate  true when the user manually edited the rate field;
     *                                   false (default) means auto-fill rate from FX table.
     * Called by TransactionModal with false on account/amount change, true on rate input.
     */
    updateTransferFxPanel(userChangedRate = false) {
      const panel = document.getElementById("fxPanel");
      if (!panel) return;
      const state = this.#store.getState();
      const fromAccId = document.querySelector("[name=accountId]")?.value;
      const toAccId = document.querySelector("[name=transferToAccountId]")?.value;
      const fromAcc = state.accounts.find((a) => a.id === fromAccId);
      const toAcc = state.accounts.find((a) => a.id === toAccId);
      if (!fromAcc || !toAcc || fromAcc.currency === toAcc.currency) {
        panel.style.display = "none";
        return;
      }
      panel.style.display = "";
      const fromCcy = fromAcc.currency;
      const toCcy = toAcc.currency;
      const autoRate = (RATES[toCcy] || 1) / (RATES[fromCcy] || 1);
      const rateInp = document.getElementById("fxRate");
      if (!userChangedRate || !(parseFloat(rateInp?.value) > 0)) {
        if (rateInp) rateInp.value = autoRate.toFixed(6);
      }
      const rate = parseFloat(rateInp?.value) || autoRate;
      const fromAmt = parseFloat(document.querySelector("[name=amount]")?.value) || 0;
      const toAmt = fromAmt * rate;
      const fromCcyEl = document.getElementById("fxFromCcy");
      const toCcyEl = document.getElementById("fxToCcy");
      const toAmtEl = document.getElementById("fxToAmount");
      const rateNoteEl = document.getElementById("fxRateNote");
      if (fromCcyEl) fromCcyEl.textContent = fromCcy;
      if (toCcyEl) toCcyEl.textContent = toCcy;
      if (toAmtEl) toAmtEl.textContent = this.#fx.formatMoney(this.#fx.toMinor(toAmt, toCcy), toCcy);
      if (rateNoteEl) rateNoteEl.textContent = `Auto: 1 ${fromCcy} = ${autoRate.toFixed(4)} ${toCcy}`;
    }
    resetTransferFx() {
      const state = this.#store.getState();
      const toAccId = document.querySelector("[name=transferToAccountId]")?.value;
      const fromAccId = document.querySelector("[name=accountId]")?.value;
      const fromAcc = state.accounts.find((a) => a.id === fromAccId);
      const toAcc = state.accounts.find((a) => a.id === toAccId);
      if (!fromAcc || !toAcc || fromAcc.currency === toAcc.currency) return;
      const rateInp = document.getElementById("fxRate");
      if (rateInp) {
        rateInp.value = ((RATES[toAcc.currency] || 1) / (RATES[fromAcc.currency] || 1)).toFixed(6);
      }
      this.updateTransferFxPanel(false);
    }
    onTxAccountChange(accId) {
      const state = this.#store.getState();
      const acc = state.accounts.find((a) => a.id === accId) || (state._sharedData || []).flatMap((s) => s.accounts || []).find((a) => a.id === accId);
      const curEl = document.querySelector("[name=currency]");
      if (curEl && acc?.currency) curEl.value = acc.currency;
      this.updateTxFxPanel(false);
    }
    /**
     * Combined handler for the amount / currency inputs: refresh whichever FX
     * panel is in the DOM (transfer or single-account). Each is a no-op when its
     * panel isn't rendered.
     */
    onTxFormChange() {
      this.updateTransferFxPanel(false);
      this.updateTxFxPanel(false);
    }
    /**
     * Currency changed: the stored/auto rate belonged to the old currency pair, so
     * clear it and let updateTxFxPanel refill the auto rate for the new pair.
     */
    onTxCurrencyChange() {
      const rateInp = document.getElementById("fxTxRate");
      if (rateInp) rateInp.value = "";
      this.updateTransferFxPanel(false);
      this.updateTxFxPanel(false);
    }
    /**
     * Show/refresh the single-account FX panel when a non-transfer transaction's
     * currency differs from its account's currency. Mirrors updateTransferFxPanel.
     * @param {boolean} userChangedRate  true when the user typed in the rate field
     */
    updateTxFxPanel(userChangedRate = false) {
      const panel = document.getElementById("fxTxPanel");
      if (!panel) return;
      const state = this.#store.getState();
      const accId = document.querySelector("[name=accountId]")?.value;
      const acc = state.accounts.find((a) => a.id === accId) || (state._sharedData || []).flatMap((s) => s.accounts || []).find((a) => a.id === accId);
      const txCcy = document.querySelector("[name=currency]")?.value;
      if (!acc || !txCcy || acc.currency === txCcy) {
        panel.style.display = "none";
        return;
      }
      panel.style.display = "";
      const accCcy = acc.currency;
      const autoRate = (RATES[accCcy] || 1) / (RATES[txCcy] || 1);
      const rateInp = document.getElementById("fxTxRate");
      if (rateInp && !(parseFloat(rateInp.value) > 0)) {
        rateInp.value = autoRate.toFixed(6);
      }
      const rate = parseFloat(rateInp?.value) || autoRate;
      const amt = parseFloat(document.querySelector("[name=amount]")?.value) || 0;
      const booked = amt * rate;
      const set = (id, v) => {
        const e = document.getElementById(id);
        if (e) e.textContent = v;
      };
      set("fxTxFromCcy", txCcy);
      set("fxTxToCcy", accCcy);
      set("fxTxToAmount", this.#fx.formatMoney(this.#fx.toMinor(booked, accCcy), accCcy));
      set("fxTxRateNote", `Auto: 1 ${txCcy} = ${autoRate.toFixed(4)} ${accCcy}`);
    }
    resetTxFx() {
      const state = this.#store.getState();
      const accId = document.querySelector("[name=accountId]")?.value;
      const acc = state.accounts.find((a) => a.id === accId) || (state._sharedData || []).flatMap((s) => s.accounts || []).find((a) => a.id === accId);
      const txCcy = document.querySelector("[name=currency]")?.value;
      const rateInp = document.getElementById("fxTxRate");
      if (acc && txCcy && rateInp) {
        rateInp.value = ((RATES[acc.currency] || 1) / (RATES[txCcy] || 1)).toFixed(6);
      }
      this.updateTxFxPanel(false);
    }
    /**
     * Receipt scan — UI coordinator.
     *
     * Delegates all Gemini API interaction to ReceiptScanService (domain layer).
     * This method is responsible only for:
     *   1. Checking the API key and opening Settings if missing
     *   2. Updating the scan-label button text during the async call
     *   3. Opening a fresh pre-filled transaction modal on success
     *   4. Showing a specific error toast and restoring the button on failure
     */
    async scanReceipt(input) {
      const file = input?.files?.[0];
      if (!file) return;
      if (!this.#store.getState().user.geminiApiKey?.trim()) {
        this.#toast.show("Add your free Google AI key in Settings first");
        this.openModal("settings");
        input.value = "";
        return;
      }
      const scanLabel = input.closest("label");
      const scanText = scanLabel?.querySelector(".scan-label-text");
      if (scanText) scanText.textContent = "Scanning\u2026";
      this.#toast.show("Scanning receipt with Gemini AI\u2026");
      try {
        const scanner = new ReceiptScanService();
        const prefill = await scanner.scan(file);
        this.closeModal();
        this.openModal("transaction", { prefill });
        this.#toast.show("Receipt scanned \xB7 review and save");
      } catch (e) {
        if (e.message === "NO_API_KEY") {
          this.#toast.show("Add your free Google AI key in Settings first");
          this.openModal("settings");
        } else {
          this.#toast.show("Scan failed: " + (e.message || "Unknown error"));
        }
        if (scanText) scanText.textContent = "Scan receipt with Gemini AI";
      } finally {
        input.value = "";
      }
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Account CRUD
    // ──────────────────────────────────────────────────────────────────────────
    submitAccount(event, id) {
      event.preventDefault();
      const fd = new FormData(event.target);
      const data = Object.fromEntries(fd.entries());
      const state = this.#store.getState();
      const newMinor = this.#fx.toMinor(data.balance || 0, data.currency);
      const today = DateService.todayIso();
      const groupRes = this.#resolveAccountGroupId(data, state);
      if (groupRes.error) return this.#toast.show(groupRes.error);
      const { groupId } = groupRes;
      if (id) {
        const a2 = state.accounts.find((x) => x.id === id);
        if (!a2) return;
        const wasMajor = a2.balance;
        this.#accounts.update(id, { name: data.name, type: data.type, currency: data.currency, color: data.color, archived: !!data.archived, groupId });
        if (newMinor !== wasMajor) {
          const delta = newMinor - wasMajor;
          const positive = delta > 0;
          const tx = {
            id: IdGenerator.generate("tx"),
            accountId: a2.id,
            categoryId: null,
            amount: Math.abs(delta),
            currency: a2.currency,
            exchangeRate: (RATES[a2.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
            refAmount: this.#fx.convert(Math.abs(delta), a2.currency, state.user.homeCurrency),
            payee: "Balance adjustment",
            note: `Manual balance set: ${this.#fx.formatMoney(wasMajor, a2.currency)} \u2192 ${this.#fx.formatMoney(newMinor, a2.currency)}`,
            date: today,
            hijriDate: this.#hijri.toHijri(today),
            paymentType: "cash",
            recordState: "cleared",
            type: positive ? "income" : "expense",
            transferPairId: null,
            splits: null,
            tags: ["balance-adjustment"]
          };
          state.transactions.push(tx);
        }
        this.#store.persist();
        this.closeModal();
        this.#render();
        this.#toast.show("Account updated" + (newMinor !== wasMajor ? " \xB7 adjustment logged" : ""));
        this.#sync.schedulePush?.();
        return;
      }
      const a = this.#accounts.create({ name: data.name, type: data.type, currency: data.currency, color: data.color, icon: "wallet", groupId });
      const newId = a.id;
      if (newMinor !== 0) {
        const positive = newMinor > 0;
        const tx = {
          id: IdGenerator.generate("tx"),
          accountId: newId,
          categoryId: null,
          amount: Math.abs(newMinor),
          currency: a.currency,
          exchangeRate: (RATES[a.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
          refAmount: this.#fx.convert(Math.abs(newMinor), a.currency, state.user.homeCurrency),
          payee: "Opening balance",
          note: "",
          date: today,
          hijriDate: this.#hijri.toHijri(today),
          paymentType: "cash",
          recordState: "cleared",
          type: positive ? "income" : "expense",
          transferPairId: null,
          splits: null,
          tags: ["opening-balance"]
        };
        state.transactions.push(tx);
      }
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show("Account added" + (newMinor !== 0 ? " \xB7 opening balance logged" : ""));
      this.#sync.schedulePush?.();
    }
    deleteAccount(id) {
      const state = this.#store.getState();
      const referenced = state.transactions.some(
        (t) => t.accountId === id || Array.isArray(t.splits) && t.splits.some((s) => (s.accountId || t.accountId) === id)
      );
      if (referenced) {
        return this.#toast.show("Archive instead \u2014 account has transactions");
      }
      if (!confirm("Delete this account?")) return;
      this.#accounts.delete(id);
      this.closeModal();
      this.#render();
      this.#sync.schedulePush?.();
    }
    deleteAccountGroup(id) {
      const state = this.#store.getState();
      if (!confirm("Delete this group? Accounts will become ungrouped.")) return;
      state.accounts.forEach((a) => {
        if (a.groupId === id) a.groupId = null;
      });
      state.accountGroups = (state.accountGroups || []).filter((g) => g.id !== id);
      this.#store.persist();
      this.#render();
    }
    onAccGroupChange(sel) {
      const inp = document.getElementById("accNewGroupName");
      if (!inp) return;
      if (sel.value === "__new__") {
        inp.classList.remove("hidden");
        inp.required = true;
        inp.focus();
      } else {
        inp.classList.add("hidden");
        inp.required = false;
        inp.value = "";
      }
    }
    // ── Account detail view ──────────────────────────────────────────────────
    openAccountDetail(id, sharedMeta = null) {
      const v = this.#getOrCreateView("accountDetail");
      v.setAccount(id, sharedMeta);
      this.#router.navigate("accountDetail");
      this.#render();
    }
    setAccountViewMode(mode) {
      const v = this.#views.get("accountDetail");
      v?.setViewMode?.(mode);
      this.#render();
    }
    setAccDetailFilter(key, val) {
      const v = this.#views.get("accountDetail");
      v?.setFilter?.(key, val);
      this.#render();
    }
    /** Opens the ReconcileModal — the modal computes the residual via AccountService.ledgerSum(). */
    reconcileAccount(id) {
      const state = this.#store.getState();
      const a = state.accounts.find((x) => x.id === id);
      if (!a) return;
      const ledger = this.#accounts.ledgerSum(a, state.transactions);
      if (Math.abs(a.balance - ledger) < 1) {
        this.#toast.show("Already reconciled \u2014 no residual to log");
        return;
      }
      this.#modal.open("reconcile", { id });
    }
    /** Reconcile option A — called by ReconcileModal's "Add entry" button. */
    reconcileAddEntry(id) {
      const state = this.#store.getState();
      const a = state.accounts.find((x) => x.id === id);
      if (!a) return;
      const ledger = this.#accounts.ledgerSum(a, state.transactions);
      const residual = a.balance - ledger;
      if (Math.abs(residual) < 1) {
        this.closeModal();
        this.#toast.show("No residual to log");
        return;
      }
      const earliest = state.transactions.filter((t) => t.accountId === a.id && t.date).sort((x, y) => x.date.localeCompare(y.date))[0];
      let dateIso = DateService.todayIso();
      if (earliest) {
        const d = /* @__PURE__ */ new Date(earliest.date + "T12:00:00");
        d.setDate(d.getDate() - 1);
        dateIso = DateService.toIso(d);
      }
      const absResidual = Math.abs(residual);
      const tx = {
        id: IdGenerator.generate("tx"),
        accountId: a.id,
        categoryId: null,
        amount: absResidual,
        currency: a.currency,
        exchangeRate: (RATES[a.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
        refAmount: this.#fx.convert(absResidual, a.currency, state.user.homeCurrency),
        payee: "Opening balance",
        note: "Reconciled from existing account balance",
        date: dateIso,
        hijriDate: this.#hijri.toHijri(dateIso),
        paymentType: "cash",
        recordState: "cleared",
        type: residual > 0 ? "income" : "expense",
        transferPairId: null,
        splits: null,
        tags: ["opening-balance", "reconciled"],
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      state.transactions.push(tx);
      a.openingBalance = 0;
      this.#store.persist();
      this.#sync.schedulePush?.();
      this.closeModal();
      this.#render();
      const sign = residual >= 0 ? "+" : "-";
      this.#toast.show(`Reconciled \xB7 added ${sign}${this.#fx.formatMoney(absResidual, a.currency)} opening balance entry`);
    }
    /** Reconcile option B — called by ReconcileModal's "Recalculate" button. */
    reconcileRecalculate(id) {
      const state = this.#store.getState();
      const a = state.accounts.find((x) => x.id === id);
      if (!a) return;
      const ledger = this.#accounts.ledgerSum(a, state.transactions);
      const residual = a.balance - ledger;
      if (Math.abs(residual) < 1) {
        this.closeModal();
        this.#toast.show("No residual");
        return;
      }
      if (!confirm(`Balance will change from ${this.#fx.formatMoney(a.balance, a.currency)} to ${this.#fx.formatMoney(ledger, a.currency)}. No transactions are modified. Continue?`)) return;
      a.openingBalance = 0;
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show(`Balance recalculated to ${this.#fx.formatMoney(ledger, a.currency)}`);
    }
    async refreshSharedAccount(shareIndex) {
      await this.#sync.pullFamilyShares?.();
      this.#render();
      this.#toast.show("Refreshed");
    }
    toggleAccountGroupCollapse(id) {
      const state = this.#store.getState();
      if (!Array.isArray(state.user.collapsedAccountGroups)) state.user.collapsedAccountGroups = [];
      const idx = state.user.collapsedAccountGroups.indexOf(id);
      if (idx >= 0) state.user.collapsedAccountGroups.splice(idx, 1);
      else state.user.collapsedAccountGroups.push(id);
      this.#store.persist();
      this.#render();
    }
    collapseAllAccountGroups() {
      const state = this.#store.getState();
      const groupIds = (state.accountGroups || []).map((g) => g.id);
      const validIds = new Set(groupIds);
      const hasUngrouped = state.accounts.some((a) => !a.groupId || !validIds.has(a.groupId));
      state.user.collapsedAccountGroups = hasUngrouped ? [...groupIds, "__none__"] : groupIds.slice();
      this.#store.persist();
      this.#render();
    }
    expandAllAccountGroups() {
      this.#store.getState().user.collapsedAccountGroups = [];
      this.#store.persist();
      this.#render();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Category CRUD
    // ──────────────────────────────────────────────────────────────────────────
    submitCategory(event, id) {
      event.preventDefault();
      const fd = new FormData(event.target);
      const data = Object.fromEntries(fd.entries());
      const state = this.#store.getState();
      const parentId = data.parentId || null;
      if (id && parentId === id) return this.#toast.show("A category cannot be its own parent");
      if (id && parentId && state.categories.some((c) => c.parentId === id)) {
        return this.#toast.show("This category already has sub-categories \u2014 cannot itself become a sub-category");
      }
      const payload = { name: data.name, type: data.type, color: data.color, icon: data.icon, parentId };
      if (id) this.#categories.update(id, payload);
      else this.#categories.create(payload);
      this.closeModal();
      this.#render();
      this.#toast.show(id ? "Category updated" : "Category added");
      this.#sync.schedulePush?.();
    }
    deleteCategory(id) {
      const state = this.#store.getState();
      if (state.transactions.some((t) => t.categoryId === id)) {
        return this.#toast.show("Reassign transactions first");
      }
      if (!confirm("Delete this category?")) return;
      this.#categories.delete(id);
      this.closeModal();
      this.#render();
      this.#sync.schedulePush?.();
    }
    toggleCategoryCollapse(id) {
      const state = this.#store.getState();
      if (!Array.isArray(state.user.collapsedCategories)) state.user.collapsedCategories = [];
      const idx = state.user.collapsedCategories.indexOf(id);
      if (idx >= 0) state.user.collapsedCategories.splice(idx, 1);
      else state.user.collapsedCategories.push(id);
      this.#store.persist();
      this.#render();
    }
    collapseAllCategories() {
      const state = this.#store.getState();
      if (!Array.isArray(state.user.collapsedCategories)) state.user.collapsedCategories = [];
      const parentIds = state.categories.filter((c) => !c.parentId && state.categories.some((ch) => ch.parentId === c.id)).map((c) => c.id);
      state.user.collapsedCategories = [.../* @__PURE__ */ new Set([...state.user.collapsedCategories, ...parentIds])];
      this.#store.persist();
      this.#render();
    }
    expandAllCategories() {
      this.#store.getState().user.collapsedCategories = [];
      this.#store.persist();
      this.#render();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Budget CRUD
    // ──────────────────────────────────────────────────────────────────────────
    submitBudget(event, id) {
      event.preventDefault();
      const fd = new FormData(event.target);
      const data = Object.fromEntries(fd.entries());
      const categoryIds = fd.getAll("categoryIds");
      if (!categoryIds.length) return this.#toast.show("Pick at least one category");
      const minor = this.#fx.toMinor(data.amount, data.currency);
      const period = data.period === "hijri" ? "hijri" : "gregorian";
      const payload = { categoryIds, categoryId: categoryIds[0], amount: minor, currency: data.currency, period, rollover: !!data.rollover };
      if (id) this.#budgets.update(id, payload);
      else this.#budgets.create(payload);
      this.closeModal();
      this.#render();
      this.#toast.show(id ? "Budget updated" : "Budget added");
      this.#sync.schedulePush?.();
    }
    deleteBudget(id) {
      if (!confirm("Delete this budget?")) return;
      this.#budgets.delete(id);
      this.closeModal();
      this.#render();
      this.#sync.schedulePush?.();
    }
    /** Open the drill-in detail view for a single budget (its transactions). */
    openBudgetDetail(id) {
      const v = this.#getOrCreateView("budgetDetail");
      v.setBudget(id);
      this.#router.navigate("budgetDetail");
      this.#render();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Debt CRUD
    // ──────────────────────────────────────────────────────────────────────────
    submitDebt(event, id) {
      event.preventDefault();
      const fd = new FormData(event.target);
      const data = Object.fromEntries(fd.entries());
      const state = this.#store.getState();
      if (id) {
        const debt = state.debts.find((x) => x.id === id);
        if (!debt) return;
        debt.counterparty = data.counterparty || debt.counterparty;
        debt.dueDate = data.dueDate || null;
        debt.note = data.note || "";
        debt.status = data.markPaid ? "paid" : "active";
        this.#store.persist();
        this.closeModal();
        this.#render();
        this.#toast.show("Debt updated");
        return;
      }
      const currency = data.currency;
      const principal = this.#fx.toMinor(data.principal, currency);
      if (!isFinite(principal) || principal <= 0) return this.#toast.show("Principal must be positive");
      if (!data.counterparty?.trim()) return this.#toast.show("Add a counterparty");
      const acc = state.accounts.find((a) => a.id === data.accountId);
      if (!acc) return this.#toast.show("Pick an account");
      const debtId = IdGenerator.generate("dbt");
      const txId = IdGenerator.generate("tx");
      const exRate = (RATES[currency] || 1) / (RATES[state.user.homeCurrency] || 1);
      const refAmt = this.#fx.convert(principal, currency, state.user.homeCurrency);
      const isBorrowed = data.type === "borrowed";
      const tx = {
        id: txId,
        accountId: data.accountId,
        categoryId: null,
        amount: principal,
        currency,
        exchangeRate: exRate,
        refAmount: refAmt,
        payee: data.counterparty,
        note: (isBorrowed ? "Borrowed from " : "Lent to ") + data.counterparty + (data.note ? " \u2014 " + data.note : ""),
        date: data.dateTaken,
        hijriDate: this.#hijri.toHijri(data.dateTaken),
        paymentType: "transfer",
        recordState: "cleared",
        type: isBorrowed ? "income" : "expense",
        transferPairId: null,
        tags: ["debt"],
        splits: null,
        debtId,
        debtRole: "initial"
      };
      state.transactions.push(tx);
      state.debts.push({
        id: debtId,
        type: data.type,
        counterparty: data.counterparty,
        principal,
        currency,
        accountId: data.accountId,
        dateTaken: data.dateTaken,
        dueDate: data.dueDate || null,
        note: data.note || "",
        status: "active",
        initialTxId: txId
      });
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show(isBorrowed ? "Debt recorded \xB7 account credited" : "Loan recorded \xB7 account debited");
      this.#sync.schedulePush?.();
    }
    submitDebtPayment(event, debtId) {
      event.preventDefault();
      const fd = new FormData(event.target);
      const data = Object.fromEntries(fd.entries());
      const state = this.#store.getState();
      const debt = state.debts?.find((x) => x.id === debtId);
      if (!debt) return;
      const amount = this.#fx.toMinor(data.amount, debt.currency);
      if (!isFinite(amount) || amount <= 0) return this.#toast.show("Amount must be positive");
      const isBorrowed = debt.type === "borrowed";
      const tx = {
        id: IdGenerator.generate("tx"),
        accountId: data.accountId,
        categoryId: null,
        amount,
        currency: debt.currency,
        exchangeRate: (RATES[debt.currency] || 1) / (RATES[state.user.homeCurrency] || 1),
        refAmount: this.#fx.convert(amount, debt.currency, state.user.homeCurrency),
        payee: debt.counterparty,
        note: (isBorrowed ? "Payment to " : "Repayment from ") + debt.counterparty + (data.note ? " \u2014 " + data.note : ""),
        date: data.date,
        hijriDate: this.#hijri.toHijri(data.date),
        paymentType: "transfer",
        recordState: "cleared",
        type: isBorrowed ? "expense" : "income",
        transferPairId: null,
        tags: ["debt-payment"],
        splits: null,
        debtId,
        debtRole: "payment"
      };
      state.transactions.push(tx);
      const payments = state.transactions.filter((t) => t.debtId === debtId && t.id !== debt.initialTxId);
      const paid = payments.reduce((s, t) => s + this.#fx.convert(t.amount, t.currency, debt.currency), 0);
      if (paid >= debt.principal - 1) debt.status = "paid";
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show(debt.status === "paid" ? "Payment recorded \xB7 debt cleared" : `Payment of ${this.#fx.formatMoney(amount, debt.currency)} recorded`);
      this.#sync.schedulePush?.();
    }
    deleteDebt(id, destroyPayments = false) {
      const state = this.#store.getState();
      const debt = state.debts.find((d) => d.id === id);
      if (!debt) return;
      const payments = state.transactions.filter((t) => t.debtId === id && t.id !== debt.initialTxId);
      const msg = destroyPayments ? `Delete this debt AND destroy ${payments.length} linked payment transaction${payments.length === 1 ? "" : "s"}? Account balances will be restored.` : "Delete this debt? The initial transaction is reverted; existing payment transactions are kept but unlinked.";
      if (!confirm(msg)) return;
      const initial = state.transactions.find((t) => t.id === debt.initialTxId);
      if (initial) {
        state.transactions = state.transactions.filter((t) => t.id !== debt.initialTxId);
      }
      if (destroyPayments) {
        state.transactions = state.transactions.filter((t) => t.debtId !== id);
      } else {
        state.transactions.forEach((t) => {
          if (t.debtId === id) {
            t.debtId = null;
            t.debtRole = null;
          }
        });
      }
      state.debts = state.debts.filter((d) => d.id !== id);
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show(destroyPayments ? `Debt and ${payments.length} payment(s) destroyed` : "Debt deleted");
      this.#sync.schedulePush?.();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Family CRUD
    // ──────────────────────────────────────────────────────────────────────────
    submitFamilyMember(event, id) {
      event.preventDefault();
      const fd = new FormData(event.target);
      const data = Object.fromEntries(fd.entries());
      const state = this.#store.getState();
      const perms = this.#familyModal?.getPendingPerms?.() ?? {};
      const permissions = Object.entries(perms).filter(([, v]) => v).map(([accountId, access]) => ({ accountId, access }));
      if (id) {
        const m = state.family.find((x) => x.id === id);
        if (!m) return;
        Object.assign(m, {
          name: data.name,
          email: data.email || "",
          initials: data.initials || data.name.slice(0, 2).toUpperCase(),
          color: data.color || m.color,
          permissions
        });
      } else {
        state.family.push({
          id: IdGenerator.generate("mbr"),
          name: data.name,
          email: data.email || "",
          initials: data.initials || data.name.slice(0, 2).toUpperCase(),
          color: data.color || MEMBER_COLORS[state.family.length % MEMBER_COLORS.length],
          permissions
        });
      }
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show(id ? "Member updated" : "Member added");
      this.#sync.schedulePush?.();
    }
    deleteFamilyMember(id) {
      if (!confirm("Remove this family member?")) return;
      const state = this.#store.getState();
      state.family = (state.family || []).filter((m) => m.id !== id);
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#sync.schedulePush?.();
    }
    toggleAccountPerm(accountId, enabled) {
      const levelsDiv = document.getElementById(`accLevels_${accountId}`);
      if (levelsDiv) levelsDiv.classList.toggle("hidden", !enabled);
      if (!enabled) {
        this.#familyModal?.removePendingPerm(accountId);
      } else {
        this.#familyModal?.setPendingPerm(accountId, "view");
        this.#familyModal?.highlightPermLevel(accountId, "view");
      }
    }
    updatePermLevel(accountId, level) {
      this.#familyModal?.setPendingPerm(accountId, level);
      this.#familyModal?.highlightPermLevel(accountId, level);
    }
    pickMemberColor(color) {
      const inp = document.getElementById("memberColorInput");
      const av = document.getElementById("memberAvatar");
      if (inp) inp.value = color;
      if (av) av.style.background = color;
      document.querySelectorAll("[data-color]").forEach((btn) => {
        btn.style.borderColor = btn.dataset.color === color ? "#09090b" : "transparent";
      });
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Regular items CRUD
    // ──────────────────────────────────────────────────────────────────────────
    submitRegularItem(event, id) {
      event.preventDefault();
      const fd = new FormData(event.target);
      const data = Object.fromEntries(fd.entries());
      const state = this.#store.getState();
      if (!Array.isArray(state.regularItems)) state.regularItems = [];
      const currency = data.currency || state.user.homeCurrency;
      const payload = {
        name: (data.name || "").trim(),
        defaultAmount: this.#fx.toMinor(parseFloat(data.defaultAmount) || 0, currency),
        currency,
        accountId: data.accountId || null,
        categoryId: data.categoryId || null,
        icon: data.icon || "coffee",
        color: data.color || "#f97316",
        frequency: data.frequency || "monthly"
      };
      if (!payload.name) return this.#toast.show("Name is required");
      if (id) {
        const item = state.regularItems.find((i) => i.id === id);
        if (item) Object.assign(item, payload);
      } else {
        state.regularItems.push({ id: IdGenerator.generate("ri"), ...payload });
      }
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#toast.show(id ? "Item updated" : "Item added");
      this.#sync.schedulePush?.();
    }
    deleteRegularItem(id) {
      if (!confirm("Delete this regular item?")) return;
      const s = this.#store.getState();
      s.transactions = (s.transactions || []).filter((t) => t.regularItemId !== id);
      s.regularItems = (s.regularItems || []).filter((i) => i.id !== id);
      this.#store.persist();
      this.closeModal();
      this.#render();
      this.#sync.schedulePush?.();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Regular item log methods (DayLogsModal handlers)
    // ──────────────────────────────────────────────────────────────────────────
    submitRegularLog(e, date) {
      e.preventDefault();
      const fd = new FormData(e.target);
      const itemId = fd.get("itemId");
      const s = this.#store.getState();
      const item = (s.regularItems || []).find((i) => i.id === itemId);
      if (!item) return;
      const qty = parseFloat(fd.get("qty")) || 1;
      const unitPrice = parseFloat(fd.get("unitPrice")) || 0;
      const currency = item.currency || s.user.homeCurrency;
      const unitMinor = this.#fx.toMinor(unitPrice, currency);
      const totalMinor = Math.round(unitMinor * qty);
      const accountId = item.accountId || s.accounts[0]?.id;
      const exRate3 = (RATES[currency] || 1) / (RATES[s.user.homeCurrency] || 1);
      const tx = {
        id: IdGenerator.generate("tx"),
        regularItemId: itemId,
        accountId,
        date,
        hijriDate: this.#hijri.toHijri(date),
        amount: totalMinor,
        unitAmount: unitMinor,
        qty,
        currency,
        exchangeRate: exRate3,
        refAmount: this.#fx.convert(totalMinor, currency, s.user.homeCurrency),
        description: item.name,
        payee: item.name,
        note: "",
        type: "expense",
        categoryId: item.categoryId || null,
        splits: null,
        paymentType: "cash",
        recurring: null,
        recordState: "cleared",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      s.transactions.push(tx);
      this.#store.flush();
      this.#sync.schedulePush?.();
      this.openModal("dayLogs", { date });
    }
    deleteRegularLog(logId, date) {
      const s = this.#store.getState();
      const tx = s.transactions.find((t) => t.id === logId);
      if (tx) {
        s.transactions = s.transactions.filter((t) => t.id !== logId);
        this.#store.flush();
        this.#sync.schedulePush?.();
      }
      this.openModal("dayLogs", { date });
    }
    prefillRegularLog(sel) {
      const opt = sel.options[sel.selectedIndex];
      const price = parseFloat(opt?.dataset?.price) || 0;
      const unitEl = document.getElementById("dayLogUnit");
      const qtyEl = document.getElementById("dayLogQty");
      const totalEl = document.getElementById("dayLogTotal");
      if (unitEl) unitEl.value = price > 0 ? price.toFixed(2) : "";
      if (totalEl && qtyEl) {
        const qty = parseFloat(qtyEl.value) || 1;
        totalEl.value = price > 0 ? (price * qty).toFixed(2) : "";
      }
    }
    updateRegularLogTotal() {
      const qty = parseFloat(document.getElementById("dayLogQty")?.value) || 1;
      const unit = parseFloat(document.getElementById("dayLogUnit")?.value) || 0;
      const el = document.getElementById("dayLogTotal");
      if (el) el.value = (qty * unit).toFixed(2);
    }
    /**
     * Step 1 → Step 2: save selected currency then advance to the
     * Hijri calibration step by calling advanceToStep2() on the modal
     * and refreshing in-place (no close/reopen flash).
     */
    currencySetupNext() {
      const sel = document.getElementById("setupCurrency");
      if (sel) this.#store.getState().user.homeCurrency = sel.value;
      this.#store.persist();
      this.#currencySetupModal.advanceToStep2();
      this.#modal.refresh();
    }
    /**
     * Step 2 done: close the onboarding modal and enter the app.
     */
    saveCurrencySetup() {
      this.#store.persist();
      this.closeModal();
      this.#toast.show("All set \u2014 welcome to Pocket!");
      this.#render();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Calendar view
    // ──────────────────────────────────────────────────────────────────────────
    shiftCalMonth(delta) {
      const v = this.#getOrCreateView("calendar");
      v.shiftMonth?.(delta);
      this.#render();
    }
    setCalTab(tab) {
      const v = this.#getOrCreateView("calendar");
      v.setTab?.(tab);
      this.#render();
    }
    resetCalFocus() {
      const v = this.#getOrCreateView("calendar");
      v.resetFocus?.();
      this.#render();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Reports view
    // ──────────────────────────────────────────────────────────────────────────
    setReportRange(r) {
      this.#reportRange = r;
      const v = this.#getOrCreateView("reports");
      v.setRange?.(r);
      this.#render();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Swipe-to-delete (touch)
    // ──────────────────────────────────────────────────────────────────────────
    /**
     * @param {TouchEvent} event
     * @param {string}     id            Transaction ID
     * @param {number}     shareIndex    Index into _sharedData (-1 for owned tx)
     * @param {boolean}    isOwnContrib  True if this is a member's own contribution
     */
    onTxSwipeStart(event, id, shareIndex = -1, isOwnContrib = false) {
      if (event.touches.length !== 1) return;
      this.#swipeTxId = id;
      this.#swipeShareIndex = shareIndex;
      this.#swipeIsOwnContrib = !!isOwnContrib;
      this.#swipeStartX = event.touches[0].clientX;
      this.#swipeStartY = event.touches[0].clientY;
      this.#swipeLastX = this.#swipeStartX;
      this.#swipeDeltaX = 0;
      this.#swipeAxis = null;
      this.#swipeTriggered = false;
      this.#swipeWrapper = event.currentTarget;
    }
    onTxSwipeMove(event) {
      if (!this.#swipeTxId || this.#swipeTriggered) return;
      const touch = event.touches[0];
      const dx = touch.clientX - this.#swipeStartX;
      const dy = touch.clientY - this.#swipeStartY;
      this.#swipeLastX = touch.clientX;
      if (!this.#swipeAxis) {
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4)
          this.#swipeAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        return;
      }
      if (this.#swipeAxis !== "x") return;
      this.#swipeDeltaX = dx;
      if (dx < 0) {
        event.preventDefault();
        const c = this.#swipeWrapper?.querySelector(".tx-row-content");
        if (c) c.style.transform = `translateX(${Math.max(dx, -80)}px)`;
      }
    }
    // Called from ontouchend with no arguments — uses stored state instead of event.
    onTxSwipeEnd() {
      if (!this.#swipeTxId || this.#swipeTriggered) return;
      const dx = this.#swipeLastX - this.#swipeStartX;
      const c = this.#swipeWrapper?.querySelector(".tx-row-content");
      if (dx < -55) {
        this.#swipeTriggered = true;
        if (c) {
          c.style.transition = "transform .15s ease, opacity .18s ease";
          c.style.transform = "translateX(-80px)";
          c.style.opacity = "0";
        }
        const id = this.#swipeTxId;
        const si = this.#swipeShareIndex;
        const own = this.#swipeIsOwnContrib;
        setTimeout(() => {
          if (si >= 0 && own) this.deleteSharedContrib(si, id);
          else if (si >= 0) this.deleteSharedTx(si, id);
          else this.deleteTx(id);
          this.#swipeTxId = null;
        }, 200);
      } else {
        if (c) {
          c.style.transition = "";
          c.style.transform = "";
        }
        this.#swipeTxId = null;
      }
      this.#swipeDeltaX = 0;
      this.#swipeAxis = null;
      this.#swipeTriggered = false;
      this.#swipeWrapper = null;
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Data: export / import / reset
    // ──────────────────────────────────────────────────────────────────────────
    exportJson() {
      const state = this.#store.getState();
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pocket-export-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".json";
      a.click();
      this.#toast.show("Export downloaded");
    }
    importJson(input) {
      const file = input?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed.accounts || !parsed.transactions) throw new Error("Invalid structure");
          this.#store.replaceState(parsed);
          this.#store.persist();
          this.closeModal();
          this.#render();
          this.#toast.show("Data imported");
        } catch {
          this.#toast.show("Invalid JSON file");
        }
      };
      reader.readAsText(file);
    }
    exportCsv(range) {
      const state = this.#store.getState();
      const home = state.user.homeCurrency;
      const COLS = [
        ["Date", "date"],
        ["Type", "type"],
        ["Account", "account"],
        ["ToAccount", "toaccount"],
        ["ToAmount", "toamount"],
        ["ToCurrency", "tocurrency"],
        ["Category", "category"],
        ["Subcategory", "subcategory"],
        ["Payee", "payee"],
        ["Note", "note"],
        ["Amount", "amount"],
        ["Currency", "currency"],
        ["PaymentType", "paymenttype"],
        ["Tags", "tags"],
        ["DueDate", "duedate"],
        ["DebtRef", "debtref"],
        ["SplitOf", "splitof"],
        ["CreatedAt", "createdAt"],
        ["AddedBy", "addedBy"]
      ];
      const effectiveRange = range === "current" ? this.#reportRange : range;
      const txs = state.transactions.filter((t) => this.#withinRange(t.date, effectiveRange)).sort((a2, b) => a2.date.localeCompare(b.date));
      const catPair = (id) => {
        const cat = state.categories.find((c) => c.id === id);
        if (!cat) return ["", ""];
        if (cat.parentId) {
          const parent = state.categories.find((c) => c.id === cat.parentId);
          return [parent?.name || "", cat.name];
        }
        return [cat.name, ""];
      };
      const minorDig = (c) => this.#fx.minorFactor(c) === 1 ? 0 : this.#fx.minorFactor(c) === 1e3 ? 3 : 2;
      const cellStr = (v) => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const buildRow = (o) => COLS.map(([, k]) => cellStr(o[k] != null ? o[k] : ""));
      const rows = [COLS.map((c) => c[0])];
      const emitted = /* @__PURE__ */ new Set();
      txs.forEach((t) => {
        if (emitted.has(t.id)) return;
        if (t.type === "transfer" && t.transferPairId) {
          if (t.transferDir === "in") return;
          const pair = state.transactions.find((x) => x.id === t.transferPairId);
          const accFrom = state.accounts.find((a2) => a2.id === t.accountId);
          const accTo = pair ? state.accounts.find((a2) => a2.id === pair.accountId) : null;
          const crossCcy = pair && pair.currency !== t.currency;
          rows.push(buildRow({
            date: t.date,
            type: "transfer",
            account: accFrom?.name || "",
            toaccount: accTo?.name || "",
            toamount: crossCcy ? this.#fx.fromMinor(pair.amount, pair.currency).toFixed(minorDig(pair.currency)) : "",
            tocurrency: crossCcy ? pair.currency : "",
            payee: t.payee || "",
            note: (t.note || "").replace(/[\r\n]+/g, " "),
            amount: this.#fx.fromMinor(t.amount, t.currency).toFixed(minorDig(t.currency)),
            currency: t.currency,
            paymenttype: t.paymentType || "transfer",
            tags: (t.tags || []).join(","),
            createdAt: t.createdAt || "",
            addedBy: t.addedBy || ""
          }));
          emitted.add(t.id);
          if (pair) emitted.add(pair.id);
          return;
        }
        if (t.debtId) {
          const debt = state.debts?.find((x) => x.id === t.debtId);
          if (debt) {
            const acc2 = state.accounts.find((a2) => a2.id === t.accountId);
            if (t.debtRole === "initial") {
              rows.push(buildRow({
                date: t.date,
                type: debt.type,
                account: acc2?.name || "",
                payee: debt.counterparty || t.payee || "",
                note: (t.note || debt.note || "").replace(/[\r\n]+/g, " "),
                amount: this.#fx.fromMinor(t.amount, t.currency).toFixed(minorDig(t.currency)),
                currency: t.currency,
                paymenttype: t.paymentType || "transfer",
                tags: (t.tags || []).join(","),
                duedate: debt.dueDate || "",
                debtref: debt.id,
                createdAt: t.createdAt || "",
                addedBy: t.addedBy || ""
              }));
            } else {
              rows.push(buildRow({
                date: t.date,
                type: t.type,
                account: acc2?.name || "",
                payee: t.payee || "",
                note: (t.note || "").replace(/[\r\n]+/g, " "),
                amount: this.#fx.fromMinor(t.amount, t.currency).toFixed(minorDig(t.currency)),
                currency: t.currency,
                paymenttype: t.paymentType || "",
                tags: (t.tags || []).join(","),
                debtref: debt.id,
                createdAt: t.createdAt || "",
                addedBy: t.addedBy || ""
              }));
            }
            emitted.add(t.id);
            return;
          }
        }
        if (Array.isArray(t.splits) && t.splits.length) {
          t.splits.forEach((s) => {
            const acc2 = state.accounts.find((a2) => a2.id === (s.accountId || t.accountId));
            const [cn2, sn2] = catPair(s.categoryId);
            rows.push(buildRow({
              date: t.date,
              type: t.type,
              account: acc2?.name || "",
              category: cn2,
              subcategory: sn2,
              payee: t.payee || "",
              note: (t.note || "").replace(/[\r\n]+/g, " "),
              amount: this.#fx.fromMinor(s.amount, t.currency).toFixed(minorDig(t.currency)),
              currency: t.currency,
              paymenttype: t.paymentType || "",
              tags: (t.tags || []).join(","),
              splitof: t.id,
              createdAt: t.createdAt || "",
              addedBy: t.addedBy || ""
            }));
          });
          emitted.add(t.id);
          return;
        }
        const acc = state.accounts.find((a2) => a2.id === t.accountId);
        const [cn, sn] = catPair(t.categoryId);
        rows.push(buildRow({
          date: t.date,
          type: t.type,
          account: acc?.name || "",
          category: cn,
          subcategory: sn,
          payee: t.payee || "",
          note: (t.note || "").replace(/[\r\n]+/g, " "),
          amount: this.#fx.fromMinor(t.amount, t.currency).toFixed(minorDig(t.currency)),
          currency: t.currency,
          paymenttype: t.paymentType || "",
          tags: (t.tags || []).join(","),
          createdAt: t.createdAt || "",
          addedBy: t.addedBy || ""
        }));
        emitted.add(t.id);
      });
      const csv = rows.map((r) => r.join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "transactions-" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ".csv";
      a.click();
      this.closeModal();
      this.#toast.show("CSV downloaded");
    }
    downloadImportTemplate() {
      const today = DateService.todayIso();
      const lines = [
        "Date,Type,Account,ToAccount,ToAmount,ToCurrency,Category,Subcategory,Payee,Note,Amount,Currency,PaymentType,Tags,DueDate,DebtRef,SplitOf",
        `${today},expense,Main Checking,,,,Food & Drink,Groceries,Whole Foods,Weekly groceries,87.45,USD,card,,,,`,
        `${today},income,Main Checking,,,,Salary,,Acme Corp,Monthly payroll,5800.00,USD,transfer,,,,`,
        `${today},transfer,Main Checking,High-Yield Save,,,,,,Move to savings,500.00,USD,transfer,,,,`
      ];
      const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pocket-import-template.csv";
      a.click();
    }
    startImport(input) {
      const file = input?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = this.#parseCsv(String(reader.result));
          if (!parsed.data.length) return this.#toast.show("No data rows found in CSV");
          const plan = this.#buildImportPlan(parsed.data, parsed.headers);
          this.#importPlan = plan;
          this.#openImportPreview(plan);
        } catch (e) {
          this.#toast.show("Could not parse CSV: " + e.message);
        }
      };
      reader.readAsText(file);
      input.value = "";
    }
    commitImport() {
      const plan = this.#importPlan;
      if (!plan) return;
      const replaceEl = document.getElementById("importReplace");
      const includeDupesEl = document.getElementById("importIncludeDupes");
      const replace = replaceEl?.checked;
      const includeDupes = includeDupesEl?.checked;
      if (replace && !confirm("Replace ALL existing data with the import? This cannot be undone.")) return;
      const state = this.#store.getState();
      if (replace) {
        state.accounts = [];
        state.categories = [];
        state.transactions = [];
        state.budgets = [];
        state.debts = [];
        state.merchantCategories = {};
        plan.txDrafts.forEach((d) => {
          d.isDuplicate = false;
        });
      }
      const accMap = {};
      const norm = (s) => String(s || "").toLowerCase().trim();
      state.accounts.forEach((a) => {
        accMap[norm(a.name)] = a.id;
      });
      plan.newAccounts.forEach((na) => {
        if (!accMap[norm(na.name)]) {
          const id = IdGenerator.generate("acc");
          state.accounts.push({ id, name: na.name, type: na.type, currency: na.currency, color: na.color, icon: na.icon || "wallet", archived: false, balance: 0 });
          accMap[norm(na.name)] = id;
        }
      });
      const currencyVotes = {};
      plan.txDrafts.forEach((d) => {
        const key = norm(d.accountName);
        if (!currencyVotes[key]) currencyVotes[key] = {};
        if (d.currency) currencyVotes[key][d.currency] = (currencyVotes[key][d.currency] || 0) + 1;
      });
      state.accounts.forEach((a) => {
        const votes = currencyVotes[norm(a.name)];
        if (!votes) return;
        const dominant = Object.entries(votes).sort((x, y) => y[1] - x[1])[0]?.[0];
        if (dominant) a.currency = dominant;
      });
      const catMap = {};
      state.categories.forEach((c) => {
        catMap[norm(c.name) + "|" + c.type + "|" + (c.parentId ? "sub" : "root")] = c.id;
      });
      plan.newCategories.sort((a, b) => (a.parentName ? 1 : 0) - (b.parentName ? 1 : 0)).forEach((nc) => {
        const rk = norm(nc.name) + "|" + nc.type + "|root";
        const sk = nc.parentName ? norm(nc.parentName) + "|" + norm(nc.name) + "|" + nc.type + "|sub" : rk;
        if (!catMap[sk]) {
          const parentId = nc.parentName ? catMap[norm(nc.parentName) + "|" + nc.type + "|root"] || null : null;
          const id = IdGenerator.generate("cat");
          state.categories.push({ id, name: nc.name, type: nc.type, color: nc.color, icon: nc.icon, parentId, budgetLimit: null });
          catMap[sk] = id;
          if (!parentId) catMap[rk] = id;
        }
      });
      let txCount = 0;
      plan.txDrafts.forEach((draft) => {
        if (draft.isDuplicate && !includeDupes) return;
        const accId = accMap[norm(draft.accountName)];
        if (!accId) return;
        const acc = state.accounts.find((a) => a.id === accId);
        if (!acc) return;
        const minor = draft.amount;
        const exRate = (RATES[draft.currency] || 1) / (RATES[state.user.homeCurrency] || 1);
        const refAmt = this.#fx.convert(minor, draft.currency, state.user.homeCurrency);
        if (draft.type === "transfer") {
          const toAccId = accMap[norm(draft.toAccountName)];
          if (!toAccId) return;
          const toAcc = state.accounts.find((a) => a.id === toAccId);
          if (!toAcc) return;
          const fromId = IdGenerator.generate("tx");
          const toId = IdGenerator.generate("tx");
          const dstMinor = draft.toAmountMinor ?? minor;
          const toCcy = draft.toCurrency ?? draft.currency;
          const txF = { id: fromId, accountId: accId, categoryId: null, amount: minor, currency: draft.currency, exchangeRate: exRate, refAmount: refAmt, payee: draft.payee, note: draft.note, date: draft.date, hijriDate: this.#hijri.toHijri(draft.date), paymentType: draft.paymentType, recordState: "cleared", type: "transfer", transferPairId: toId, transferDir: "out", tags: draft.tags || [], createdAt: draft.createdAt || (/* @__PURE__ */ new Date()).toISOString(), addedBy: draft.addedBy || null };
          const txT = { id: toId, accountId: toAccId, categoryId: null, amount: dstMinor, currency: toCcy, exchangeRate: (RATES[toCcy] || 1) / (RATES[state.user.homeCurrency] || 1), refAmount: this.#fx.convert(dstMinor, toCcy, state.user.homeCurrency), payee: draft.payee, note: draft.note, date: draft.date, hijriDate: this.#hijri.toHijri(draft.date), paymentType: draft.paymentType, recordState: "cleared", type: "transfer", transferPairId: fromId, transferDir: "in", tags: draft.tags || [], createdAt: draft.createdAt || (/* @__PURE__ */ new Date()).toISOString(), addedBy: draft.addedBy || null };
          state.transactions.push(txF, txT);
          txCount++;
        } else if (Array.isArray(draft.splits)) {
          const splits = draft.splits.map((s) => ({
            categoryId: s.catId ? catMap[norm(s.catId)] || null : null,
            accountId: accMap[norm(s.accountName || draft.accountName)] || accId,
            amount: s.amount
          }));
          const tx = { id: IdGenerator.generate("tx"), accountId: accId, categoryId: null, amount: minor, currency: draft.currency, exchangeRate: exRate, refAmount: refAmt, payee: draft.payee, note: draft.note, date: draft.date, hijriDate: this.#hijri.toHijri(draft.date), paymentType: draft.paymentType, recordState: "cleared", type: draft.type, transferPairId: null, tags: draft.tags || [], splits, createdAt: draft.createdAt || (/* @__PURE__ */ new Date()).toISOString(), addedBy: draft.addedBy || null };
          state.transactions.push(tx);
          txCount++;
        } else {
          const catKey = draft.catName ? draft.subName ? norm(draft.catName) + "|" + norm(draft.subName) + "|" + draft.type + "|sub" : norm(draft.catName) + "|" + draft.type + "|root" : null;
          const catId = catKey ? catMap[catKey] || null : null;
          const tx = { id: IdGenerator.generate("tx"), accountId: accId, categoryId: catId, amount: minor, currency: draft.currency, exchangeRate: exRate, refAmount: refAmt, payee: draft.payee, note: draft.note, date: draft.date, hijriDate: this.#hijri.toHijri(draft.date), paymentType: draft.paymentType, recordState: "cleared", type: draft.type, transferPairId: null, tags: draft.tags || [], splits: null, createdAt: draft.createdAt || (/* @__PURE__ */ new Date()).toISOString(), addedBy: draft.addedBy || null };
          state.transactions.push(tx);
          txCount++;
        }
      });
      this.#store.persist();
      this.#sync.schedulePush?.();
      this.#renderImportDone({ transactions: txCount, accounts: plan.newAccounts.length, categories: plan.newCategories.length, debts: 0 });
      this.#render();
    }
    resetData() {
      if (!confirm("Reset ALL data? This cannot be undone.")) return;
      this.#store.replaceState(SeedFactory.create());
      this.#store.persist();
      this.#render();
      this.#toast.show("Data reset");
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Private: render
    // ──────────────────────────────────────────────────────────────────────────
    #render() {
      const state = this.#store.getState();
      state._sharedData = this.#sync.sharedData;
      state._currentUserEmail = this.#sync.currentUser?.email || null;
      const route = this.#router.current || "dashboard";
      this.#renderView(route);
      this.#nav.render();
      lucide?.createIcons?.();
    }
    #renderView(routeId) {
      const view = this.#getOrCreateView(routeId);
      const content = document.getElementById("viewContent");
      if (!content) return;
      const active = document.activeElement;
      const focusKey = active?.dataset?.focusKey || null;
      let selStart = null, selEnd = null;
      if (focusKey) {
        try {
          selStart = active.selectionStart;
          selEnd = active.selectionEnd;
        } catch (_) {
        }
      }
      const html = view.render?.() ?? "";
      content.innerHTML = html;
      view.onAfterRender?.();
      lucide?.createIcons?.();
      if (focusKey) {
        const el = content.querySelector(`[data-focus-key="${focusKey}"]`);
        if (el) {
          el.focus({ preventScroll: true });
          if (selStart != null && typeof el.setSelectionRange === "function") {
            try {
              el.setSelectionRange(selStart, selEnd);
            } catch (_) {
            }
          }
        }
      }
    }
    #getOrCreateView(id) {
      if (this.#views.has(id)) return this.#views.get(id);
      let view;
      switch (id) {
        case "dashboard":
          view = new DashboardView();
          break;
        case "transactions":
          view = new TransactionsView();
          break;
        case "accounts":
          view = new AccountsView();
          break;
        case "accountDetail":
          view = new AccountDetailView();
          break;
        case "budgets":
          view = new BudgetsView();
          break;
        case "budgetDetail":
          view = new BudgetDetailView();
          break;
        case "categories":
          view = new CategoriesView();
          break;
        case "reports":
          view = new ReportsView();
          break;
        case "debts":
          view = new DebtsView();
          break;
        case "calendar":
          view = new CalendarView();
          break;
        case "family":
          view = new FamilyView();
          break;
        default:
          view = { render: () => `<div class="p-6 text-zinc-400">View not found: ${id}</div>` };
      }
      this.#views.set(id, view);
      return view;
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Private: theme
    // ──────────────────────────────────────────────────────────────────────────
    #applyTheme() {
      this.#themeService.apply();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Private: state migrations / defaults
    // ──────────────────────────────────────────────────────────────────────────
    #ensureUserDefaults() {
      const state = this.#store.getState();
      state.user = Object.assign({
        homeCurrency: "USD",
        defaultCurrency: "USD",
        theme: "system",
        showHijri: true,
        calendarMode: "both",
        dateFormat: "auto",
        geminiApiKey: "",
        supabaseUrl: "",
        supabaseKey: "",
        hijriOffset: 0
      }, state.user);
      if (!state.user.defaultCurrency) state.user.defaultCurrency = state.user.homeCurrency;
      if (!state.user.calendarMode) state.user.calendarMode = state.user.showHijri ? "both" : "gregorian";
      if (!Array.isArray(state.debts)) state.debts = [];
      if (!Array.isArray(state.regularItems)) state.regularItems = [];
      if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
      if (!Array.isArray(state.family)) state.family = [];
      if (!Array.isArray(state.user.collapsedAccountGroups)) state.user.collapsedAccountGroups = [];
      if (!state.merchantCategories) state.merchantCategories = {};
      if (typeof state.user.hijriOffset !== "number") state.user.hijriOffset = 0;
      if (!Array.isArray(state.user.customPaymentTypes)) state.user.customPaymentTypes = [];
      if (!Array.isArray(state.user.collapsedCategories)) state.user.collapsedCategories = [];
      if (Array.isArray(state.regularItems)) {
        state.regularItems.forEach((it) => {
          if (!it.accountId && Array.isArray(state.accounts) && state.accounts[0]?.id) {
            it.accountId = state.accounts[0].id;
          }
        });
      }
      if (Array.isArray(state.regularLogs) && state.regularLogs.length > 0) {
        if (!Array.isArray(state.transactions)) state.transactions = [];
        state.regularLogs.forEach((log) => {
          const exists = state.transactions.some((t) => t.id === log.id || t.regularLogId === log.id);
          if (!exists) {
            state.transactions.push({
              id: log.id,
              regularLogId: log.id,
              regularItemId: log.regularItemId,
              accountId: log.accountId || state.accounts?.[0]?.id,
              date: log.date,
              amount: log.amount,
              currency: log.currency || state.user?.homeCurrency || "USD",
              description: log.note || "",
              payee: log.note || "",
              note: "",
              type: "expense",
              categoryId: null,
              splits: [],
              paymentType: "cash",
              recurring: false,
              qty: log.qty || 1,
              unitAmount: log.unitAmount || log.amount,
              recordState: "cleared",
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        });
        delete state.regularLogs;
      }
      if (Array.isArray(state.budgets)) {
        state.budgets.forEach((b) => {
          if (b && b.period !== "hijri") b.period = "gregorian";
          if (b && !Array.isArray(b.categoryIds)) b.categoryIds = b.categoryId ? [b.categoryId] : [];
        });
      }
      const needsHijriBackfill = (state.transactions || []).some((t) => !t.hijriDate);
      if (needsHijriBackfill) {
        (state.transactions || []).forEach((t) => {
          if (!t.hijriDate && t.date) {
            t.hijriDate = this.#hijri.toHijriRaw(t.date);
          }
        });
      }
      if (!state._transferDirBackfilled) {
        state.transactions.forEach((t, i) => {
          if (t.type !== "transfer" || !t.transferPairId || t.transferDir) return;
          const pairIdx = state.transactions.findIndex((x) => x.id === t.transferPairId);
          if (pairIdx < 0) return;
          const pair = state.transactions[pairIdx];
          if (pair.transferDir) return;
          if (i < pairIdx) {
            t.transferDir = "out";
            pair.transferDir = "in";
          } else {
            t.transferDir = "in";
            pair.transferDir = "out";
          }
        });
        state._transferDirBackfilled = true;
      }
      this.#store.persist();
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Private: balance helpers
    // ──────────────────────────────────────────────────────────────────────────
    // Balance mutations delegate to AccountService — the single source of truth
    // (I1). AccountService operates on the same Store state instance, so the
    // `state` argument is accepted for call-site compatibility but unused here.
    // It handles splits, transfers (direction-aware), and FX conversion.
    /** Minimal HTML-escape for user-supplied strings interpolated into innerHTML (B6). */
    #esc(s) {
      return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Private: account group helper
    // ──────────────────────────────────────────────────────────────────────────
    #resolveAccountGroupId(data, state) {
      let { groupId } = data;
      if (!groupId) return { groupId: null };
      if (groupId === "__new__") {
        const name = (data.newGroupName || "").trim();
        if (!name) return { error: "New group name is required" };
        const norm = (s) => s.toLowerCase().trim();
        const exists = (state.accountGroups || []).find((g) => norm(g.name) === norm(name));
        if (exists) return { groupId: exists.id };
        const id = IdGenerator.generate("grp");
        if (!Array.isArray(state.accountGroups)) state.accountGroups = [];
        state.accountGroups.push({ id, name, color: this.#deterministicColor(name) });
        return { groupId: id };
      }
      return { groupId };
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Private: range helper
    // ──────────────────────────────────────────────────────────────────────────
    #withinRange(iso, days) {
      if (days === "all") return true;
      const d = /* @__PURE__ */ new Date(iso + "T12:00:00");
      const start = /* @__PURE__ */ new Date();
      start.setDate(start.getDate() - Number(days));
      return d >= start;
    }
    // ──────────────────────────────────────────────────────────────────────────
    // Private: CSV import helpers
    // ──────────────────────────────────────────────────────────────────────────
    #parseCsv(text) {
      if (text.charCodeAt(0) === 65279) text = text.slice(1);
      const rows = [];
      let cur = [], field = "", inQ = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i], nx = text[i + 1];
        if (inQ) {
          if (c === '"' && nx === '"') {
            field += '"';
            i++;
          } else if (c === '"') inQ = false;
          else field += c;
        } else {
          if (c === '"') inQ = true;
          else if (c === ",") {
            cur.push(field);
            field = "";
          } else if (c === "\n" || c === "\r") {
            if (c === "\r" && nx === "\n") i++;
            cur.push(field);
            field = "";
            if (cur.length > 1 || cur[0].trim() !== "") rows.push(cur);
            cur = [];
          } else field += c;
        }
      }
      if (field !== "" || cur.length) {
        cur.push(field);
        if (cur.some((v) => v.trim() !== "")) rows.push(cur);
      }
      if (!rows.length) return { headers: [], data: [] };
      const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_\-]+/g, ""));
      const data = rows.slice(1).filter((r) => r.some((v) => (v || "").trim() !== "")).map((r) => {
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = (r[i] ?? "").trim();
        });
        return obj;
      });
      return { headers, data };
    }
    #buildImportPlan(rows, _headers) {
      const state = this.#store.getState();
      const norm = (s) => String(s || "").toLowerCase().trim();
      const txDrafts = [];
      const newAccs 