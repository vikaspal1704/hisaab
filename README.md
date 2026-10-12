# Hisaab — keep the books with your friends

Hisaab is a mobile-first app for friends who go out together and don't want to split every bill.
Whoever pays adds the expense, and Hisaab keeps a running balance with each friend. The next
time you owe someone, you pick up the bill and the books even out on their own. No settling
needed unless you want to.

It installs on your home screen like an app (Android and iPhone) and runs entirely on free
tiers: **GitHub Pages** for the app and **Supabase** for the database and login.

## What it does

- **One running balance per friend**, across every outing and group. "You owe Rahul ₹340."
- **Pay the next bill to balance out.** Add the expense you paid. Your share and theirs net
  against what you already owed, and both dashboards update live.
- **A passbook with every friend.** Every entry is listed with the running balance after it,
  so you can always look back at who paid on which day.
- **Whose turn to pay?** While adding a bill, Hisaab suggests who should pay this one
  ("You owe Rahul ₹500, so it's your turn"). Groups show who is furthest behind.
- **Couples and pairs.** Group a couple (or roommates) to see one combined balance. Split a
  bill with them "as one" (2 shares, no debt between the two of them). Either of them can
  settle for both: Hisaab clears both balances and records what they now owe each other.
- **Pay on behalf of someone.** A payment can also cover someone else's share. Their debt
  moves to the person who paid it.
- **Settle up with UPI.** Opens GPay, PhonePe or Paytm with the friend's UPI ID and the
  amount filled in. The payment is only recorded after you confirm it went through. You can
  also copy the UPI ID, record cash, or send a friendly WhatsApp reminder.
- **Friends don't need the app to start.** Add them by phone number, from your contacts on
  Android. When they sign in with that number, they see their whole history.
- **Trustworthy books.** Entries are never silently changed. Every edit and delete is logged
  with the previous version, everyone on the entry sees it, and deletes can be undone.
- Split equally, by exact amounts, or by shares. Several people can pay one bill. Dark mode
  works too.

### Made for how friends actually deal with money

Built around common complaints: logging feels like a chore, friends won't install yet
another app, and asking for money back is awkward.

- **Baari (take turns).** "Aaj maine diya, kal tu de." For each friend you choose baari or
  exact. In baari mode Hisaab shows whose turn it is ("Rahul's baari next") instead of debts.
- **Close enough is even.** Each friend or group has a tolerance (₹100 by default). Inside
  it, the balance shows "barabar 👍" and nobody is chased for ₹37.
- **Chhod do 🙏.** Let go of what someone owes you. It's recorded as a gift, so the passbook
  stays honest.
- **Two-tap logging.** "Add again" on any entry, shortcuts for regular outings on the home
  screen, and the split options stay folded away when it's just "split equally, I paid".
- **Log straight from UPI.** Paste the GPay, PhonePe, Paytm or bank SMS message and Hisaab
  fills in the amount and the friend. On Android, the installed app also appears in the
  Share menu, so you can share a payment message straight to it.
- **Lent or borrowed.** "I gave Amit ₹200 for petrol" in one step, without a bill split.
- **No-install share link.** Send a friend a private link to your passbook together. They see
  every entry from their side and can 👍 or ❓ it without signing up. You can turn the link off.
- **Confirm or question.** Entries someone else adds about you show up under "To check".
  Questions are flagged for both people, and an edit resets the confirmations.
- **The app does the asking.** Set a comfort limit per friend (e.g. above ₹500, after 14
  quiet days). Hisaab suggests a light, Hinglish WhatsApp message framed as a turn, not a
  debt, optionally with the share link.
- **Treats.** Birthday and promotion treats are remembered (who gave, who came) but never
  owed: "Rahul gave the last treat — next one's on you?"
- **Trip kitty.** Everyone puts money in with one person, and spends come out of the kitty.
  Hisaab tracks collected versus spent and what each person is owed back.
- **Flatmates.** Rent, WiFi, cook or Netflix are added automatically every month, split equally.
- **Notifications.** A push when a friend adds or changes something with you, plus a short
  weekly summary (optional setup, below). Without it, changes still appear live, with an
  unread badge.
- **Hinglish.** Switch the whole app (and the share page) between English and Hinglish.

## How the ledger works

- Money is stored as whole **paise** (integers), never floating point. Splits use the
  largest-remainder method, so the parts always add up exactly.
- Every expense or payment is an **entry**. The server turns each entry into pairwise
  **ledger lines** ("A owes B ₹x"). Balances are always computed from the lines of
  non-deleted entries, so no stored total can drift.
- A payment lists which debts it clears. The server only accepts it if money is conserved:
  the payer is up by the amount, the receiver is down by it, and everyone else nets to zero.
  That one rule covers simple payments, a partner paying for both, and paying on someone's
  behalf.
- The browser can only **read** data, filtered by Postgres Row Level Security: you see only
  entries you are part of. All writes go through database functions that check every rule.
  Phone numbers of people who aren't your contacts are masked.

The schema, rules and access control live in [`supabase/migrations/`](supabase/migrations/):
the core ledger in `20261012000000_init.sql` and the friendship features in
`20261013000000_friendship_features.sql`. Share links are the only thing someone without an
account can use, and only through two functions that require a valid, revocable token.

## Deploy for free (about 15 minutes)

You need a GitHub account, a Supabase account (free) and a Google Cloud account (free) for
"Sign in with Google".

### 1. Create the database (Supabase)

1. Create a new project at [supabase.com](https://supabase.com) on the free plan. Pick the
   Mumbai region if your friends are in India.
2. Open **SQL Editor** → **New query**, paste the whole contents of
   `supabase/migrations/20261012000000_init.sql`, and click **Run**. Then do the same with
   `supabase/migrations/20261013000000_friendship_features.sql`, in that order. (If you already
   ran the first file earlier, just run the second.)
3. Open **Project Settings → API** and note the **Project URL** and the **anon / publishable
   key**. Both are meant to be public; Row Level Security protects the data.

### 2. Turn on Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an
   **OAuth client ID** of type *Web application*.
   - Authorised redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
2. In Supabase, open **Authentication → Sign In / Providers → Google**, enable it, and paste
   the client ID and secret.
3. In Supabase, open **Authentication → URL Configuration**:
   - **Site URL:** `https://<your-github-username>.github.io/<repo-name>/`
   - **Redirect URLs:** add the same URL, plus `http://localhost:5173/` for local development.

### 3. Publish the app (GitHub Pages)

1. In this repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Open **Settings → Secrets and variables → Actions → Variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon / publishable key
3. Push to `main`, or run the **Deploy to GitHub Pages** workflow from the Actions tab. The app
   will be live at `https://<your-github-username>.github.io/<repo-name>/`.

Share that link with your friends. On Android use Chrome's **Install app**; on iPhone use
Safari → Share → **Add to Home Screen**.

### Keeping it free and awake

Supabase pauses free projects after a week with no activity. The **Keep Supabase awake**
workflow pings the database twice a week once the variables above are set. If a project does
get paused, restore it from the Supabase dashboard; no data is lost.

### Optional: push notifications and the weekly summary

Everything else works without this; it adds phone notifications.

1. Generate keys: `npx web-push generate-vapid-keys`.
2. Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then run `supabase login`
   and `supabase link --project-ref <your-project-ref>` in this folder.
3. Set the function secrets (pick any long random string for `HISAAB_SECRET`):
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
     VAPID_SUBJECT=mailto:you@example.com HISAAB_SECRET=...
   ```
4. Deploy the two functions:
   `supabase functions deploy notify --no-verify-jwt` and
   `supabase functions deploy digest --no-verify-jwt`. They check `HISAAB_SECRET` themselves.
5. In Supabase, open **Database → Webhooks** and create a webhook on table `entry_events`,
   event **Insert**, of type **Supabase Edge Function** → `notify`, with the HTTP header
   `x-hisaab-secret: <your HISAAB_SECRET>`.
6. In GitHub, add the repository variable `VITE_VAPID_PUBLIC_KEY` (the public key) and the
   repository **secret** `HISAAB_SECRET` (for the weekly summary workflow), then redeploy.
   Each person turns notifications on under **Me → Notifications**. On iPhone this needs
   iOS 16.4+ and Hisaab added to the home screen.

### Optional: SMS OTP login

Login is free because it uses Google. Your phone number is still your identity in the app:
friends add you by number, and you link your number once after signing in. If you'd rather
have true OTP login (it costs money per SMS), configure an SMS provider in Supabase under
**Authentication → Sign In / Providers → Phone** (Twilio, MessageBird, Vonage or Textlocal).
Then add the repository variable `VITE_ENABLE_PHONE_OTP` = `true`. With OTP login, the
verified number must match the one claimed.

## Develop locally

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and key
npm run dev                  # http://localhost:5173
```

Checks:

```bash
npm run typecheck
npm test                     # unit tests: money, phone numbers, splitting, settlement
npm run test:db              # database tests against a real Postgres 16
```

`test:db` loads the migration into a fresh throwaway database for each run. Point it at any
Postgres you can create databases on, for example:
`TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db`.
CI runs all of this on every push.

## Project layout

```
supabase/migrations/   database schema, rules (functions) and access policies
supabase/functions/    Edge Functions: push on new activity, weekly summary
src/lib/               pure logic: money, phone, split, settle, baari, payment text, nudges, i18n
src/pages/             screens (Home, Friend passbook, Add expense, Settle up, …)
src/components/        shared UI
tests/unit/            unit tests
tests/db/              integration tests for the SQL (balances, payments, RLS, audit)
```

## Known limitations and ideas

- With Google login, a phone number is claimed rather than verified. That's fine among
  friends, and a number can only be claimed once. Enable SMS OTP for verified numbers.
- Payments, treats and "chhod do" entries can be deleted (and re-recorded) but not edited.
- Group screens show the entries you're part of. Group balances only count expenses tagged
  to that group, so private debts between two members stay private.
- Logging from UPI reads text, not screenshots. GPay often shares an image, so use
  "Paste the message" with the bank SMS or the text from the payment screen.
- The phone contact picker is Android Chrome only (a browser limitation). On iPhone, type the
  number.
- Monthly bills are posted when a member opens the app on or after the due day.
- Anyone holding a share link can see that one passbook until you turn the link off.
- Not done yet: receipt photos, CSV export, and multiple currencies.
