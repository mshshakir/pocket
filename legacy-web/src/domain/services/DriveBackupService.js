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
 * The link to Drive belongs to this device and to whoever's book is on it:
 * the settings record the book's owner, and anyone else finds Drive "not
 * connected", so one person's book can never be saved into another's Drive.
 *
 * Scheduling: a website can't run while it is closed, and Google's window
 * needs a tap. So a schedule means: when Pocket is opened and a backup is
 * due, it says so with a Back up now button (see BackupNotice).
 */
import { BackupFiles }    from './BackupFiles.js';
import { BackupSchedule } from './BackupSchedule.js';

export class DriveBackupService {
  static FOLDER = 'Pocket backups';
  static KEEP = 10;
  static #KEY = 'pocket.v1.drive';
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
   * @returns {{connected: boolean, email: string, schedule: BackupSchedule, lastAt: string|null, due: boolean}}
   */
  status(owner) {
    const s = this.#settingsFor(owner);
    const schedule = new BackupSchedule(s?.frequency);
    return {
      connected: !!s,
      email: s?.email || '',
      schedule,
      lastAt: s?.lastAt || null,
      due: !!s && schedule.isDue(s.lastAt, this.#now()),
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

  /** Unlink. Backups already in Drive stay there. */
  async disconnect() {
    try { this.#storage.removeItem(DriveBackupService.#KEY); } catch (_) { /* private mode */ }
    await this.#tokens.revoke();
    this.#tokens.account = '';
  }

  /** @param {string|null} owner @param {string} frequency  off | daily | weekly | monthly */
  setFrequency(owner, frequency) {
    const s = this.#settingsFor(owner);
    if (!s) return;
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
      const folderId = await this.#folder(s);
      const { stamp, files } = BackupFiles.make(state, csv, this.#now());
      for (const file of files) await this.#drive.upload({ folderId, name: file.name, mime: file.mime, body: file.body });
      this.#save({ ...s, folderId, lastAt: this.#now().toISOString() });
      const removed = await this.#prune(folderId).catch(() => 0);
      return { stamp, removed };
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
    return s;
  }

  /** The saved link, only if it was made for this book's owner. */
  #settingsFor(owner) {
    let s = null;
    try { s = JSON.parse(this.#storage.getItem(DriveBackupService.#KEY) || 'null'); } catch (_) { s = null; }
    if (!s || typeof s !== 'object' || !s.folderId) return null;
    return s.owner === DriveBackupService.#ownerKey(owner) ? s : null;
  }

  #save(settings) {
    try { this.#storage.setItem(DriveBackupService.#KEY, JSON.stringify(settings)); } catch (_) { /* storage full or private mode */ }
  }

  static #ownerKey(owner) { return owner || DriveBackupService.GUEST; }
}
