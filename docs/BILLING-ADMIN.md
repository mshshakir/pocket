# Managing plans and subscriptions

Everything below is done in the Supabase dashboard for project `nvsfxdnnakzfzsrsfftp`.
No code changes or deploys are needed.

- **Table Editor**: change prices, seats and settings.
- **SQL Editor**: change one person's plan or AI credits, and see everyone at a glance.

Money is stored in **paise** (₹1 = 100), so ₹169 is `16900`.

## The admin dashboard: admin.html

Open **/admin.html** on the Pocket site and sign in with your Google account. Only accounts in the
table `admins` get in (you are added by migration 0028; add another with
`insert into admins (user_id) select id from auth.users where email = 'them@gmail.com';`). The page's
code is public, but every number and change goes through database functions that refuse anyone else.
Every change made there is recorded in the **Audit log** tab.

| Tab | What it does |
|---|---|
| Overview | Sign-ups (and per week), people active, plans, revenue (and per month), AI use, programme numbers |
| Users | Everyone, their plan, AI credits, Telegram, family, last entry, what they've paid; give a plan, end it, add AI credits, unlimited AI; CSV |
| Payments | Every order, with offers and coupon codes; CSV. Refunds are made in Razorpay |
| Pricing & offers | Payments on/off, read-only days, AI price and pack, credit validity; plan prices; sales and coupon codes |
| Programme | Applications and waitlist with each profile and a WhatsApp link; offer a place in a batch; batches; the daily ✓/✗ tracker and weekly call notes |
| Audit log | What was changed, when, by whom |

It never shows what anyone has recorded in Pocket.

**Offers.** A *sale* lowers a price for everyone while it runs (a percentage, or a new price for one
product). A *coupon* is a code typed at checkout (a percentage or an amount off), applied after any
sale. Each can be limited to some products, dates and a number of uses; a use counts when the payment
goes through.

**Habit programme.** People apply on **/programme.html** (signed in) with their profile and consent;
they join the waitlist. In the dashboard, offer a place in a batch, then send them the programme page
link on WhatsApp: they pay ₹5,000 (or less with a coupon) through Razorpay, which confirms the place.
If someone pays another way, use "Mark paid". A batch can't be offered beyond its places.

## Prices and what each plan includes: table `plans`

Table Editor → `plans`. One row per plan: `free`, `sync`, `family`.

| Column | Meaning |
|---|---|
| `name` | What people see ("Family"). |
| `seats` | People covered, the owner included. Family = 5. |
| `sync`, `telegram`, `sharing` | Ticked = included in the plan. |
| `monthly_paise`, `yearly_paise` | Prices. ₹199 → `19900`, ₹1,499 → `149900`. |
| `trial_paise`, `trial_days` | Paid trial. Family: ₹50 (`5000`) for `14` days. Empty = no trial. |
| `active` | Untick to stop offering the plan to new buyers. Existing subscribers keep it. |
| `sort` | Order on the pricing screen. |

A new price applies to new purchases and renewals. To add a plan, add a row: the `code`
must be lowercase letters, digits or `_`, and can't be changed later.

## General settings: table `billing_settings` (one row)

| Column | Meaning |
|---|---|
| `grace_days` | After a plan ends, how many days the cloud copy stays readable (read-only) before the person drops to Free. Default `30`. Nothing is ever deleted. |
| `ai_credit_paise` | Price of one AI use (receipt scan or voice entry). `10` = ₹0.10. |
| `ai_pack_paise` | Size of an AI pack. `10000` = ₹100 = 1,000 uses. |
| `payments_enabled` | `true` shows the buy buttons in Settings → Your plan and lets the `payments` function take orders. Default `false`. |

## One person's plan: SQL Editor

Use these functions rather than editing the `subscriptions` table by hand. They fill in
the end date for you. Every change, including any hand edit, is recorded in
`subscription_events`.

```sql
-- Everyone: plan, state, end date, people in their family, AI credits
select * from pocket_admin_overview();

-- Give a plan. Term is 'month', 'year', 'trial' or 'lifetime'.
select pocket_admin_set_plan('someone@gmail.com', 'family', 'year');
select pocket_admin_set_plan('someone@gmail.com', 'sync', 'month');
select pocket_admin_set_plan('someone@gmail.com', 'family', 'trial');            -- 14 days, marks the trial as used
select pocket_admin_set_plan('someone@gmail.com', 'family', 'lifetime', null, 'Family, free for life', 'comp');

-- A specific end date
select pocket_admin_set_plan('someone@gmail.com', 'family', 'year', '2027-12-31', 'Paid by bank transfer');

-- End a plan now (they get the grace period, then Free)
select pocket_admin_end_plan('someone@gmail.com', 'Asked to cancel');

-- AI credits: add, or remove with a negative number. 1 credit = 1 use.
-- For a Family owner, these credits are the family pool.
select pocket_admin_grant_ai('someone@gmail.com', 1000, 'Bought one pack, paid cash');

-- Unlimited AI on or off (they need a plan first)
select pocket_admin_set_ai_unlimited('someone@gmail.com', true);
select pocket_admin_set_ai_unlimited('someone@gmail.com', false);

-- Every AI use and top-up for one person (used_by = who used it)
select at, reason, delta, used_by, note
from ai_credit_ledger
where user_id = pocket_admin_user('someone@gmail.com') or used_by = pocket_admin_user('someone@gmail.com')
order by at desc;

-- One person's history
select at, kind, plan, term, ends_at, note, actor
from subscription_events
where user_id = pocket_admin_user('someone@gmail.com')
order by at desc;
```

## AI (receipt scans and voice entries)

AI runs on Pocket's own Gemini key, kept on the server: nobody enters a key in the app.
Set it once in Supabase → **Edge Functions → Secrets** as `GEMINI_API_KEY` (create a key
at aistudio.google.com/apikey). Changing it there takes effect at once. Until it is set,
AI scans say "AI scanning isn't set up yet" and nobody is charged.

Each scan or voice entry costs one credit, charged by the `ai` server function; if Gemini
fails, the credit is refunded automatically.

## Online payment (Razorpay)

People pay once for a month, a year, the Family trial or an AI pack. Nothing renews
by itself; paying again for the same plan adds to its end date. Prices come from the
`plans` and `billing_settings` tables, so changing a price there changes what Razorpay
charges. Every order is in the table `payment_orders` (status `created` or `paid`), and
each paid plan also appears in `subscription_events` with its amount.

**Switching it on (once):**

1. Razorpay dashboard → **Account & Settings → API Keys** → generate keys
   (start in **Test mode**).
2. Supabase → **Edge Functions → Secrets**, add:
   - `RAZORPAY_KEY_ID` (starts `rzp_test_` or `rzp_live_`)
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`: any long random text you make up; use the same text in step 3.
3. Razorpay → **Account & Settings → Webhooks → Add new webhook**:
   - URL: `https://nvsfxdnnakzfzsrsfftp.supabase.co/functions/v1/payments/webhook`
   - Secret: the same text as `RAZORPAY_WEBHOOK_SECRET`
   - Events: `payment.captured` and `order.paid`
4. Razorpay → **Account & Settings → Payment capture**: keep **automatic** capture on.
5. SQL Editor: `update billing_settings set payments_enabled = true;`

To stop taking payments, set it back to `false`; plans already paid for are untouched.
Going live: swap the two key secrets for the live ones and add the webhook again in live mode.

**Refunds** are made in the Razorpay dashboard. A refund doesn't change the plan by
itself; end it with `pocket_admin_end_plan` (or remove the credits with
`pocket_admin_grant_ai` and a negative number) if you want to.

**If someone paid but their plan didn't change:** find the order in `payment_orders`.
If it is still `created`, check the payment in Razorpay; the webhook applies it when
Razorpay reports it captured. To apply it by hand:
`select pocket_payment_fulfil('order_…', 'pay_…');` (safe to run twice).

## The rules

The server enforces these: the app and the Telegram bot only explain them.

- **No plan:** Free. Everything works on the device, including every export. Signing in
  doesn't upload anything; the book stays on the device.
- **Active:** the plan's features work fully.
- **Ended within `grace_days` (30):** the cloud copy can be loaded but not changed
  (read-only). A banner on every page tells the person to **download their data** before
  the date it closes, with a "Download my data" button (a JSON file that Settings → Import
  JSON brings back). The Telegram bot replies with the same instruction. New entries stay
  on the device and go up if they renew.
- **Ended longer ago:** Free. The cloud copy can't be opened, but it is kept, never
  deleted, and comes back as soon as they pay again.
- **Family members** write into the owner's shared space only while the owner's Family
  plan is active. While it is in grace, they see it read-only. After that, it disappears
  from their app until the owner renews.
- **Family seats:** a Family plan covers its owner plus the first 4 family members they
  added. A 5th member is not covered until someone is removed.
- **AI credits:**
  - In their **own book**, a person uses their own unlimited AI if they have it, otherwise
    their own credits.
  - In a Family owner's **shared space**, AI comes from (in order): the owner's unlimited AI,
    the owner's credits (the family pool), then the person's own credits.
  - A member whose owner's plan has ended can't use the pool.
  - The same request is never charged twice, and a failed AI call is refunded once.
- **Trials:** each person can have one trial. `pocket_admin_set_plan(..., 'trial')`
  records it.
- **Who can change what:** users can see their own plan, history and credits, but cannot
  change them. Only you (SQL / Table Editor) and, later, the payment webhook can.

## Free for life (set 2026-11-14)

mshshakir@gmail.com, hdshakir@gmail.com, sakina0019@gmail.com and tshshakir@gmail.com have
Family, lifetime (`source = 'comp'`), with unlimited AI.
