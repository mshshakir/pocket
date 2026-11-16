/**
 * DriveAuthHandler with a stand-in for Google's token endpoint.
 * Run: deno run supabase/functions/drive-auth/test/handler_test.ts
 */
import { DriveAuthHandler } from '../lib/DriveAuthHandler.ts';
import { GoogleOAuth } from '../lib/GoogleOAuth.ts';

let passed = 0, failed = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
};
console.log('\ndrive-auth handler');

const SITE = 'https://mshshakir.github.io';
const SCOPE = DriveAuthHandler.SCOPE;

class FakeGoogle {
  sent: URLSearchParams[] = [];
  down = false;
  answer: { status: number; body: Record<string, unknown> } | null = null;
  fetch = (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (this.down) return Promise.reject(new Error('network'));
    const form = init!.body as URLSearchParams;
    this.sent.push(form);
    if (this.answer) return Promise.resolve(new Response(JSON.stringify(this.answer.body), { status: this.answer.status }));
    if (form.get('grant_type') === 'authorization_code') {
      return Promise.resolve(form.get('code') === 'good-code'
        ? new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3599, refresh_token: 'rt-1', scope: SCOPE }), { status: 200 })
        : new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    }
    return Promise.resolve(form.get('refresh_token') === 'rt-1'
      ? new Response(JSON.stringify({ access_token: 'at-2', expires_in: 3599, scope: SCOPE }), { status: 200 })
      : new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
  };
}

const google = new FakeGoogle();
const handler = new DriveAuthHandler(new GoogleOAuth('client-id', 'client-secret', google.fetch as typeof fetch), [SITE, 'http://localhost:5173/']);
const call = async (h: DriveAuthHandler, body: unknown, { origin = SITE, method = 'POST' } = {}) => {
  const res = await h.handle(new Request('https://x.supabase.co/functions/v1/drive-auth', {
    method, headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  }));
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch (_) { /* not JSON */ }
  return { status: res.status, json, headers: res.headers };
};

{
  const s = await call(handler, { action: 'status' });
  ok('status: automatic when the secret is set', s.status === 200 && s.json.automatic === true);
  ok('answers carry CORS for the calling site only, and are never cached',
    s.headers.get('Access-Control-Allow-Origin') === SITE && s.headers.get('Cache-Control') === 'no-store' && s.headers.get('Vary') === 'Origin');
  const off = await call(new DriveAuthHandler(null, [SITE]), { action: 'status' });
  ok('status: not automatic without the secret', off.status === 200 && off.json.automatic === false);
  const refused = await call(new DriveAuthHandler(null, [SITE]), { action: 'exchange', code: 'good-code' });
  ok('without the secret, exchange says not_configured (503)', refused.status === 503 && refused.json.error === 'not_configured');
}

{
  const x = await call(handler, { action: 'exchange', code: 'good-code' });
  ok('exchange: a good code returns access and refresh tokens', x.status === 200 && x.json.accessToken === 'at-1' && x.json.refreshToken === 'rt-1' && x.json.expiresIn === 3599);
  const sent = google.sent.at(-1)!;
  ok('exchange: Google is sent the code, the client id and secret, and redirect_uri postmessage',
    sent.get('code') === 'good-code' && sent.get('client_id') === 'client-id' && sent.get('client_secret') === 'client-secret' && sent.get('redirect_uri') === 'postmessage');
  const bad = await call(handler, { action: 'exchange', code: 'used-code' });
  ok('exchange: a refused code is 401 with Google\'s reason', bad.status === 401 && bad.json.error === 'invalid_grant');
  const none = await call(handler, { action: 'exchange' });
  ok('exchange: no code is 400', none.status === 400 && none.json.error === 'code_needed');
  google.answer = { status: 200, body: { access_token: 'at', expires_in: 3599, refresh_token: 'rt', scope: 'openid email' } };
  const scope = await call(handler, { action: 'exchange', code: 'good-code' });
  ok('exchange: the Drive box left unticked is refused (no tokens handed out)', scope.status === 401 && scope.json.error === 'scope_denied' && !('refreshToken' in scope.json));
  google.answer = { status: 200, body: { access_token: 'at', expires_in: 3599, scope: SCOPE } };
  const again = await call(handler, { action: 'exchange', code: 'good-code' });
  ok('exchange: when Google gives no refresh token, refreshToken is null', again.status === 200 && again.json.refreshToken === null);
  google.answer = null;
}

{
  const r = await call(handler, { action: 'refresh', refreshToken: 'rt-1' });
  ok('refresh: a good refresh token returns a new access token only', r.status === 200 && r.json.accessToken === 'at-2' && !('refreshToken' in r.json));
  const gone = await call(handler, { action: 'refresh', refreshToken: 'withdrawn' });
  ok('refresh: a withdrawn permission is 401 invalid_grant', gone.status === 401 && gone.json.error === 'invalid_grant');
  google.answer = { status: 503, body: { error: 'backend' } };
  const down = await call(handler, { action: 'refresh', refreshToken: 'rt-1' });
  google.answer = null; google.down = true;
  const unreachable = await call(handler, { action: 'refresh', refreshToken: 'rt-1' });
  google.down = false;
  ok('refresh: Google down or unreachable is 502 (not "connect again")', down.status === 502 && unreachable.status === 502 && unreachable.json.error === 'unreachable');
  const long = await call(handler, { action: 'refresh', refreshToken: 'x'.repeat(5000) });
  ok('refresh: an oversized value is refused before reaching Google', long.status === 400);
}

{
  const before = google.sent.length;
  const other = await call(handler, { action: 'refresh', refreshToken: 'rt-1' }, { origin: 'https://evil.example' });
  const noOrigin = await call(handler, { action: 'refresh', refreshToken: 'rt-1' }, { origin: '' });
  ok('another website, or no Origin, is refused and Google is never called',
    other.status === 403 && noOrigin.status === 403 && !other.headers.get('Access-Control-Allow-Origin') && google.sent.length === before);
  const local = await call(handler, { action: 'status' }, { origin: 'http://localhost:5173' });
  ok('localhost (development) is allowed', local.status === 200);
  const pre = await handler.handle(new Request('https://x/functions/v1/drive-auth', { method: 'OPTIONS', headers: { Origin: SITE } }));
  const preBad = await handler.handle(new Request('https://x/functions/v1/drive-auth', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }));
  ok('preflight: allowed for Pocket\'s site, refused for others', pre.status === 200 && pre.headers.get('Access-Control-Allow-Origin') === SITE && preBad.status === 403);
  const get = await call(handler, null, { method: 'GET' });
  const junk = await call(handler, 'not json');
  const unknown = await call(handler, { action: 'delete-everything' });
  ok('GET, bad JSON and unknown actions are 400', get.status === 400 && junk.status === 400 && unknown.status === 400);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
