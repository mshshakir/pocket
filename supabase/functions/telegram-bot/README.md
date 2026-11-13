# Pocket Telegram bot — setup

Log Pocket transactions by messaging a Telegram bot.

## Who can write where

Each person connects their own chat with `/link their@email` and the 6-digit code Supabase emails
them (the same sign-in code the Pocket app uses). No one else is involved, no accounts are created,
and the replies never reveal whether an email has an account. A linked chat can write to:

- **Their own book:** saved directly into their `user_data`, using the same versioned save the app
  uses, so it never overwrites a save from the app.
- **Books shared with them:** only accounts whose owner has given their email add, edit or full
  access (the owner's own `family` permissions). These go through the owner's
  `family_contributions` inbox, and the owner's app checks the permission again before merging.

Nothing else is reachable, and every button tap is checked against the same rules.
`/unlink` disconnects a chat.

## 1. Create the bot

In Telegram, message **@BotFather** → `/newbot` → copy the **token**.

## 2. Create the tables

Supabase dashboard → **SQL Editor** → run, in order, `supabase/migrations/0005_telegram_links.sql`,
`0006_telegram_pending.sql` and `0007_telegram_self_link.sql`.

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

## 5. Connect a chat

Anyone with a Pocket account messages the bot `/link their@email`, then sends the code from their
email. Send `/accounts` to see their own accounts and those shared with them.

Supabase's built-in mailer sends at most 2 sign-in emails per hour for the whole project (shared
with app sign-ins); set up custom SMTP if that becomes a problem.

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

**Every expense and income needs a subcategory.** Without one, the bot shows the main
categories as buttons, then the chosen one's subcategories, and saves nothing until a
subcategory is tapped or typed; a main category on its own is never saved. Same-named
categories are told apart by parent (`@childrentoiletries`). Transfers need no category.

**Each confirmation has ✏️ Edit and 🗑 Delete buttons.** Edit asks for the corrected entry and
replaces the original rows in place; Delete removes them. For a family member, changes to an
entry the owner's app has already merged follow the app's rules: editing needs edit access,
deleting needs full access.

Commands (also in the bot's menu button): `/help` shows the full guide; `/accounts` lists accounts;
`/categories` lists expense categories; `/link` and `/unlink` connect or disconnect a chat;
`/default` shows or changes the default account; `/cancel` drops an entry waiting for a category,
or an edit.
