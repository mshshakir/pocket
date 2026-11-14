# Pocket Telegram bot — setup

Log Pocket transactions by messaging a Telegram bot.

## Who can write where

Each person connects their own chat with `/link their@email` and the 6-digit code Supabase emails
them (the same sign-in code the Pocket app uses). No one else is involved, no accounts are created,
and the replies never reveal whether an email has an account. A linked chat can write to:

- **Their own book:** each entry is saved as its own rows, through the same `pocket_apply_changes`
  function the app uses, so it never overwrites anything the app saved.
- **Books shared with them:** only accounts whose owner has given their email add, edit or full
  access (the owner's family permissions). Entries go straight into the owner's book. Adding needs
  add access; changing an entry needs edit access and deleting needs full access, except that
  anyone may fix or delete an entry they entered themselves on an account they can add to.

Nothing else is reachable, and every button tap is checked against the same rules.
`/unlink` disconnects a chat.

## 1. Create the bot

In Telegram, message **@BotFather** → `/newbot` → copy the **token**.

## 2. Create the tables

Supabase dashboard → **SQL Editor** → run, in order, `supabase/migrations/0005_telegram_links.sql`,
`0006_telegram_pending.sql`, `0007_telegram_self_link.sql` and `0008_telegram_batch.sql`.
The books themselves live in the tables from `0009_relational_book.sql` to `0012_book_api.sql`.

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
| `450 dinner 8/11 @restaurant` | dated 8 November (day first); `8/11/2025` gives the year. Future dates are refused; without a year, a date more than 30 days ahead means last year (`28/12` in January) |
| `5000 #boi > #mpesa` | transfer from BOI to MPesa (also `→`, `->`, or just two `#accounts`) |
| `5000 > #mpesa` | transfer from your default account |
| `5000 #boi > #mpesa =7750` | transfer where 7,750 arrived; without `=`, the live rate is used |

**Several entries in one message**, one per line:

```
200 fruits
80 clips
1351 oct 2026 bill @electricity #boi
#mpesa @groceries
```

Each line becomes its own entry with its own confirmation and buttons. A line with no amount
(only `#account`, `@category`, a payment type, a date or `yesterday`) applies to every line that doesn't
name its own; a line's own choices always win, and transfers keep their own accounts. Complete
lines are saved at once; lines still missing a category are asked one at a time, and a shared
category that needs choosing (e.g. a main category like `@food`) is asked once for all of them.
Lines without an amount are reported back unsaved. Up to 50 lines per message.

Amounts are in the account's own currency (the source account for transfers); `₹`, `rs`,
`rupees` and commas are accepted. Transfers are saved as the same linked out/in pair the app
creates. Exchange rates come from the same live source the app uses (open.er-api.com).

**Every expense and income needs a subcategory.** Without one, the bot shows the main
categories as buttons, then the chosen one's subcategories, and saves nothing until a
subcategory is tapped or typed; a main category on its own is never saved. Same-named
categories are told apart by parent (`@childrentoiletries`). Transfers need no category.

**Each confirmation has ✏️ Edit and 🗑 Delete buttons.** Edit asks for the corrected entry and
replaces the original rows in place; Delete removes them. A family member can always fix or
delete an entry they entered; anyone else's needs edit access to change and full access to delete.

Commands (also in the bot's menu button): `/help` shows the full guide; `/accounts` lists accounts;
`/categories` lists expense categories; `/link` and `/unlink` connect or disconnect a chat;
`/default` shows or changes the default account; `/cancel` drops an entry waiting for a category,
or an edit.

## Family group summaries

The bot can post a summary of one **shared space** to a Telegram group: every evening at 9 pm
(India time, or `BOT_TIMEZONE`), and on Sunday evenings a weekly one (Monday to Sunday, compared
with the week before). Only entries in that space's own accounts are counted. Personal accounts
never are, and transfers are left out.

1. Add the bot to the family's group. Keep BotFather's **Group Privacy** setting on (the default):
   the bot then receives only commands addressed to it, never the family's conversation.
2. The space's owner (Family plan, chat already linked with `/link`) sends `/summary on` in the
   group, or `/summary on <space name>` if they have several shared spaces.
3. In the group: `/summary` (settings), `/summary now` (today so far),
   `/summary daily|weekly|names on|off`, `/summary off`. Only the owner can change settings.

In a group with **topics**, summaries go to the topic where `/summary on` was sent (send it again
from another topic to move them; from General, they go to General). In an ordinary group they go to
the group. If the chosen topic is deleted, they go to General from then on (migration 0023).

Entries are still sent to the bot in a private chat; in a group it records nothing.

How it runs: migration `0022_telegram_group_summaries.sql` adds `telegram_groups`, the
`pocket_space_summary` totals and a pg_cron job that calls the `telegram-summaries` function every
hour at :07. The function works out what is due and claims each summary in the database before
sending, so it posts once however often it is called. If the owner's Family plan ends, the group is
told once that summaries are paused; if the bot is removed from the group, the link is deleted.
