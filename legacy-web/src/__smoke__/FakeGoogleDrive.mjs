/**
 * FakeGoogleDrive — an in-memory stand-in for the parts of Google the Drive
 * backup talks to, for the smoke suites:
 *
 *   signIn()   Google Identity Services' token window (window.google.accounts.oauth2)
 *   fetch()    the Drive v3 REST calls DriveClient makes: about, files.list (q=),
 *              files.create (folder), multipart and resumable uploads, alt=media,
 *              files.get, files.delete
 *
 * Tests read and seed files directly with files / add().
 */
export class FakeGoogleDrive {
  /** @type {Map<string, {id: string, name: string, mimeType: string, parents: string[], body: string, createdTime: string, trashed: boolean}>} */
  files = new Map();
  email = 'me@example.com';
  /** How the next Google window ends: 'ok' | 'closed' | 'blocked'. */
  window = 'ok';
  windowsOpened = 0;
  lastHint = undefined;
  requests = [];
  /** Answer the next Drive call with this status once (e.g. 401, 403). */
  failNext = null;
  full = false;

  #seq = 0;
  #token = 0;
  #valid = new Set();
  #sessions = new Map();

  /** window.google for the page. */
  signIn() {
    return { accounts: { oauth2: {
      initTokenClient: (cfg) => ({
        requestAccessToken: () => {
          this.windowsOpened++;
          this.lastHint = cfg.hint;
          setTimeout(() => {
            if (this.window === 'closed') return cfg.error_callback({ type: 'popup_closed' });
            if (this.window === 'blocked') return cfg.error_callback({ type: 'popup_failed_to_open' });
            const token = `tok-${++this.#token}`;
            this.#valid.add(token);
            cfg.callback({ access_token: token, expires_in: 3600, scope: cfg.scope });
          }, 0);
        },
      }),
      revoke: (token, done) => { this.#valid.delete(token); done?.(); },
    } } };
  }

  /** Make every token handed out so far stale (as after an hour). */
  expireTokens() { this.#valid.clear(); }

  /** Seed a file. @returns {string} its id */
  add({ name, body = '', parents = [], mimeType = 'application/json', createdTime = new Date().toISOString() }) {
    const id = `f${++this.#seq}`;
    this.files.set(id, { id, name, mimeType, parents, body, createdTime, trashed: false });
    return id;
  }

  /** The files in a folder, by name. */
  namesIn(folderId) {
    return [...this.files.values()].filter((f) => f.parents.includes(folderId) && !f.trashed).map((f) => f.name).sort();
  }

  folderId(name = 'Pocket backups') {
    return [...this.files.values()].find((f) => f.name === name && f.mimeType === 'application/vnd.google-apps.folder' && !f.trashed)?.id || null;
  }

  /** window.fetch for the page (Drive calls only; anything else is "offline"). */
  fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname !== 'www.googleapis.com') throw new Error('offline');
    const method = (init.method || 'GET').toUpperCase();
    this.requests.push(`${method} ${u.pathname}${u.searchParams.get('uploadType') ? `?uploadType=${u.searchParams.get('uploadType')}` : ''}`);
    const auth = init.headers?.Authorization || '';
    if (!this.#valid.has(auth.replace(/^Bearer /, ''))) return FakeGoogleDrive.#res(401, { error: { errors: [{ reason: 'authError' }] } });
    if (this.failNext) { const status = this.failNext; this.failNext = null; return FakeGoogleDrive.#res(status, { error: { errors: [{ reason: 'backendError' }] } }); }

    if (u.pathname === '/drive/v3/about') return FakeGoogleDrive.#res(200, { user: { emailAddress: this.email, displayName: 'Me' } });

    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      if (this.full) return FakeGoogleDrive.#res(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } });
      if (u.searchParams.get('uploadType') === 'multipart') {
        const boundary = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1];
        const parts = String(init.body).split(`--${boundary}`).filter((p) => p.trim() && p.trim() !== '--');
        const meta = JSON.parse(parts[0].split('\r\n\r\n')[1]);
        const body = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
        return FakeGoogleDrive.#res(200, this.#view(this.#create(meta, body)));
      }
      const session = `https://www.googleapis.com/upload/drive/v3/files?upload_id=s${++this.#seq}`;
      this.#sessions.set(session, JSON.parse(init.body));
      return FakeGoogleDrive.#res(200, {}, { Location: session });
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'PUT') {
      const meta = this.#sessions.get(String(url));
      if (!meta) return FakeGoogleDrive.#res(404, {});
      return FakeGoogleDrive.#res(200, this.#view(this.#create(meta, new TextDecoder().decode(init.body))));
    }

    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      return FakeGoogleDrive.#res(200, this.#view(this.#create(JSON.parse(init.body), '')));
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '';
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1');
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const mime = /mimeType = '([^']+)'/.exec(q)?.[1];
      const found = [...this.files.values()]
        .filter((f) => !f.trashed && (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!mime || f.mimeType === mime))
        .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      return FakeGoogleDrive.#res(200, { files: found.map((f) => this.#view(f)) });
    }
    const id = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname)?.[1];
    const file = id ? this.files.get(decodeURIComponent(id)) : null;
    if (!file) return FakeGoogleDrive.#res(404, { error: { errors: [{ reason: 'notFound' }] } });
    if (method === 'DELETE') { this.files.delete(file.id); return FakeGoogleDrive.#res(204, null); }
    if (u.searchParams.get('alt') === 'media') return FakeGoogleDrive.#res(200, file.body, {}, true);
    return FakeGoogleDrive.#res(200, { ...this.#view(file), trashed: file.trashed });
  };

  #create(meta, body) {
    const id = `f${++this.#seq}`;
    const file = { id, name: meta.name, mimeType: meta.mimeType || 'application/octet-stream', parents: meta.parents || [], body, createdTime: new Date(Date.now() + this.#seq).toISOString(), trashed: false };
    this.files.set(id, file);
    return file;
  }

  #view(f) {
    return { id: f.id, name: f.name, size: String(new TextEncoder().encode(f.body).length), createdTime: f.createdTime };
  }

  static #res(status, body, headers = {}, raw = false) {
    const text = raw ? body : (body == null ? '' : JSON.stringify(body));
    return {
      status, ok: status >= 200 && status < 300,
      headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
      json: async () => JSON.parse(text || '{}'),
      text: async () => text,
    };
  }
}
