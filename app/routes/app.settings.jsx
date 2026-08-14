/**
 * Settings page for the Astro Advice lead pipeline — lets you set the
 * Gmail sending credentials and Google Sheets mirror target from the
 * app's own UI instead of editing Render's Environment tab. A value
 * saved here takes priority over the matching env var (see
 * app/utils/appSettings.server.js), so either place works.
 *
 * The two genuinely secret fields (Gmail App Password, Google service
 * account private key) are never re-displayed once saved — the form
 * shows a "•••• already set" placeholder instead, and leaving that field
 * blank on save keeps the existing value rather than clearing it.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getRawAppSettingsRow, saveAppSettings, DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS } from "../utils/appSettings.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const row = await getRawAppSettingsRow(session.shop);
  return {
    gmailUser: row?.gmailUser || "",
    gmailAppPasswordSet: !!row?.gmailAppPassword,
    googleServiceAccountEmail: row?.googleServiceAccountEmail || "",
    googleServiceAccountPrivateKeySet: !!row?.googleServiceAccountPrivateKey,
    astroLeadsSpreadsheetId: row?.astroLeadsSpreadsheetId || "",
    wishlistEmailIntervalHours: row?.wishlistEmailIntervalHours || String(DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS),
    // So the page can say which env vars are filling in for anything
    // not saved here yet.
    envFallback: {
      gmailUser: !!process.env.GMAIL_USER,
      gmailAppPassword: !!process.env.GMAIL_APP_PASSWORD,
      googleServiceAccountEmail: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      googleServiceAccountPrivateKey: !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      astroLeadsSpreadsheetId: !!process.env.ASTRO_LEADS_SPREADSHEET_ID,
    },
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  // Blank secret fields mean "leave unchanged", not "clear" — merge with
  // whatever's already saved so re-saving the non-secret fields doesn't
  // accidentally wipe a previously-set password/key.
  const existing = await getRawAppSettingsRow(session.shop);
  const gmailAppPassword = formData.get("gmailAppPassword")?.trim() || existing?.gmailAppPassword || "";
  const googleServiceAccountPrivateKey =
    formData.get("googleServiceAccountPrivateKey")?.trim() || existing?.googleServiceAccountPrivateKey || "";

  await saveAppSettings(session.shop, {
    gmailUser: formData.get("gmailUser")?.trim() || "",
    gmailAppPassword,
    googleServiceAccountEmail: formData.get("googleServiceAccountEmail")?.trim() || "",
    googleServiceAccountPrivateKey,
    astroLeadsSpreadsheetId: formData.get("astroLeadsSpreadsheetId")?.trim() || "",
    wishlistEmailIntervalHours: formData.get("wishlistEmailIntervalHours")?.trim() || "",
  });

  return { ok: true };
};

const fieldStyle = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: "4px",
  marginBottom: "16px",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "14px",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
const labelStyle = { fontWeight: 600, fontSize: "13px" };
const hintStyle = { fontSize: "12px", color: "#6d7175", marginTop: "-12px", marginBottom: "16px" };

export default function SettingsPage() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isSaving = fetcher.state === "submitting";

  const [gmailUser, setGmailUser] = useState(data.gmailUser);
  const [gmailAppPassword, setGmailAppPassword] = useState("");
  const [gsaEmail, setGsaEmail] = useState(data.googleServiceAccountEmail);
  const [gsaKey, setGsaKey] = useState("");
  const [sheetId, setSheetId] = useState(data.astroLeadsSpreadsheetId);
  const [wishlistInterval, setWishlistInterval] = useState(data.wishlistEmailIntervalHours);

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Settings saved");
      setGmailAppPassword("");
      setGsaKey("");
    }
  }, [fetcher.data, shopify]);

  const submit = (e) => {
    e.preventDefault();
    fetcher.submit(
      {
        gmailUser,
        gmailAppPassword,
        googleServiceAccountEmail: gsaEmail,
        googleServiceAccountPrivateKey: gsaKey,
        astroLeadsSpreadsheetId: sheetId,
        wishlistEmailIntervalHours: wishlistInterval,
      },
      { method: "POST" }
    );
  };

  return (
    <s-page heading="Astro Advice — Settings">
      <s-section heading="Email sending (Gmail)">
        <s-paragraph>
          The account the gem-recommendation email sends from. Needs a Gmail
          App Password (Google account → Security → 2-Step Verification →
          App Passwords), not the account's real password.
        </s-paragraph>
        <form onSubmit={submit}>
          <label style={labelStyle} htmlFor="gmailUser">Gmail address</label>
          <input
            id="gmailUser"
            style={fieldStyle}
            type="email"
            value={gmailUser}
            onChange={(e) => setGmailUser(e.target.value)}
            placeholder="info@onlynaturalgemstones.com"
          />

          <label style={labelStyle} htmlFor="gmailAppPassword">
            App Password{" "}
            {data.gmailAppPasswordSet ? "(●●●● already set — leave blank to keep it)" : "(not set yet)"}
          </label>
          <input
            id="gmailAppPassword"
            style={fieldStyle}
            type="password"
            autoComplete="new-password"
            value={gmailAppPassword}
            onChange={(e) => setGmailAppPassword(e.target.value)}
            placeholder={data.gmailAppPasswordSet ? "•••• •••• •••• ••••" : "16-character App Password"}
          />
          {!data.gmailUser && data.envFallback.gmailUser && (
            <p style={hintStyle}>Currently falling back to the GMAIL_USER env var on Render.</p>
          )}

          <s-section heading="Google Sheets mirror (optional)">
            <s-paragraph>
              Also mirrors every lead/email-event row into a Google Sheet, in
              addition to this app's own database. Leave blank to skip —
              nothing else depends on this.
            </s-paragraph>

            <label style={labelStyle} htmlFor="gsaEmail">Service account email</label>
            <input
              id="gsaEmail"
              style={fieldStyle}
              type="email"
              value={gsaEmail}
              onChange={(e) => setGsaEmail(e.target.value)}
              placeholder="xxxx@xxxx.iam.gserviceaccount.com"
            />

            <label style={labelStyle} htmlFor="gsaKey">
              Service account private key{" "}
              {data.googleServiceAccountPrivateKeySet ? "(●●●● already set — leave blank to keep it)" : "(not set yet)"}
            </label>
            <textarea
              id="gsaKey"
              style={{ ...fieldStyle, minHeight: "90px", fontFamily: "monospace", fontSize: "12px" }}
              value={gsaKey}
              onChange={(e) => setGsaKey(e.target.value)}
              placeholder={
                data.googleServiceAccountPrivateKeySet
                  ? "•••• already set ••••"
                  : "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
              }
            />

            <label style={labelStyle} htmlFor="sheetId">Spreadsheet ID</label>
            <input
              id="sheetId"
              style={fieldStyle}
              type="text"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              placeholder="the long ID in the Sheet's URL"
            />
          </s-section>

          <s-section heading="Wishlist email timing">
            <s-paragraph>
              Hours to wait after a customer's <s-text>last</s-text> wishlist change before emailing them — each new
              change pushes this out again, so someone actively adding items all day gets one email once they've
              gone quiet, not one per add. See the <s-link href="/app/wishlist-leads">Wishlist Leads</s-link> page's
              "Send Due Emails Now" button to run a check immediately instead of waiting.
            </s-paragraph>
            <label style={labelStyle} htmlFor="wishlistInterval">Wait time (hours)</label>
            <input
              id="wishlistInterval"
              style={{ ...fieldStyle, maxWidth: "120px" }}
              type="number"
              min="0"
              step="0.5"
              value={wishlistInterval}
              onChange={(e) => setWishlistInterval(e.target.value)}
            />
          </s-section>

          <s-button {...(isSaving ? { loading: true } : {})} onClick={submit}>
            Save settings
          </s-button>
        </form>
      </s-section>

      <s-section slot="aside" heading="Where this data goes">
        <s-paragraph>
          Leads and email open/click/sent events are viewable on the{" "}
          <s-link href="/app/astro-leads">Astro Leads</s-link> page.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
