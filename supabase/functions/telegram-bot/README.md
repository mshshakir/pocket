# Pocket Telegram bot — setup

Log Pocket transactions by messaging a Telegram bot.

## How entries reach Pocket

- **You (the owner):** the bot appends the transaction to your `user_data` book using the
  same versioned save the app uses, so it never overwrites a save from the app. The app
  picks it up live through its existing realtime listener.
- **A family member:** the bot puts it in your `family_contributions` inbox. Your app checks
  their permission (add/edit/full on that account) and merges it on its next sync, exactly
  like an entry they make in the app.

## 1. Create the bot

In Telegram, message **@BotFather** → `/newbot` → copy the **token**.

## 2. Create the link table

Supabase dashboard → **SQL Editor** → run `supabase/migrations/0005_telegram_links.sql`.

## 3. Deploy the function

With the Supabase CLI, from the repo root:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set TELEGRAM_BOT_TOKEN=<token-from-botfather>
supabase secrets set TELEGRAM_WEBHOOK_SECRET=<any-long-random-string>
supabase functions deploy telegram-bot --no-verify-jwt
```

`--no-verify-jwt` is required because Telegram can't send a Supabase login token;
the webhook secret protects the function instead.

## 4. Point Telegram at the function

Open this URL once in a browser (fill in the three values):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project-ref>.supabase.co/functions/v1/telegram-bot&secret_token=<WEBHOOK_SECRET>
```

It should reply `"ok":true`.

## 5. Link your chat

Message your bot anything. It replies with your **chat ID**. Then in the SQL Editor:

```sql
insert into telegram_links (chat_id, owner_id, member_email, default_account_id)
values (
  <chat-id>,
  (select id from auth.users where email = '<owner-email>'),
  '<email-of-the-person-using-this-chat>',
  '<default-account-id or null>'
);
```

For a family member, use the **owner's** email in `owner_id` and the **member's** email in
`member_email`. They must already have add access to that account in the app.

Send `/accounts` to check which accounts you can add to.

## Message format

| You send | Saved as |
|---|---|
| `500 diaper` | ₹500 expense, note "diaper", default payment type |
| `500 diaper cash` | paid in cash (any payment type the app knows) |
| `+45000 salary` | income |
| `250 lunch #wallet` | into the account whose name starts with "wallet" |
| `250 lunch @food` | category whose name starts with "food" |
| `120 taxi yesterday` | dated yesterday |

Amounts in an account's own currency; `₹`, `rs`, `rupees` and commas are accepted.
Edit or delete entries in the app.
