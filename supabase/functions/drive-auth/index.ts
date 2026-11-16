/**
 * drive-auth — lets the app back up to a person's Google Drive by itself.
 *
 * Google only gives a long-lived permission (a refresh token) to a server
 * that holds the client secret. This function is that server and nothing
 * more: the app sends the code from Google's sign-in window and gets tokens
 * back; later it sends its refresh token and gets a fresh access token. The
 * refresh token is kept on the person's device, never here. Backup files go
 * from the device straight to Google and never pass through this function.
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   GOOGLE_DRIVE_CLIENT_SECRET   Google Cloud Console → Credentials → the OAuth client → Client secret
 *   GOOGLE_DRIVE_CLIENT_ID       optional; defaults to Pocket's client ID below
 *   DRIVE_AUTH_ORIGINS           optional, comma-separated site addresses allowed to call
 *                                (default: Pocket's site and localhost for development)
 * Without the secret the function answers { automatic: false } and the app
 * falls back to asking for a tap when a backup is due.
 *
 * Deployed with --no-verify-jwt: people on the free plan never sign in to
 * Pocket, and backups are for them too. The Origin check is the gate.
 */
import { DriveAuthHandler } from './lib/DriveAuthHandler.ts';
import { GoogleOAuth } from './lib/GoogleOAuth.ts';

const env = Deno.env.toObject();
const clientId = (env.GOOGLE_DRIVE_CLIENT_ID ?? '555526225800-2aq7idv11et2m9r956ine6usgndmqr1f.apps.googleusercontent.com').trim();
const clientSecret = (env.GOOGLE_DRIVE_CLIENT_SECRET ?? '').trim();
const origins = (env.DRIVE_AUTH_ORIGINS ?? 'https://mshshakir.github.io,http://localhost:5173').split(',');

const handler = new DriveAuthHandler(clientSecret ? new GoogleOAuth(clientId, clientSecret) : null, origins);

Deno.serve((req) => handler.handle(req));
