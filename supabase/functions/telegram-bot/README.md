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

## 2. Create the tables

Supabase dashboard → **SQL Editor** → run `supabase/migrations/0005_telegram_links.sql`, then
`supabase/migrations/0006_telegram_pending.sql` (the step each chat is waiting on).

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
| `70 marol to modi street @taxi` | ₹70 expense, note "marol to modi street", category Taxi |
| `500 diaper cash @toiletries` | paid in cash (any payment type the app knows) |
| `+45000 salary @wazifa` | income |
| `250 lunch #wallet @rest` | into the account whose name starts with "wallet" |
| `120 auto yesterday @rickshaw` | dated yesterday |
| `5000 #boi > #mpesa` | transfer from BOI to MPesa (also `→`, `->`, or just two `#accounts`) |
| `5000 > #mpesa` | transfer from your default account |
| `5000 #boi > #mpesa =7750` | transfer where 7,750 arrived; without `=`, the live rate is used |

Amounts are in the account's own currency (the source account for transfers); `₹`, `rs`,
`rupees` and commas are accepted. Transfers are saved as the same linked out/in pair the app
creates. Exchange rates come from the same live source the app uses (open.er-api.com).

**Every expense and income needs a category.** Without one, the bot shows the most-used
categories as buttons and saves nothing until one is tapped or typed. Same-named categories
are told apart by parent (`@childrentoiletries`). Transfers need no category.

**Each confirmation has ✏️ Edit and 🗑 Delete buttons.** Edit asks for the corrected entry and
replaces the original rows in place; Delete removes them. For a family member, changes to an
entry the owner's app has already merged follow the app's rules: editing needs edit access,
deleting needs full access.

Commands (also in the bot's menu button): `/help` shows the full guide; `/accounts` lists accounts;
`/default` shows or changes the default account; `/cancel` drops an entry waiting for a category,
or an edit.
