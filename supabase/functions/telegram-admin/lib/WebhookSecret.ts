/**
 * WebhookSecret — the secret Telegram sends with every update, worked out
 * from the bot token (so no second secret is needed): the first 48 hex
 * characters of SHA-256("pocket-admin-webhook:" + token).
 */
export class WebhookSecret {
  static async from(token: string): Promise<string> {
    const bytes = new TextEncoder().encode(`pocket-admin-webhook:${token}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
  }
}
