/**
 * DriveClient — the few Google Drive calls Pocket's backup needs.
 *
 * Works with the "drive.file" permission only: Pocket can see and change the
 * files and folders it created itself, and nothing else in the person's Drive.
 * Requests go straight from the browser to Google.
 */
export class DriveClient {
  static SCOPE = 'https://www.googleapis.com/auth/drive.file';
  static #API = 'https://www.googleapis.com/drive/v3';
  static #UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  static #FOLDER_MIME = 'application/vnd.google-apps.folder';
  /** Google's limit for a one-request upload is 5 MB; larger files go in two steps. */
  static #SIMPLE_LIMIT = 4_500_000;
  static #FILE_FIELDS = 'id,name,size,createdTime';

  #tokens;
  #fetch;

  /**
   * @param {object} deps
   * @param {{token: (opts?: object) => Promise<string>, forget: () => void}} deps.tokens
   * @param {typeof fetch} [deps.fetch]
   */
  constructor({ tokens, fetch = (...a) => globalThis.fetch(...a) }) {
    this.#tokens = tokens;
    this.#fetch = fetch;
  }

  /** @returns {Promise<{email: string, name: string}>} whose Drive this is */
  async account() {
    const json = await this.#json(`${DriveClient.#API}/about?fields=${encodeURIComponent('user(displayName,emailAddress)')}`);
    return { email: json.user?.emailAddress || '', name: json.user?.displayName || '' };
  }

  /** The id of Pocket's folder with this name, made if it isn't there. @returns {Promise<string>} */
  async ensureFolder(name) {
    const q = `name = '${DriveClient.#quote(name)}' and mimeType = '${DriveClient.#FOLDER_MIME}' and trashed = false`;
    const found = await this.#json(`${DriveClient.#API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id)')}&pageSize=1`);
    if (found.files?.[0]?.id) return found.files[0].id;
    const made = await this.#json(`${DriveClient.#API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: DriveClient.#FOLDER_MIME }),
    });
    return made.id;
  }

  /** Whether the folder is still there (not deleted or binned by the person). */
  async folderExists(folderId) {
    try {
      const f = await this.#json(`${DriveClient.#API}/files/${encodeURIComponent(folderId)}?fields=${encodeURIComponent('id,trashed')}`);
      return !!f.id && !f.trashed;
    } catch (e) {
      if (e instanceof DriveError && e.status === 404) return false;
      throw e;
    }
  }

  /**
   * Save one text file into a folder.
   * @param {{folderId: string, name: string, mime: string, body: string}} file
   * @returns {Promise<{id: string, name: string, size: number, createdTime: string}>}
   */
  async upload({ folderId, name, mime, body }) {
    const meta = { name, mimeType: mime, parents: [folderId] };
    const bytes = new TextEncoder().encode(body);
    const file = bytes.length <= DriveClient.#SIMPLE_LIMIT
      ? await this.#uploadInOne(meta, mime, body)
      : await this.#uploadInSteps(meta, mime, bytes);
    return DriveClient.#fileOf(file);
  }

  /** The files in a folder, newest first. */
  async list(folderId) {
    const q = `'${DriveClient.#quote(folderId)}' in parents and trashed = false`;
    const out = [];
    let pageToken = '';
    do {
      const page = await this.#json(`${DriveClient.#API}/files?q=${encodeURIComponent(q)}`
        + `&orderBy=${encodeURIComponent('createdTime desc')}&pageSize=200`
        + `&fields=${encodeURIComponent(`nextPageToken,files(${DriveClient.#FILE_FIELDS})`)}`
        + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''));
      out.push(...(page.files || []).map(DriveClient.#fileOf));
      pageToken = page.nextPageToken || '';
    } while (pageToken && out.length < 1000);
    return out;
  }

  /** @returns {Promise<string>} the file's text */
  async download(fileId) {
    const res = await this.#send(`${DriveClient.#API}/files/${encodeURIComponent(fileId)}?alt=media`);
    return res.text();
  }

  async remove(fileId) {
    await this.#send(`${DriveClient.#API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  }

  // ── Uploads ──────────────────────────────────────────────────────────

  #uploadInOne(meta, mime, body) {
    const boundary = `pocket${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const payload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--`;
    return this.#json(`${DriveClient.#UPLOAD}?uploadType=multipart&fields=${encodeURIComponent(DriveClient.#FILE_FIELDS)}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: payload,
    });
  }

  async #uploadInSteps(meta, mime, bytes) {
    const start = await this.#send(`${DriveClient.#UPLOAD}?uploadType=resumable&fields=${encodeURIComponent(DriveClient.#FILE_FIELDS)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime },
      body: JSON.stringify(meta),
    });
    const session = start.headers.get('Location');
    if (!session) throw new DriveError(0, 'Google Drive did not accept the upload. Please try again.');
    const res = await this.#send(session, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes });
    return res.json();
  }

  // ── Requests ─────────────────────────────────────────────────────────

  async #json(url, init) {
    const res = await this.#send(url, init);
    return res.status === 204 ? {} : res.json();
  }

  /** One request with the token; if Google says the token is stale, get a new one and try once more. */
  async #send(url, init = {}, retried = false) {
    const token = await this.#tokens.token();
    let res;
    try {
      res = await this.#fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
    } catch (_) {
      throw new DriveError(0, 'Could not reach Google Drive. Check your connection and try again.');
    }
    if (res.status === 401 && !retried) {
      this.#tokens.forget();
      return this.#send(url, init, true);
    }
    if (!res.ok) throw await DriveError.of(res);
    return res;
  }

  static #fileOf(f) {
    return { id: f.id, name: f.name || '', size: Number(f.size) || 0, createdTime: f.createdTime || '' };
  }

  /** Escape a value for a Drive search (q=) string. */
  static #quote(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}

/** A Drive request that failed; `message` is written for the person. */
export class DriveError extends Error {
  /** @param {number} status @param {string} message @param {string} [reason] */
  constructor(status, message, reason = '') {
    super(message);
    this.name = 'DriveError';
    this.status = status;
    this.reason = reason;
  }

  /** @param {Response} res */
  static async of(res) {
    let reason = '';
    try { reason = (await res.json())?.error?.errors?.[0]?.reason || ''; } catch (_) { /* no details */ }
    if (reason === 'storageQuotaExceeded') return new DriveError(res.status, 'Your Google Drive is full. Free some space and try again.', reason);
    if (res.status === 401 || res.status === 403) return new DriveError(res.status, 'Google Drive did not allow that. Connect Google Drive again.', reason);
    if (res.status === 404) return new DriveError(res.status, 'That file is no longer in your Google Drive.', reason);
    return new DriveError(res.status, 'Google Drive had a problem. Please try again in a moment.', reason);
  }
}
