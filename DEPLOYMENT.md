# Deploying the customization pricing app

This app powers `POST /apps/customize` on the storefront — it recomputes
the price of a customized jewelry order server-side (never trusting the
browser) and creates a single, correctly-priced cart variant. See
`app/utils/pricing.server.js` for how the price is computed, and the
conversation history for why it works this way.

Everything in this repo is ready to deploy. The steps below are the ones
that only you can do (account creation, secrets, clicking through OAuth) —
I can't do these for you.

## 1. Get the app's client secret

The app's `client_id` is already set in `shopify.app.toml`
(`24a6c503d46ca4f07024783f33b4b23d`). You need its matching **client
secret**:

1. Go to [dev.shopify.com](https://dev.shopify.com) → your organization →
   Apps → "Shubh Gems varint options".
2. Under API credentials, copy the **Client secret**. Keep this private —
   treat it like a password.

## 2. Push this code to GitHub

Render deploys from a git repo. From this folder
(`app/shubh-gems-varint-options`):

```bash
git add -A
git commit -m "Customization pricing app"
```

Then create a new **private** repository on GitHub (via
[github.com/new](https://github.com/new)) and push:

```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

## 3. Deploy to Render

1. Go to [render.com](https://render.com) and sign in (or create an
   account).
2. **New → Blueprint**, connect the GitHub repo you just created. Render
   will read `render.yaml` in this folder and set up three things
   automatically: a Postgres database, the web service, and a daily cron
   job (abandoned-variant cleanup).
3. Once created, open the web service → **Environment**, and set:
   - `SHOPIFY_API_KEY` = `24a6c503d46ca4f07024783f33b4b23d`
   - `SHOPIFY_API_SECRET` = the client secret from step 1
   - `SHOPIFY_APP_URL` = leave blank for now — you'll fill this in next
4. Deploy. Once it's live, Render shows you the service's public URL
   (something like `https://shubh-gems-customizer-app.onrender.com`).
5. Go back to **Environment**, set `SHOPIFY_APP_URL` to that exact URL,
   and let it redeploy.

## 4. Point the app config at the real URL

Back in this folder, open `shopify.app.toml` and replace every
`https://example.com` with your real Render URL from step 3.4:

- `application_url`
- `[auth] redirect_urls` (keep the `/api/auth` suffix)
- `[app_proxy] url` (keep the `/proxy` suffix)

Then push the config to Shopify:

```bash
shopify app config push
```

## 5. Install the app on the store

From [dev.shopify.com](https://dev.shopify.com) → your app → find the
"Test your app" / install link for `0f9yd0-jr.myshopify.com`, and click
through the install/authorization screen. This is what stores the
offline access token the app uses to call the Admin API — nothing works
until this step is done.

## 6. Tell me it's done

Once installed, I can drive a full live test again (same way I verified
the checkout flow earlier in this conversation) — add a customized ring
to cart on the "product" theme and confirm it reaches checkout as a
single, correctly-priced line item.

---

### If something's wrong later
- **Wrong prices / errors on add to cart**: check the web service's logs
  in Render — `app/utils/pricing.server.js` logs a clear error for any
  unrecognized design code or metal.
- **Variants piling up in Admin → Products → "Custom Jewelry Order"**:
  the cleanup cron runs daily and deletes anything older than 48 hours
  that wasn't purchased — check the cron job's logs in Render if they're
  not clearing.
- **Design catalog changes**: if the design table in
  `snippets/shubh-gems-global-designs.liquid` (in the theme) is ever
  edited, `app/data/globalDesigns.server.js` in this app needs the same
  edit by hand — see the comment at the top of that file.
