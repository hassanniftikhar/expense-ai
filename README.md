# Expense_AI

A private, mobile-first expense tracker you control. Open it, type
`grocery 4000 haircut 1000 fuel 2000` (or talk), and it records everything
and subtracts from your monthly salary in the background. No app store, no
Apple developer account, no 7-day resigning.

It is a PWA (a web app you can "Add to Home Screen" on iPhone so it looks and
feels like a real app).

---

## What it does

- One-time login that **stays signed in until you choose to sign out**.
- Asks for your salary the very first time, then every entry subtracts from it.
- Type or speak entries; multiple at once is fine.
- Understands casual notes via AI, e.g. `received 10k from faran and paid ammi 5k for medicine`.
- Asks a quick "Received or Sent?" when a name + amount is ambiguous (e.g. `faran 1000`).
- "+ Month" button starts a new month; everything after goes into it.
- Route an entry to any month: `add this in March 2026 i spent 2000 on fuel`
  (if March 2026 doesn't exist, it offers to create it).
- View/switch/edit any month.
- Export any month to a real Excel `.xlsx` file.
- All amounts in PKR.

---

## The 4 things YOU need to do to make it "real"

The app code is finished. To go from "works on my phone only" to "real account
with a real database in the cloud", you connect three free services. This takes
about 15 minutes and needs **no coding** — just copying and pasting keys.

You will create:
1. A free **Supabase** account → this is your real database + login system.
2. A free **Vercel** account → this hosts the app on a real web link.
3. An **OpenAI** API key → this is the AI that understands messy notes.

> Where does my data live? In **your own Supabase database** (Postgres), under
> your account. Not with me, not in the browser only. Row-Level Security means
> only you, when logged in, can read your rows.

---

### STEP 1 — Create the database (Supabase)

1. Go to https://supabase.com and sign up (free).
2. Click **New project**. Give it a name and a database password (save it).
   Pick the region closest to you. Wait ~2 minutes for it to finish.
3. In the left sidebar open **SQL Editor** → **New query**.
4. Open the file `supabase-schema.sql` from this project, copy **everything**
   in it, paste into the SQL editor, and click **Run**. You should see
   "Success". This creates your `months` and `transactions` tables.
5. Make login seamless (recommended for a personal app):
   - Left sidebar → **Authentication** → **Sign In / Providers** (or
     **Providers** → **Email**).
   - Turn **"Confirm email" OFF**. This means when you create your login it
     works instantly with no email-clicking. (If you leave it ON, you'll have
     to click a link in your email once before your first sign-in.)
6. Get your two keys: left sidebar → **Project Settings** → **API**. Copy:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string). The anon key is safe to use in a
     browser because Row-Level Security protects your data.

Keep these two values handy for Step 3.

---

### STEP 2 — Get the AI key (OpenAI)

1. Go to https://platform.openai.com and sign in.
2. Open **API keys** → **Create new secret key**. Copy it (starts with `sk-`).
   You only see it once, so paste it somewhere safe for a moment.
3. Note: OpenAI usage is pay-as-you-go and extremely cheap here, because the
   app uses the AI only for messy sentences — simple entries like `kfc 1000`
   are parsed instantly for free. Add a small amount of credit / a spending
   limit in **Billing** if asked.

---

### STEP 3 — Put it online (Vercel)

1. Go to https://vercel.com and sign up (free). Easiest is "Continue with
   GitHub", but any method works.
2. The simplest no-tooling path:
   - Create a free GitHub account if you don't have one.
   - Create a new repository and upload **all files from this `expense-ai`
     folder** into it (GitHub lets you drag-and-drop files in the browser via
     "Add file" → "Upload files").
   - In Vercel click **Add New… → Project**, pick that repository, click
     **Import**.
3. Before clicking **Deploy**, open **Environment Variables** and add these
   four (name on the left, your value on the right):

   ```
   SUPABASE_URL        = https://YOUR_PROJECT.supabase.co
   SUPABASE_ANON_KEY   = your anon public key from Step 1
   OPENAI_API_KEY      = sk-... your key from Step 2
   OPENAI_MODEL        = gpt-4.1-mini
   ```

4. Click **Deploy**. After a minute Vercel gives you a link like
   `https://expense-ai-yourname.vercel.app`. That's your live app.

> If you ever change a key, update it in Vercel → Project → Settings →
> Environment Variables, then **Redeploy**.

---

### STEP 4 — Install on your iPhone

1. Open your Vercel link in **Safari** (not Chrome — only Safari can install
   PWAs on iPhone).
2. Tap the **Share** button → **Add to Home Screen**.
3. Open it from your home screen. Tap **Create login**, enter any email +
   a password (6+ characters), and you're in. You'll stay logged in on this
   device until you tap sign out.

Done. Type an expense, tap **Record**, watch your balance go down.

---

## Run it on your own computer first (optional)

If you just want to try it locally before deploying:

```bash
node server.js
```

Open http://localhost:4173. Without any keys set, it runs in **local test
mode**: login accepts anything and data is saved only in that browser. This is
for trying it out — your real data lives in Supabase after Step 3.

To test the AI part locally too:

```bash
OPENAI_API_KEY=sk-... node server.js
```

---

## How your money math works

For the selected month:

```
Remaining = Salary + (money received) − (expenses + loan repayments)
```

- `received 1000 faran` → adds a **+1000 income** row.
- `paid ammi 5000` → adds a **loan repayment** row (subtracts).
- `faran 1000` (no verb) → app asks **Received or Sent?** so it's never wrong.

## Files in this project

- `index.html`, `src/app.js`, `src/styles.css` — the app you see.
- `server.js` — tiny local server for testing on your computer.
- `api/parse.js`, `api/parse-shared.js` — the AI parsing endpoint (key stays
  on the server, never in your browser).
- `api/config.js` — hands the app your public Supabase settings safely.
- `supabase-schema.sql` — run once in Supabase to create your tables.
- `vercel.json`, `manifest.webmanifest` — hosting + "Add to Home Screen" setup.

Your OpenAI key is never stored in the browser or in the database.
