# Merging the Astro Advice lead pipeline into this app

This merges what `astro-lead-sync-app` + a Google Apps Script backend
(`Code.gs`) used to do into this app (`shubh-gems-varint-options`), so
there's one app instead of two. See `app/utils/astroAdvice.server.js`,
`app/routes/proxy.astro-advice.jsx`, and `app/routes/track.$type.jsx`.

**What moved and why:**
- **Shopify customer sync** (tag `gem-lead`, note, `custom.astro_advice`
  metafield) now uses this app's own already-authenticated `admin`
  client instead of a separate manual OAuth code-exchange — one less app
  registration to maintain.
- **Leads/email events** now write to this app's own Postgres database
  (source of truth) AND best-effort mirror into the same Google Sheet as
  before, so the "just open the Sheet" habit still works without needing
  a new admin screen yet.
- **Email sending** moved from `GmailApp` (Apps Script only) to
  Nodemailer over the same Gmail account/SMTP — same behaviour, callable
  from Node.
- **Open/click tracking** moved from an Apps Script `doGet` to this
  app's own public `/track/open` and `/track/click` routes — and can now
  serve a *real* tracking-pixel GIF and a real HTTP redirect, which Apps
  Script couldn't do.

**What did NOT change:** AstrologyAPI is still called directly from the
browser (`assets/shubh-astro-advice.js`) — that's a fixed constraint
unrelated to Apps Script vs. Node; AstrologyAPI's account only accepts
requests carrying a genuine browser Origin, which no server-side call
(Apps Script or this app) can produce. The request/response JSON shape
this app's new endpoint returns is identical to what the old Apps Script
Web App returned, so `shubh-astro-advice.js` itself needed zero code
changes — only the URL it posts to changes.

Everything in this repo is ready to deploy. The steps below are the ones
that only you can do (secrets, a service-account signup, clicking
through re-authorization) — I can't do these for you.

## 1. Re-authorize the app with its new scopes

`shopify.app.toml` now requests `write_customers,read_customers` in
addition to what it already had. Push the updated config, then
re-install/re-authorize on the store so it picks up the new scopes:

```bash
shopify app config push
```

Then visit the app's "Test your app" install link again from
[dev.shopify.com](https://dev.shopify.com) and approve the new
permissions — existing functionality (the jewelry customizer) is
unaffected, this just adds the two new scopes to the same install.

## 2. Set the Gmail/Sheets config — either on Render, or on the app's own Settings page

There are now two ways to provide this config, and either works (a
saved Settings-page value takes priority; env vars are the fallback):

- **The app's own Settings page** — once deployed, open the app from
  Shopify Admin's Apps list → **Settings** in its nav. Lets you paste in
  the Gmail address/App Password and the Sheets service account details
  directly, no Render dashboard needed. The App Password and service
  account private key are never re-displayed after saving (shown as
  "already set" instead) — leaving those fields blank on a later save
  keeps the existing value rather than clearing it.
- **Render env vars** — same as before, described below. Useful as a
  default/fallback, or if you'd rather manage secrets there instead.

## 2b. (Alternative) Set the new environment variables on Render

Web service → **Environment**, add:

- **`GMAIL_USER`** — the Gmail address to send from (same one the old
  Apps Script's `GmailApp` was using, if you want continuity).
- **`GMAIL_APP_PASSWORD`** — NOT the account's real password. Generate
  one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
  (requires 2-Step Verification to be on for that Google account) — pick
  "Mail" as the app, copy the 16-character password it gives you.
- **`GOOGLE_SERVICE_ACCOUNT_EMAIL`** and **`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`**
  — for mirroring into the Sheet. In
  [Google Cloud Console](https://console.cloud.google.com/):
  1. Create (or reuse) a project → **IAM & Admin → Service Accounts →
     Create Service Account**.
  2. Create a JSON key for it, open the downloaded file — copy its
     `client_email` value into `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and its
     `private_key` value into `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (paste
     it exactly as-is, including the `\n` sequences — Render's env var
     box holds it as one line, and the app un-escapes those itself).
  3. Enable the **Google Sheets API** for that project (APIs & Services →
     Library → search "Google Sheets API" → Enable).
  4. Open the actual Google Sheet you want leads mirrored into, click
     **Share**, and share it with the service account's email address
     (the `client_email` value) as an **Editor**. Without this share
     step, every write will fail with a permission error.
- **`ASTRO_LEADS_SPREADSHEET_ID`** — the long ID in that Sheet's URL:
  `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.

If you'd rather skip Sheet mirroring for now, leave those last three
blank — leads still save fine to the database either way, sync just
silently no-ops and logs a one-time warning.

## 3. Apply the new database tables

The build already runs `prisma migrate deploy` (see `render.yaml`'s
`buildCommand`), so pushing this code and letting Render redeploy is
enough — no manual database step needed. It creates two new tables,
`AstroLead` and `EmailEvent`, alongside the existing `Session` table.

## 4. Push and redeploy

```bash
git add -A
git commit -m "Merge astro-lead-sync-app into this app"
git push
```

Render redeploys automatically on push (per the Blueprint setup from the
original `DEPLOYMENT.md`).

## 5. Point the theme at the new endpoint

Once redeployed and confirmed working (see the test in step 6), change
the **"Apps Script URL"** setting on the Astro Advice section (Theme
Editor → the Astro Advice section) from the old Apps Script Web App URL
to:

```
https://onlynaturalgemstones.com/apps/customize/astro-advice
```

Don't flip this until step 6 passes — the old Apps Script backend
keeps working exactly as-is until you do, so there's no rush/risk here.

## 6. Test

1. Submit the Astro Advice form once yourself (on a test/staging page
   first if you'd rather not use a real lead) with the new URL set.
2. Confirm: a new row appears in the `AstroLead` table (check via
   `npx prisma studio` locally against `DATABASE_URL`, or just trust the
   Sheet mirror if that's set up) and in the Google Sheet's **Leads**
   tab.
3. Confirm the recommendation email actually arrives, and that clicking
   its button lands on the results page with the right data.
4. Confirm an `EmailEvent` row (`sent`, then `clicked` after you click
   the link) shows up, both in the database and in the Sheet's
   **EmailEvents** tab.

## 7. Retire astro-lead-sync-app

Once step 6 passes end-to-end, `astro-lead-sync-app`'s client_id/secret
and the standalone Apps Script project are no longer needed — you can
uninstall that app from the store (Admin → Settings → Apps) and archive
or delete the Apps Script project whenever you're ready. Nothing here
depends on it continuing to exist.

---

### If something's wrong later
- **Email never arrives**: check Render's logs for the exact
  `emailSendStatus` string — it's stored on the `AstroLead` row too, so
  `npx prisma studio` shows it per-lead without needing to dig through
  logs.
- **Sheet not getting mirrored**: check for the one-time
  `GOOGLE_SERVICE_ACCOUNT_EMAIL / ... not fully set` warning in Render's
  logs (means an env var's missing), or a permission error (means the
  Sheet wasn't shared with the service account's email).
- **Shopify customer not tagged**: check `shopifySyncStatus` on the
  `AstroLead` row the same way — it holds the exact GraphQL
  error/userErrors if something failed.
