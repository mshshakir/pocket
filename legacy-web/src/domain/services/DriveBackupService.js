/**
 * DriveBackupService — backups of the book to the person's own Google Drive.
 *
 * Works for everyone, including people who never sign in to Pocket: the files
 * go from this device straight to their Drive, into a "Pocket backups" folder.
 * Pocket's server is not involved and never sees them.
 *
 * Each backup is two files (see BackupFiles): the whole book, which Pocket can
 * restore, and a CSV of every transaction. The newest KEEP backups are kept;
 * older ones are removed from the folder.
 *
 * Backing up by hand and restoring are free for everyone. A schedule and
 * automatic backups need the add-on (bought once, or included in Sync and
 * Family): the app tells this service with setUnlocked(), and it is
 * remembered on the device so the schedule keeps working offline. Without
 * it the schedule reads as "off" and nothing is ever due.
 *
 * The link to Drive belongs to this device and to whoever's book is on it:
 * the settings record the book's owner, and anyone else finds Drive "not
 * connected", so one person's book can never be saved into another's Drive.
 *
 * Scheduling: a website can't run while it is closed. When Pocket is opened
 * and a backup is due:
 *   - by default it says so with a Back up now button (Google's window needs
 *     a tap) — see AppNotices;
 *   - with automatic backups switched on (opt-in), it backs up by itself.
 *     Switching on asks Google for lasting permission (a refresh token, got
 *     through Pocket's drive-auth function); the token is kept in this
 *     device's settings and nowhere else. If Google later withdraws it,
 *     automatic mode turns itself off and the Back up now button returns.
 */
import { GoogleAuthError } from '../../core/GoogleTokenClient.js';
import { BackupFiles }    from './BackupFiles.js';
import { BackupSchedule } from './BackupSchedule.js';

export class DriveBackupService {
  static FOLDER = 'Pocket backups';
  static KEEP = 10;
  static #KEY = 'pocket.v1.drive';
  /** When an automatic backup last started on this device (any tab). */
  static #AUTO_KEY = 'pocket.v1.drive.auto';
  /** Whose book has scheduled backups unlocked on this device (an owner key). */
  static #UNLOCKED_KEY = 'pocket.v1.drive.unlocked';
  /** After an automatic try, wait this long before another (also stops two tabs both saving). */
  static #AUTO_GAP_MS = 30 * 60_000;
  /** The owner recorded for a book nobody has signed in to. */
  static GUEST = 'guest';

  #tokens;
  #drive;
  #storage;
  #now;
  #busy = false;

  /**
   * @param {object} deps
   * @param {import('../../core/GoogleTokenClient.js').GoogleTokenClient} deps.tokens
   * @param {import('./DriveClient.js').DriveClient} deps.drive
   * @param {{getItem: Function, setItem: Function, removeItem: Function}} deps.storage  this device's storage
   * @param {() => Date} [deps.now]
   */
  constructor({ tokens, drive, storage, now = () => new Date() }) {
    this.#tokens = tokens;
    this.#drive = drive;
    this.#storage = storage;
    this.#now = now;
  }

  /** Whether the feature can be offered at all (a Google client ID is set). */
  get available() { return this.#tokens.configured; }

  get busy() { return this.#busy; }

  /** Get ready for a tap on Connect / Back up now (loads Google's sign-in library). */
  warm() { this.#tokens.warm(); }

  /**
   * Where things stand for this book.
   * @param {string|null} owner  whose book is on the device (a user id), or null for a guest's
   * @returns {{connected: boolean, email: string, schedule: BackupSchedule, lastAt: string|null, due: boolean, progress: number|null, daysLeft: number|null, automatic: boolean, unlocked: boolean}}
   *   automatic: backups run by themselves (the person switched it on)
   *   unlocked: a schedule and automatic backups are available (the add-on, or a plan that includes it)
   *   progress: how far through the period the last backup is (see BackupSchedule.progress)
   */
  status(owner) {
    const s = this.#settingsFor(owner);
    const unlocked = this.unlocked(owner);
    const schedule = new BackupSchedule(unlocked ? s?.frequency : 'off');
    return {
      unlocked,
      connected: !!s,
      email: s?.email || '',
      schedule,
      lastAt: s?.lastAt || null,
      due: !!s && schedule.isDue(s.lastAt, this.#now()),
      progress: s ? schedule.progress(s.lastAt, this.#now()) : null,
      daysLeft: s ? schedule.daysLeft(s.lastAt, this.#now()) : null,
      automatic: unlocked && !!s?.refreshToken,
    };
  }

  /**
   * Link this book to a Google Drive. Opens Google's window (call from a tap).
   * @param {string|null} owner
   */
  async connect(owner) {
    return this.#exclusive(async () => {
      this.#tokens.account = '';
      await this.#tokens.token();
      const who = await this.#drive.account().catch(() => ({ email: '', name: '' }));
      const folderId = await this.#drive.ensureFolder(DriveBackupService.FOLDER);
      this.#tokens.account = who.email;
      this.#save({
        owner: DriveBackupService.#ownerKey(owner), email: who.email, name: who.name,
        folderId, frequency: BackupSchedule.DEFAULT, lastAt: null,
      });
      return this.status(owner);
    });
  }

  /** Whether scheduled and automatic backups are unlocked for this book on this device. */
  unlocked(owner) {
    return this.#read(DriveBackupService.#UNLOCKED_KEY) === DriveBackupService.#ownerKey(owner);
  }

  /**
   * Record what the person's plan says (called when the plan is known).
   * @param {string|null} owner @param {boolean} yes
   */
  setUnlocked(owner, yes) {
    try {
      if (yes) this.#storage.setItem(DriveBackupService.#UNLOCKED_KEY, DriveBackupService.#ownerKey(owner));
      else if (this.unlocked(owner)) this.#storage.removeItem(DriveBackupService.#UNLOCKED_KEY);
    } catch (_) { /* private mode */ }
  }

  /** Whether automatic backups can be offered (the server side is set up). @returns {Promise<boolean>} */
  automaticOffered() { return this.#tokens.automaticOffered(); }

  /**
   * Switch automatic backups on. Opens Google's window once more (call from a tap).
   * @param {string|null} owner
   */
  async enableAutomatic(owner) {
    if (!this.unlocked(owner)) throw new Error('Automatic backups are part of scheduled backups. Unlock them first.');
    return this.#exclusive(async () => {
      const s = this.#linked(owner);
      const refreshToken = await this.#tokens.authorizeOffline();
      this.#save({ ...s, refreshToken });
    });
  }

  /** Switch automatic backups off: the lasting permission is forgotten on this device. */
  disableAutomatic(owner) {
    const s = this.#settingsFor(owner);
    if (!s) return;
    const { refreshToken: _dropped, ...rest } = s;
    this.#save(rest);
    this.#tokens.refreshToken = '';
  }

  /**
   * Whether an automatic backup should start now: switched on, due, and no
   * other try (in any tab) in the last half hour. Claims the turn if so.
   * @param {string|null} owner
   */
  claimAutomaticRun(owner) {
    const st = this.status(owner);
    if (!st.automatic || !st.due || this.#busy) return false;
    const last = Number(this.#read(DriveBackupService.#AUTO_KEY)) || 0;
    const now = this.#now().getTime();
    if (now - last < DriveBackupService.#AUTO_GAP_MS && now >= last) return false;
    try { this.#storage.setItem(DriveBackupService.#AUTO_KEY, String(now)); } catch (_) { /* private mode */ }
    return true;
  }

  /** Unlink. Backups already in Drive stay there. */
  async disconnect() {
    try { this.#storage.removeItem(DriveBackupService.#KEY); } catch (_) { /* private mode */ }
    this.#tokens.refreshToken = '';
    await this.#tokens.revoke();
    this.#tokens.account = '';
  }

  /** @param {string|null} owner @param {string} frequency  off | daily | weekly | monthly */
  setFrequency(owner, frequency) {
    const s = this.#settingsFor(owner);
    if (!s || !this.unlocked(owner)) return;
    this.#save({ ...s, frequency: new BackupSchedule(frequency).key });
  }

  /**
   * Save a backup now, then drop the oldest beyond KEEP.
   * @param {{owner: string|null, state: object, csv: string}} book
   * @returns {Promise<{stamp: string, removed: number}>}
   */
  async backup({ owner, state, csv }) {
    return this.#exclusive(async () => {
      const s = this.#linked(owner);
      try {
        const folderId = await this.#folder(s);
        const { stamp, files } = BackupFiles.make(state, csv, this.#now());
        for (const file of files) await this.#drive.upload({ folderId, name: file.name, mime: file.mime, body: file.body });
        this.#save({ ...this.#settingsFor(owner), folderId, lastAt: this.#now().toISOString() });
        const removed = await this.#prune(folderId).catch(() => 0);
        return { stamp, removed };
      } catch (e) {
        // Google withdrew the lasting permission: back to asking for a tap.
        if (e instanceof GoogleAuthError && e.code === 'reconnect') this.disableAutomatic(owner);
        throw e;
      }
    });
  }

  /**
   * The backups in Drive, newest first (only those with a book to restore).
   * @param {string|null} owner
   */
  async list(owner) {
    const s = this.#linked(owner);
    const files = await this.#drive.list(s.folderId);
    return BackupFiles.group(files).filter((b) => b.book);
  }

  /**
   * Fetch one backup's book, ready to restore.
   * @param {string|null} owner @param {string} fileId  the book file's id
   * @returns {Promise<object>}
   */
  async fetchBook(owner, fileId) {
    this.#linked(owner);
    return BackupFiles.parseBook(await this.#drive.download(fileId));
  }

  // ── Internals ────────────────────────────────────────────────────────

  /** The folder to save into; made again if the person deleted it. */
  async #folder(s) {
    if (s.folderId && await this.#drive.folderExists(s.folderId)) return s.folderId;
    return this.#drive.ensureFolder(DriveBackupService.FOLDER);
  }

  async #prune(folderId) {
    const old = BackupFiles.group(await this.#drive.list(folderId)).slice(DriveBackupService.KEEP);
    let removed = 0;
    for (const backup of old) {
      for (const id of backup.fileIds) await this.#drive.remove(id);
      removed++;
    }
    return removed;
  }

  /** One Drive job at a time, so a double tap can't save twice. */
  async #exclusive(job) {
    if (this.#busy) throw new Error('A backup is already running');
    this.#busy = true;
    try { return await job(); } finally { this.#busy = false; }
  }

  #linked(owner) {
    const s = this.#settingsFor(owner);
    if (!s) throw new Error('Connect Google Drive first');
    this.#tokens.account = s.email;
    this.#tokens.refreshToken = this.unlocked(owner) ? (s.refreshToken || '') : '';
    return s;
  }

  /** The saved link, only if it was made for this book's owner. */
  #settingsFor(owner) {
    let s = null;
    try { s = JSON.parse(this.#storage.getItem(DriveBackupService.#KEY) || 'null'); } catch (_) { s = null; }
    if (!s || typeof s !== 'object' || !s.folderId) return null;
    return s.owner === DriveBackupService.#ownerKey(owner) ? s : null;
  }

  #read(key) {
    try { return this.#storage.getItem(key); } catch (_) { return null; }
  }

  #save(settings) {
    try { this.#storage.setItem(DriveBackupService.#KEY, JSON.stringify(settings)); } catch (_) { /* storage full or private mode */ }
  }

  static #ownerKey(owner) { return owner || DriveBackupService.GUEST; }
}
