/**
 * Wishlist "here's what you saved" email + tracking — additive on top of
 * the existing wishlist feature, which keeps working exactly as before
 * (assets/shubh-wishlist.js still syncs to Shopify via the hidden native
 * customer form in theme.liquid, tagging/noting the customer — untouched
 * here). This file only adds: an email showing the wishlisted products,
 * sent whenever the client's own debounced sync fires (see
 * shubh-wishlist.js's performWishlistSync, which now also POSTs to
 * app/routes/proxy.wishlist-sync.jsx alongside its existing form submit),
 * plus the same open/click tracking pattern as the astro-advice email.
 *
 * Mirrors astroAdvice.server.js's structure closely — same tracking
 * mechanism, same shop-info/footer, same Nodemailer/Gmail sending —
 * reusing its exported helpers rather than duplicating them.
 */

import crypto from "node:crypto";
import nodemailer from "nodemailer";
import prisma from "../db.server";

import {
  getAppSettings,
  DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS,
} from "./appSettings.server";

import {
  mirrorEmailEventToSheet,
  mirrorWishlistLeadToSheet,
} from "./googleSheets.server";

import {
  STORE_DOMAIN,
  trackedClickUrl,
  esc,
  getShopFooterInfo,
  FALLBACK_LOGO_URL,
} from "./astroAdvice.server";

import {
  sendWishlistWhatsApp,
} from "./interakt.server";


/**
 * Thin wrapper around interakt.server.js's sendWishlistWhatsApp.
 */
async function sendWishlistWhatsAppForLead(settings, lead) {
  if (!lead.phone) {
    return "skipped: no phone on lead";
  }

  return sendWishlistWhatsApp(settings, {
    phone: lead.phone,
    email: lead.email,
    products: Array.isArray(lead.products)
      ? lead.products
      : [],
    productHandles: Array.isArray(lead.productHandles)
      ? lead.productHandles
      : [],
    headerImageUrl: FALLBACK_LOGO_URL,
  });
}


/**
 * Main entry point, called from proxy.wishlist-sync.jsx.
 */
export async function handleWishlistSync(
  admin,
  shop,
  data
) {
  const email = (data.email || "").trim();

  const handles = Array.isArray(data.productHandles)
    ? data.productHandles.filter(Boolean)
    : [];

  if (!email) {
    return {
      error: "email is required",
    };
  }


  /**
   * Customer removed their last wishlist item.
   */
  const emptied = handles.length === 0;

  if (emptied) {
    const earlier =
      await prisma.wishlistLead.findFirst({
        where: {
          shop: shop || null,
          email,
        },
      });

    if (!earlier) {
      return {
        ok: true,
        emailSendStatus:
          "ignored: empty wishlist and no earlier sync for this email",
      };
    }
  }


  const trackingId = crypto.randomUUID();


  /**
   * Resolve product information.
   */
  const products = emptied
    ? []
    : await getProductsByHandles(
        admin,
        handles
      );


  let lead;

  try {
    lead =
      await prisma.wishlistLead.create({
        data: {
          trackingId,
          shop: shop || null,
          email,
          phone: data.phone || null,
          productHandles: handles,
          products,

          emailSendStatus: emptied
            ? "skipped: customer emptied their wishlist"
            : undefined,
        },
      });
  } catch (dbErr) {
    console.error(
      "[wishlist] failed to save lead to database:",
      dbErr
    );

    return {
      error: "Failed to save",
    };
  }


  /**
   * Reconcile Shopify wishlist tags.
   */
  reconcileCustomerWishlistTags(
    admin,
    email,
    handles
  ).catch((err) =>
    console.error(
      "[wishlist] tag reconcile failed for",
      email,
      err
    )
  );


  if (emptied) {
    return {
      ok: true,
      emailSendStatus:
        "skipped: customer emptied their wishlist",
    };
  }


  const settings =
    await getAppSettings(shop);


  const mirrorPromise =
    mirrorWishlistLeadToSheet(
      settings,
      lead
    ).catch(
      (err) =>
        "threw: " +
        String(
          (err && err.message) || err
        )
    );


  if (data.debug === true) {
    const sheetMirrorStatus =
      await mirrorPromise;

    return {
      ok: true,
      emailSendStatus:
        "pending: scheduled for the next interval check",
      sheetMirrorStatus,
      shop,
      hasRelayUrl:
        !!settings.sheetsRelayUrl,
    };
  }


  return {
    ok: true,
    emailSendStatus:
      "pending: scheduled for the next interval check",
  };
}


/**
 * Resolve wishlist email interval.
 */
export function resolveWishlistIntervalHours(
  settings
) {
  const parsed = parseFloat(
    settings &&
      settings.wishlistEmailIntervalHours
  );

  return Number.isFinite(parsed) &&
    parsed >= 0
    ? parsed
    : DEFAULT_WISHLIST_EMAIL_INTERVAL_HOURS;
}


/**
 * Process due wishlist emails.
 */
export async function processDueWishlistEmails(
  admin,
  shop
) {
  const settings =
    await getAppSettings(shop);

  const intervalHours =
    resolveWishlistIntervalHours(
      settings
    );


  const pendingRows =
    await prisma.wishlistLead.findMany({
      where: {
        shop,
        emailSendStatus: null,
      },

      orderBy: {
        createdAt: "desc",
      },
    });


  const emails = [
    ...new Set(
      pendingRows
        .map((r) => r.email)
        .filter(Boolean)
    ),
  ];


  const results = [];


  for (const email of emails) {
    const latest =
      await prisma.wishlistLead.findFirst({
        where: {
          shop,
          email,
        },

        orderBy: {
          createdAt: "desc",
        },
      });


    if (!latest) {
      continue;
    }


    if (latest.emailSendStatus) {
      await prisma.wishlistLead.updateMany({
        where: {
          shop,
          email,
          emailSendStatus: null,

          createdAt: {
            lt: latest.createdAt,
          },
        },

        data: {
          emailSendStatus:
            "skipped: superseded by an already-processed newer sync",
        },
      });

      continue;
    }


    const ageHours =
      (
        Date.now() -
        new Date(
          latest.createdAt
        ).getTime()
      ) /
      (60 * 60 * 1000);


    if (ageHours < intervalHours) {
      results.push({
        email,
        status:
          `not due yet (${ageHours.toFixed(
            1
          )}h of ${intervalHours}h)`,
      });

      continue;
    }


    const handles =
      Array.isArray(
        latest.productHandles
      )
        ? latest.productHandles
        : [];


    const products =
      Array.isArray(
        latest.products
      )
        ? latest.products
        : [];


    let status;


    try {
      status =
        await sendWishlistEmail(
          admin,
          settings,
          email,
          handles,
          products,
          latest.trackingId
        );
    } catch (err) {
      status =
        "threw: " + err;

      console.error(
        "[wishlist] processDueWishlistEmails send failed for",
        email,
        err
      );
    }


    /**
     * WhatsApp goes out on the same schedule.
     */
    let whatsappStatus;


    try {
      whatsappStatus =
        await sendWishlistWhatsAppForLead(
          settings,
          latest
        );
    } catch (err) {
      whatsappStatus =
        "threw: " + err;

      console.error(
        "[wishlist] processDueWishlistEmails WhatsApp send failed for",
        email,
        err
      );
    }


    try {
      await prisma.wishlistLead.update({
        where: {
          id: latest.id,
        },

        data: {
          emailSendStatus: status,
          whatsappSendStatus:
            whatsappStatus,
        },
      });


      await prisma.wishlistLead.updateMany({
        where: {
          shop,
          email,
          emailSendStatus: null,

          id: {
            not: latest.id,
          },

          createdAt: {
            lt: latest.createdAt,
          },
        },

        data: {
          emailSendStatus:
            "skipped: superseded by " +
            latest.id,
        },
      });
    } catch (updateErr) {
      console.error(
        "[wishlist] failed to record send result:",
        updateErr
      );
    }


    results.push({
      email,
      status,
      whatsappStatus,
    });
  }


  return {
    checked: emails.length,

    sent: results.filter(
      (r) =>
        r.status?.startsWith("OK")
    ).length,

    results,
  };
}


/**
 * Manually resend wishlist email.
 */
export async function resendWishlistLeadEmail(
  admin,
  leadId
) {
  const lead =
    await prisma.wishlistLead.findUnique({
      where: {
        id: leadId,
      },
    });


  if (!lead) {
    return "error: lead not found";
  }


  if (!lead.email) {
    return "skipped: lead has no email";
  }


  const settings =
    await getAppSettings(
      lead.shop
    );


  const handles =
    Array.isArray(
      lead.productHandles
    )
      ? lead.productHandles
      : [];


  const products =
    Array.isArray(
      lead.products
    )
      ? lead.products
      : [];


  if (!handles.length) {
    return "skipped: this wishlist is empty";
  }


  let status;


  try {
    status =
      await sendWishlistEmail(
        admin,
        settings,
        lead.email,
        handles,
        products,
        lead.trackingId
      );
  } catch (err) {
    status =
      "threw: " + err;

    console.error(
      "[wishlist] resendWishlistLeadEmail failed:",
      err
    );
  }


  try {
    await prisma.wishlistLead.update({
      where: {
        id: leadId,
      },

      data: {
        emailSendStatus: status,
      },
    });
  } catch (updateErr) {
    console.error(
      "[wishlist] failed to record resend result:",
      updateErr
    );
  }


  return status;
}


/**
 * Manual WhatsApp retry.
 */
export async function resendWishlistWhatsapp(
  leadId
) {
  const lead =
    await prisma.wishlistLead.findUnique({
      where: {
        id: leadId,
      },
    });


  if (!lead) {
    return "error: lead not found";
  }


  if (
    !Array.isArray(
      lead.productHandles
    ) ||
    !lead.productHandles.length
  ) {
    return "skipped: this wishlist is empty";
  }


  const settings =
    await getAppSettings(
      lead.shop
    );


  let status;


  try {
    status =
      await sendWishlistWhatsAppForLead(
        settings,
        lead
      );
  } catch (err) {
    status =
      "threw: " + err;

    console.error(
      "[wishlist] resendWishlistWhatsapp failed:",
      err
    );
  }


  try {
    await prisma.wishlistLead.update({
      where: {
        id: leadId,
      },

      data: {
        whatsappSendStatus:
          status,
      },
    });
  } catch (updateErr) {
    console.error(
      "[wishlist] failed to record WhatsApp resend result:",
      updateErr
    );
  }


  return status;
}


/**
 * Normalize phone number.
 */
function lastTenDigits(v) {
  const d = String(v || "")
    .replace(/\D/g, "");

  return d.length >= 10
    ? d.slice(-10)
    : d;
}


/**
 * Fetch saved wishlist.
 */
export async function fetchSavedWishlist(
  admin,
  shop,
  email,
  phone
) {
  const cleanEmail =
    String(email || "").trim();

  const wantPhone =
    lastTenDigits(phone);


  if (
    !cleanEmail ||
    wantPhone.length < 7
  ) {
    return {
      handles: [],
    };
  }


  const rows =
    await prisma.wishlistLead.findMany({
      where: {
        shop: shop || null,

        email: {
          equals: cleanEmail,
          mode: "insensitive",
        },
      },

      orderBy: {
        createdAt: "desc",
      },

      take: 50,
    });


  let handles = [];
  let verified = false;


  if (rows.length) {
    verified = rows.some(
      (r) =>
        r.phone &&
        lastTenDigits(r.phone) ===
          wantPhone
    );


    if (verified) {
      const latest = rows[0];

      handles =
        Array.isArray(
          latest.productHandles
        )
          ? latest.productHandles.filter(
              Boolean
            )
          : [];
    }
  } else if (admin) {
    try {
      const res =
        await admin.graphql(
          `#graphql
          query WishlistCustomerLookup($q: String!) {
            customers(first: 1, query: $q) {
              nodes {
                email
                phone
                tags
              }
            }
          }`,
          {
            variables: {
              q:
                "email:" +
                JSON.stringify(
                  cleanEmail
                ),
            },
          }
        );


      const c =
        (
          await res.json()
        )?.data?.customers
          ?.nodes?.[0];


      if (
        c &&
        String(
          c.email || ""
        ).toLowerCase() ===
          cleanEmail.toLowerCase() &&
        lastTenDigits(
          c.phone
        ) === wantPhone
      ) {
        verified = true;

        handles =
          (c.tags || [])
            .filter((t) =>
              t.startsWith(
                "wishlist:"
              )
            )
            .map((t) =>
              t.slice(
                "wishlist:".length
              )
            );
      }
    } catch (err) {
      console.error(
        "[wishlist] fetchSavedWishlist tag fallback failed:",
        err
      );
    }
  }


  if (
    !verified ||
    !handles.length
  ) {
    return {
      handles: [],
    };
  }


  const products =
    await getProductsByHandles(
      admin,
      handles
    );


  const existing =
    new Set(
      products.map(
        (p) => p.handle
      )
    );


  return {
    handles: handles.filter(
      (h) =>
        existing.has(h)
    ),
  };
}


/**
 * Reconcile Shopify wishlist tags.
 */
export async function reconcileCustomerWishlistTags(
  admin,
  email,
  handles
) {
  if (!admin || !email) {
    return {
      skipped: "no admin/email",
    };
  }


  const desired =
    new Set(
      (handles || [])
        .filter(Boolean)
        .map(
          (h) =>
            "wishlist:" + h
        )
    );


  const found =
    await admin.graphql(
      `#graphql
      query WishlistCustomerTags($q: String!) {
        customers(first: 1, query: $q) {
          nodes {
            id
            email
            tags
          }
        }
      }`,
      {
        variables: {
          q:
            "email:" +
            JSON.stringify(
              email
            ),
        },
      }
    );


  const customer =
    (
      await found.json()
    )?.data?.customers
      ?.nodes?.[0];


  if (
    !customer ||
    String(
      customer.email || ""
    ).toLowerCase() !==
      email.toLowerCase()
  ) {
    return {
      skipped:
        "no matching customer",
    };
  }


  const current =
    customer.tags || [];


  const toRemove =
    current.filter(
      (t) =>
        t.startsWith(
          "wishlist:"
        ) &&
        !desired.has(t)
    );


  const toAdd =
    [...desired].filter(
      (t) =>
        !current.includes(t)
    );


  if (toRemove.length) {
    const r =
      await admin.graphql(
        `#graphql
        mutation WishlistTagsRemove(
          $id: ID!,
          $tags: [String!]!
        ) {
          tagsRemove(
            id: $id,
            tags: $tags
          ) {
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            id: customer.id,
            tags: toRemove,
          },
        }
      );


    const errs =
      (
        await r.json()
      )?.data?.tagsRemove
        ?.userErrors;


    if (
      errs &&
      errs.length
    ) {
      console.error(
        "[wishlist] tagsRemove errors:",
        errs
      );
    }
  }


  if (toAdd.length) {
    const r =
      await admin.graphql(
        `#graphql
        mutation WishlistTagsAdd(
          $id: ID!,
          $tags: [String!]!
        ) {
          tagsAdd(
            id: $id,
            tags: $tags
          ) {
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            id: customer.id,
            tags: toAdd,
          },
        }
      );


    const errs =
      (
        await r.json()
      )?.data?.tagsAdd
        ?.userErrors;


    if (
      errs &&
      errs.length
    ) {
      console.error(
        "[wishlist] tagsAdd errors:",
        errs
      );
    }
  }


  return {
    removed: toRemove.length,
    added: toAdd.length,
  };
}


/**
 * Fetch product information.
 */
async function getProductsByHandles(
  admin,
  handles
) {
  const unique =
    [
      ...new Set(
        handles.filter(Boolean)
      ),
    ];


  if (!unique.length) {
    return [];
  }


  try {
    const queryParts =
      unique.map(
        (h, i) =>
          `p${i}: productByHandle(handle: ${JSON.stringify(
            h
          )}) {
            title
            handle
            featuredImage {
              url
            }
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            variants(first: 5) {
              nodes {
                sku
              }
            }
          }`
      );


    const res =
      await admin.graphql(
        `#graphql
        query WishlistProducts {
          ${queryParts.join(
            " "
          )}
        }`
      );


    const json =
      await res.json();


    return unique
      .map(
        (h, i) => {
          const p =
            json?.data?.[
              `p${i}`
            ];


          if (!p) {
            return null;
          }

          const skus = (p.variants?.nodes || []).map((v) => v.sku).filter(Boolean);
          const sku = skus.length > 0 ? skus.join(", ") : null;

          return {
            handle: h,
            title: p.title,
            imageUrl:
              p.featuredImage
                ?.url || "",
            price:
              p.priceRangeV2
                ?.minVariantPrice
                ?.amount || null,
            sku,
          };
        }
      )
      .filter(Boolean);
  } catch (err) {
    console.error(
      "[wishlist] getProductsByHandles failed:",
      err
    );

    return [];
  }
}


/**
 * Format INR.
 */
function formatRupees(
  amount
) {
  if (!amount) {
    return "";
  }

  return (
    "₹" +
    Number(
      amount
    ).toLocaleString(
      "en-IN",
      {
        minimumFractionDigits: 0,
      }
    )
  );
}


/**
 * Wishlist product row.
 *
 * Layout:
 *
 * [ IMAGE ] [ TITLE + PRICE ] [ BUY NOW ]
 *
 * BUY NOW is in a separate right-side
 * table cell for reliable email-client rendering.
 */
function wishlistItemRow(
  product,
  trackingCtx
) {
  const rawUrl =
    "https://" +
    STORE_DOMAIN +
    "/products/" +
    product.handle;


  const buyUrl =
    trackedClickUrl(
      trackingCtx.appUrl,
      trackingCtx.trackingId,
      rawUrl,
      "wishlist_" +
        product.handle +
        "_buy_now"
    );


  const imageCell =
    product.imageUrl
      ? `<img
          src="${esc(
            product.imageUrl
          )}"
          width="70"
          height="70"
          alt="${esc(
            product.title
          )}"
          style="
            display:block;
            width:70px;
            height:70px;
            object-fit:cover;
            border-radius:6px;
          "
        >`
      : `<div
          style="
            width:70px;
            height:70px;
            border-radius:6px;
            background:#f3f2ef;
          "
        ></div>`;


  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" >' +

    "<tr>" +

    /*
     * PRODUCT IMAGE
     */
    '<td width="70" style="padding:14px 14px 14px 0;vertical-align:middle;">' +

    imageCell +

    "</td>" +


    /*
     * PRODUCT TITLE + PRICE
     */
    '<td style="padding:14px 10px 14px 0;vertical-align:middle;">' +

    '<p style="margin:0 0 4px;font-size:14px;font-weight:bold;line-height:20px;color:#3d4652;">' +

    esc(
      product.title
    ) +

    "</p>" +

    (
      product.price
        ? '<p style="margin:0;font-size:13px;line-height:18px;color:#4f5965;">' +
          formatRupees(
            product.price
          ) +
          "</p>"
        : ""
    ) +

    "</td>" +


    /*
     * BUY NOW — RIGHT SIDE
     */
    '<td width="100" style="padding:14px 0;text-align:right;vertical-align:middle;">' +

    '<a href="' +
    esc(
      buyUrl
    ) +
    '" style="' +
    'display:inline-block;' +
    'background:#8c7a4e;' +
    'color:#ffffff !important;' +
    'font-size:12px;' +
    'font-weight:500;' +
    'line-height:16px;' +
    'text-decoration:none !important;' +
    'padding:10px 14px;' +
    'border-radius:3px;' +
    'white-space:nowrap;' +
    '">' +

    "BUY NOW" +

    "</a>" +

    "</td>" +

    "</tr>" +

    "</table>"
  );
}


/**
 * Build complete wishlist email.
 */
function buildWishlistEmailHtml({
  firstName,
  products,
  shopInfo,
  pixelUrl,
  viewAllUrl,
  storeUrl,
}) {
  const itemsHtml =
    products.length
      ? products
          .map(
            (p) =>
              wishlistItemRow(
                p,
                {
                  appUrl:
                    shopInfo._appUrl,

                  trackingId:
                    shopInfo._trackingId,
                }
              )
          )
          .join("")
      : `
        <p style="margin:0;">
          Your saved items are ready whenever you are.
        </p>
      `;


  return `<!DOCTYPE html>
<html lang="en">

<head>

  <title>Your wishlist is waiting for you</title>

  <meta
    http-equiv="Content-Type"
    content="text/html; charset=utf-8"
  >

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >


  <style type="text/css">

    body {
      margin: 0;
      padding: 0;
      width: 100%;
      background-color: #f3f2ef;
      font-family: Arial, Helvetica, sans-serif;
      color: #4f5965;
    }


    table {
      border-spacing: 0;
      border-collapse: collapse;
    }


    img {
      border: 0;
      display: block;
    }


    a {
      text-decoration: none;
    }


    .email-wrapper {
      width: 100%;
      background-color: #f3f2ef;
    }


    .page-padding {
      padding: 32px 0;
    }


    .email-container {
      width: 500px;
      max-width: 500px;
      background-color: #ffffff;
      border-radius: 0 0 12px 12px;
      overflow: hidden;
    }


    .logo-section {
      padding: 28px 20px 25px;
      text-align: center;
      background-color: #fffcf3;
      border-top: 5px solid #8c7a4e;
    }


    .logo-section img {
      max-width: 100px;
      width: auto;
      height: auto;
      margin: 0 auto;
    }


    .logo-text {
      margin: 0;
      font-size: 30px;
      font-weight: normal;
      color: #a76642;
    }


    .divider-cell {
      padding-left: 0;
      padding-right: 0;
    }


    .divider {
      height: 1px;
      background-color: #d5d0c8;
      width: 100%;
      font-size: 1px;
      line-height: 1px;
    }


    .content-section {
      padding: 30px 28px 8px;
      font-size: 15px;
      line-height: 1.6;
      color: #4f5965;
      background-color: #ffffff;
    }


    .content-inner {
      width: 100%;
      margin: 0 auto;
    }


    .content-section p {
      margin-top: 0;
      margin-bottom: 18px;
    }


    .button-table {
      width: 100%;
      margin-top: 12px;
      margin-bottom: 20px;
    }


    .email-button {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      background-color: #8c7a4e;
      color: #ffffff !important;
      padding: 12px 5px;
      font-size: 14px;
      font-weight: 500;
      line-height: 16px;
      border-radius: 3px;
      white-space: nowrap;
      text-decoration: none !important;
    }


    .store-button {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: center;
      background-color: #ffffff;
      color: #8c7a4e !important;
      padding: 11px 5px;
      font-size: 14px;
      font-weight: 500;
      line-height: 16px;
      border: 1px solid #8c7a4e;
      border-radius: 3px;
      white-space: nowrap;
      text-decoration: none !important;
    }


    .footer-section {
      padding: 14px 18px 16px;
      text-align: center;
      color: #4f5965;
      background-color: #fffcf3;
    }


    .footer-title {
      margin: 0 0 8px;
      font-size: 14px;
      line-height: 1.45;
      color: #4f5965;
    }


    .address {
      margin: 0 0 10px;
      font-size: 13px;
      line-height: 1.45;
      color: #333333 !important;
    }


    .address a {
      color: #333333 !important;
      text-decoration: none !important;
    }


    .contact-table {
      width: 100%;
      margin: 0 auto;
      table-layout: fixed;
    }


    .website-row {
      padding-bottom: 8px;
    }


    .contact-item {
      width: 50%;
      padding: 3px 2px;
      text-align: center;
      vertical-align: middle;
      font-size: 13px;
      line-height: 18px;
    }


    .single-contact-item {
      padding: 3px 2px;
      text-align: center;
      vertical-align: middle;
      font-size: 13px;
      line-height: 18px;
    }


    .contact-link {
      color: #333333 !important;
      text-decoration: none !important;
      white-space: nowrap;
    }


    .contact-icon {
      width: 18px;
      height: 18px;
      display: block;
    }


    @media only screen and (max-width: 600px) {

      .page-padding {
        padding: 0 !important;
      }


      .email-container {
        width: 100% !important;
        max-width: 100% !important;
        border-radius: 0 !important;
      }


      .logo-section {
        padding: 22px 15px !important;
      }


      .logo-section img {
        max-width: 100px !important;
      }


      .content-section {
        padding: 24px 20px 8px !important;
        font-size: 16px !important;
      }


      .footer-section {
        padding: 12px 12px 14px !important;
      }


      .footer-title {
        font-size: 14px !important;
        line-height: 1.4 !important;
        margin-bottom: 7px !important;
      }


      .address {
        font-size: 13px !important;
        line-height: 1.4 !important;
        margin-bottom: 8px !important;
      }


      .website-row {
        padding-bottom: 6px !important;
      }


      .contact-item,
      .single-contact-item {
        padding: 3px 1px !important;
        font-size: 13px !important;
      }


      .contact-link {
        white-space: nowrap !important;
      }

    }

  </style>

</head>


<body>


  ${
    pixelUrl
      ? `
        <img
          src="${esc(pixelUrl)}"
          width="1"
          height="1"
          style="display:none;border:0;"
          alt=""
        >
      `
      : ""
  }


  <table
    class="email-wrapper"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
  >

    <tr>

      <td
        class="page-padding"
        align="center"
      >

        <table
          class="email-container"
          width="500"
          cellpadding="0"
          cellspacing="0"
          border="0"
        >


          <!-- HEADER -->

          <tr>

            <td class="logo-section">

              ${
                shopInfo.logoUrl
                  ? `
                    <img
                      src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/ong-logo-house-of-shubh-gems.png"
                      alt="${esc(
                        shopInfo.name
                      )}"
                      width="100"
                    >
                  `
                  : `
                    <h1 class="logo-text">
                      ${esc(
                        shopInfo.name
                      )}
                    </h1>
                  `
              }

            </td>

          </tr>


          <!-- DIVIDER -->

          <tr>

            <td class="divider-cell">

              <div class="divider">
                &nbsp;
              </div>

            </td>

          </tr>


          <!-- MAIN CONTENT -->

          <tr>

            <td class="content-section">

              <div class="content-inner">


                <!-- CUSTOMER NAME -->

                <p>
                  Hello,
                </p>


                <p>
                  Here's everything you've saved
                  to your wishlist -- pick up right
                  where you left off.
                </p>


                <!-- PRODUCTS -->

                ${itemsHtml}


                <!-- BUTTONS -->

                <table
                  class="button-table"
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                >

                  <tr>


                    <!-- VIEW WISHLIST -->

                    <td
                      width="50%"
                      style="padding-right:5px;"
                    >

                      <a
                        href="${esc(
                          viewAllUrl
                        )}"
                        class="email-button"
                      >
                        View Full Wishlist
                      </a>

                    </td>


                    <!-- VISIT STORE -->

                    <td
                      width="50%"
                      style="padding-left:5px;"
                    >

                      <a
                        href="${esc(
                          storeUrl
                        )}"
                        class="store-button"
                      >
                        Visit Our Store
                      </a>

                    </td>


                  </tr>

                </table>


              </div>

            </td>

          </tr>


          <!-- DIVIDER -->

          <tr>

            <td class="divider-cell">

              <div class="divider">
                &nbsp;
              </div>

            </td>

          </tr>


          <!-- FOOTER -->

          <tr>

            <td class="footer-section">


              <p class="footer-title">

                Thanks for choosing
                ${esc(
                  shopInfo.name
                )}
                from the House of ONG.

              </p>


              <p class="address">

                <a href="https://maps.app.goo.gl/vffRkrDyMiM9q895A">

                  L-75-76, Lajpat Nagar 2,
                  New Delhi - Delhi - 110024,
                  India

                </a>

              </p>


              <!-- WEBSITE -->

              <table
                class="contact-table"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >

                <tr>

                  <td
                    class="single-contact-item website-row"
                    align="center"
                  >

                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >

                      <tr>

                        <td
                          valign="middle"
                          style="padding-right:6px;"
                        >

                          <img
                            src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/website.png?v=1788870868"
                            alt="Website"
                            width="18"
                            height="18"
                            class="contact-icon"
                          >

                        </td>


                        <td valign="middle">

                          <a
                            href="${esc(
                              shopInfo.url
                            )}"
                            class="contact-link"
                          >
                            onlynaturalgemstones.com
                          </a>

                        </td>

                      </tr>

                    </table>

                  </td>

                </tr>

              </table>


              <!-- PHONE NUMBERS -->

              <table
                class="contact-table"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >

                <tr>


                  <!-- WHATSAPP -->

                  <td
                    class="contact-item"
                    align="center"
                  >

                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >

                      <tr>

                        <td
                          valign="middle"
                          style="padding-right:5px;"
                        >

                          <a href="https://wa.me/919310400152">

                            <img
                              src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/whatsapp-svg-icon.svg?v=1787318358"
                              alt="WhatsApp"
                              width="18"
                              height="18"
                              class="contact-icon"
                            >

                          </a>

                        </td>


                        <td valign="middle">

                          <a
                            href="https://wa.me/919310400152"
                            class="contact-link"
                          >
                            +91-9310-400-152
                          </a>

                        </td>

                      </tr>

                    </table>

                  </td>


                  <!-- PHONE -->

                  <td
                    class="contact-item"
                    align="center"
                  >

                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >

                      <tr>

                        <td
                          valign="middle"
                          style="padding-right:5px;"
                        >

                          <img
                            src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/phone.png?v=1788597346"
                            alt="Phone"
                            width="18"
                            height="18"
                            class="contact-icon"
                          >

                        </td>


                        <td valign="middle">

                          <a
                            href="tel:+918010555111"
                            class="contact-link"
                          >
                            +91-8010-555-111
                          </a>

                        </td>

                      </tr>

                    </table>

                  </td>


                </tr>

              </table>


              <!-- EMAIL -->

              <table
                class="contact-table"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
              >

                <tr>

                  <td
                    class="single-contact-item"
                    align="center"
                  >

                    <table
                      cellpadding="0"
                      cellspacing="0"
                      border="0"
                      align="center"
                    >

                      <tr>

                        <td
                          valign="middle"
                          style="padding-right:6px;"
                        >

                          <img
                            src="https://cdn.shopify.com/s/files/1/0992/9929/5531/files/email_icon_24px.png?v=1790236665"
                            alt="Email"
                            width="18"
                            class="contact-icon"
                          >

                        </td>


                        <td valign="middle">

                          <a
                            href="mailto:${esc(
                              shopInfo.email
                            )}"
                            class="contact-link"
                          >
                            ${esc(
                              shopInfo.email
                            )}
                          </a>

                        </td>

                      </tr>

                    </table>

                  </td>

                </tr>

              </table>


            </td>

          </tr>


        </table>

      </td>

    </tr>

  </table>


</body>

</html>`;
}


/**
 * Send wishlist email.
 */
export async function sendWishlistEmail(
  admin,
  settings,
  email,
  handles,
  products,
  trackingId
) {

  if (
    !settings.gmailUser ||
    !settings.gmailAppPassword
  ) {
    return "skipped: Gmail user / app password not set (Settings page or GMAIL_USER / GMAIL_APP_PASSWORD env vars)";
  }


  const appUrl =
    (
      process.env.SHOPIFY_APP_URL ||
      ""
    ).replace(
      /\/$/,
      ""
    );


  const shopInfo =
    await getShopFooterInfo(
      admin
    );


  /**
   * Used by product rows for tracked
   * BUY NOW links.
   */
  shopInfo._appUrl =
    appUrl;

  shopInfo._trackingId =
    trackingId;


  /**
   * Email open tracking.
   */
  const pixelUrl =
    appUrl
      ? appUrl +
        "/track/open?id=" +
        encodeURIComponent(
          trackingId
        )
      : null;


  /**
   * VIEW FULL WISHLIST
   */
  const viewAllRaw =
    "https://" +
    STORE_DOMAIN +
    "/?shared_wishlist=" +
    handles
      .map(
        encodeURIComponent
      )
      .join(",");


  const viewAllUrl =
    trackedClickUrl(
      appUrl,
      trackingId,
      viewAllRaw,
      "view_full_wishlist"
    );


  /**
   * VISIT OUR STORE
   *
   * This was missing in the previous
   * version. It now gets its own real
   * tracked URL.
   */
  const storeRaw =
    "https://" +
    STORE_DOMAIN;


  const storeUrl =
    trackedClickUrl(
      appUrl,
      trackingId,
      storeRaw,
      "visit_store"
    );


  /**
   * Customer name.
   */
  const firstName =
    email.split("@")[0];


  const subject =
    products.length === 1
      ? "You saved something special"
      : "Your wishlist is waiting for you";


  /**
   * Build HTML.
   */
  const htmlBody =
    buildWishlistEmailHtml({
      firstName,
      products,
      shopInfo,
      pixelUrl,
      viewAllUrl,
      storeUrl,
    });


  /**
   * Plain-text fallback.
   */
  const plainBody =
    "Hi,\n\n" +
    "Here's what's in your wishlist: " +

    (
      products.length
        ? products
            .map(
              (p) =>
                p.title
            )
            .join(", ")
        : handles.join(", ")
    ) +

    "\n\nView your full wishlist: " +
    viewAllRaw +

    "\n\nVisit our store: " +
    storeRaw +

    "\n\n" +
    shopInfo.name;


  /**
   * Gmail transporter.
   */
  const transporter =
    nodemailer.createTransport({
      service: "gmail",

      auth: {
        user:
          settings.gmailUser,

        pass:
          settings.gmailAppPassword,
      },
    });


  /**
   * Send email.
   */
  await transporter.sendMail({

    from:
      '"' +
      shopInfo.name +
      '" <' +
      settings.gmailUser +
      ">",

    to: email,

    subject,

    text:
      plainBody,

    html:
      htmlBody,
  });


  /**
   * Log email event.
   */
  try {

    await prisma.emailEvent.create({
      data: {
        trackingId,
        event: "sent",
        detail: email,
      },
    });


    await mirrorEmailEventToSheet(
      settings,
      trackingId,
      "sent",
      email
    );

  } catch (logErr) {

    console.error(
      "[wishlist] email sent OK but failed to log 'sent' event:",
      logErr
    );

  }


  return (
    "OK: sent to " +
    email
  );
}