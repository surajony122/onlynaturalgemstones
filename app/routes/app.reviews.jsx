/**
 * Manually-curated Google Reviews — shown on the storefront homepage
 * (every active review, no selection needed) and, per-review, on
 * whichever collection pages you pick. See proxy.reviews.jsx for the
 * storefront-facing read side and sections/shubh-google-reviews.liquid
 * for the theme section that renders them.
 *
 * Manual entry for now — copy each review's name/stars/text/date
 * straight from the Google Business Profile listing. Once the Google
 * Business Profile API access request clears, a sync job can start
 * writing rows into this same table alongside anything entered here by
 * hand; nothing about the storefront side changes either way.
 */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { tableWrapStyle, tableStyle, thStyle, tdStyle, TableGlobalStyles, Pill } from "../components/table-kit";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const reviews = await prisma.googleReview.findMany({
    where: { shop: session.shop },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  let collections = [];
  try {
    const res = await admin.graphql(`#graphql
      query { collections(first: 100) { nodes { title handle } } }`);
    const json = await res.json();
    collections = (json?.data?.collections?.nodes || []).map((c) => ({ handle: c.handle, title: c.title }));
  } catch (err) {
    console.error("[app.reviews] failed to fetch collections:", err);
  }

  return {
    reviews: reviews.map((r) => ({
      ...r,
      collections: Array.isArray(r.collections) ? r.collections : [],
      createdAt: r.createdAt.toISOString(),
    })),
    collections,
  };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const authorName = formData.get("authorName")?.trim();
    const reviewText = formData.get("reviewText")?.trim();
    const rating = Math.min(5, Math.max(1, parseInt(formData.get("rating"), 10) || 0));
    if (!authorName || !reviewText || !rating) {
      return { intent, ok: false, error: "Name, rating, and review text are all required." };
    }
    try {
      await prisma.googleReview.create({
        data: {
          shop: session.shop,
          authorName,
          rating,
          reviewText,
          reviewDate: formData.get("reviewDate")?.trim() || null,
          photoUrl: formData.get("photoUrl")?.trim() || null,
          collections: [],
          isActive: true,
          sortOrder: 0,
        },
      });
      return { intent, ok: true };
    } catch (err) {
      return { intent, ok: false, error: String(err?.message || err) };
    }
  }

  const id = formData.get("id");

  if (intent === "update") {
    if (!id) return { intent, ok: false, error: "Missing id" };
    let collections = [];
    try {
      collections = JSON.parse(formData.get("collections") || "[]");
      if (!Array.isArray(collections)) collections = [];
    } catch {
      collections = [];
    }
    try {
      await prisma.googleReview.update({
        where: { id },
        data: {
          authorName: formData.get("authorName")?.trim() || "",
          rating: Math.min(5, Math.max(1, parseInt(formData.get("rating"), 10) || 1)),
          reviewText: formData.get("reviewText")?.trim() || "",
          reviewDate: formData.get("reviewDate")?.trim() || null,
          photoUrl: formData.get("photoUrl")?.trim() || null,
          collections,
          isActive: formData.get("isActive") === "true",
          sortOrder: parseInt(formData.get("sortOrder"), 10) || 0,
        },
      });
      return { intent, ok: true, id };
    } catch (err) {
      return { intent, ok: false, id, error: String(err?.message || err) };
    }
  }

  if (intent === "delete") {
    if (!id) return { intent, ok: false, error: "Missing id" };
    try {
      await prisma.googleReview.delete({ where: { id } });
      return { intent, ok: true, id };
    } catch (err) {
      return { intent, ok: false, id, error: String(err?.message || err) };
    }
  }

  return { intent, ok: false, error: "Unknown intent" };
};

const fieldStyle = {
  display: "block",
  width: "100%",
  padding: "8px 10px",
  marginTop: "4px",
  marginBottom: "10px",
  border: "1px solid #E5E7EB",
  borderRadius: "8px",
  fontSize: "12.5px",
  fontFamily: "inherit",
  color: "#374151",
  background: "#fff",
  boxSizing: "border-box",
};
const labelStyle = { fontWeight: 500, fontSize: "11.5px", color: "#374151" };
const smallBtn = {
  fontSize: "11px",
  padding: "4px 10px",
  borderRadius: "8px",
  border: "1px solid #E5E7EB",
  background: "#ffffff",
  cursor: "pointer",
};

function Stars({ rating }) {
  return (
    <span style={{ color: "#B45309", letterSpacing: "1px" }}>
      {"★".repeat(rating)}
      <span style={{ color: "#E5E7EB" }}>{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function AddReviewForm() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const [authorName, setAuthorName] = useState("");
  const [rating, setRating] = useState("5");
  const [reviewText, setReviewText] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  useEffect(() => {
    if (fetcher.data?.intent !== "create") return;
    if (fetcher.data.ok) {
      shopify.toast.show("Review added");
      setAuthorName("");
      setRating("5");
      setReviewText("");
      setReviewDate("");
      setPhotoUrl("");
    } else {
      shopify.toast.show(fetcher.data.error || "Couldn't add review", { isError: true });
    }
  }, [fetcher.data, shopify]);

  const submit = (e) => {
    e.preventDefault();
    fetcher.submit({ intent: "create", authorName, rating, reviewText, reviewDate, photoUrl }, { method: "POST" });
  };

  return (
    <s-section heading="Add a review">
      <s-paragraph>
        Copy each review's details straight from your Google Business Profile listing. New reviews start visible on
        the homepage only — pick which collections (if any) it should also appear on further down the page.
      </s-paragraph>
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "12px" }}>
          <div>
            <label style={labelStyle} htmlFor="authorName">Reviewer name</label>
            <input
              id="authorName"
              style={fieldStyle}
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="e.g. Priya Sharma"
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="rating">Rating</label>
            <select id="rating" style={fieldStyle} value={rating} onChange={(e) => setRating(e.target.value)}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>
              ))}
            </select>
          </div>
        </div>

        <label style={labelStyle} htmlFor="reviewText">Review text</label>
        <textarea
          id="reviewText"
          style={{ ...fieldStyle, minHeight: "70px" }}
          value={reviewText}
          onChange={(e) => setReviewText(e.target.value)}
          placeholder="Paste the review's text here"
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <label style={labelStyle} htmlFor="reviewDate">
              Date shown (optional, free text — as it reads on Google)
            </label>
            <input
              id="reviewDate"
              style={fieldStyle}
              type="text"
              value={reviewDate}
              onChange={(e) => setReviewDate(e.target.value)}
              placeholder="e.g. 2 months ago"
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="photoUrl">Reviewer photo URL (optional)</label>
            <input
              id="photoUrl"
              style={fieldStyle}
              type="text"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>

        <s-button {...(busy ? { loading: true } : {})} onClick={submit}>
          Add review
        </s-button>
      </form>
    </s-section>
  );
}

function ReviewRow({ review, collections }) {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const [editing, setEditing] = useState(false);

  const [authorName, setAuthorName] = useState(review.authorName);
  const [rating, setRating] = useState(String(review.rating));
  const [reviewText, setReviewText] = useState(review.reviewText);
  const [reviewDate, setReviewDate] = useState(review.reviewDate || "");
  const [photoUrl, setPhotoUrl] = useState(review.photoUrl || "");
  const [selectedCollections, setSelectedCollections] = useState(review.collections);
  const [isActive, setIsActive] = useState(review.isActive);

  useEffect(() => {
    if (fetcher.data?.intent === "update" && fetcher.data.id === review.id) {
      if (fetcher.data.ok) {
        shopify.toast.show("Saved");
        setEditing(false);
      } else {
        shopify.toast.show(fetcher.data.error || "Couldn't save", { isError: true });
      }
    }
    if (fetcher.data?.intent === "delete" && fetcher.data.ok && fetcher.data.id === review.id) {
      // row unmounts via the parent filtering it out — nothing to do here
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  if (fetcher.data?.intent === "delete" && fetcher.data.ok && fetcher.data.id === review.id) {
    return null;
  }

  const toggleCollection = (handle) => {
    setSelectedCollections((prev) => (prev.includes(handle) ? prev.filter((h) => h !== handle) : [...prev, handle]));
  };

  const save = () => {
    fetcher.submit(
      {
        intent: "update",
        id: review.id,
        authorName,
        rating,
        reviewText,
        reviewDate,
        photoUrl,
        collections: JSON.stringify(selectedCollections),
        isActive: String(isActive),
        sortOrder: String(review.sortOrder),
      },
      { method: "POST" }
    );
  };

  const cancel = () => {
    setAuthorName(review.authorName);
    setRating(String(review.rating));
    setReviewText(review.reviewText);
    setReviewDate(review.reviewDate || "");
    setPhotoUrl(review.photoUrl || "");
    setSelectedCollections(review.collections);
    setIsActive(review.isActive);
    setEditing(false);
  };

  const quickToggleActive = () => {
    const next = !isActive;
    setIsActive(next);
    fetcher.submit(
      {
        intent: "update",
        id: review.id,
        authorName: review.authorName,
        rating: String(review.rating),
        reviewText: review.reviewText,
        reviewDate: review.reviewDate || "",
        photoUrl: review.photoUrl || "",
        collections: JSON.stringify(review.collections),
        isActive: String(next),
        sortOrder: String(review.sortOrder),
      },
      { method: "POST" }
    );
  };

  const deleteReview = () => {
    if (!window.confirm(`Delete this review from ${review.authorName}? This can't be undone.`)) return;
    fetcher.submit({ intent: "delete", id: review.id }, { method: "POST" });
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={6} style={{ ...tdStyle, background: "#F9FAFB" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: "10px" }}>
            <div>
              <label style={labelStyle}>Reviewer name</label>
              <input style={fieldStyle} type="text" value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Rating</label>
              <select style={fieldStyle} value={rating} onChange={(e) => setRating(e.target.value)}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>{n}★</option>
                ))}
              </select>
            </div>
          </div>
          <label style={labelStyle}>Review text</label>
          <textarea style={{ ...fieldStyle, minHeight: "60px" }} value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={labelStyle}>Date shown</label>
              <input style={fieldStyle} type="text" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Photo URL</label>
              <input style={fieldStyle} type="text" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
            </div>
          </div>

          <label style={labelStyle}>
            Also show on these collections (homepage always shows every active review regardless)
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "6px 0 12px" }}>
            {collections.length === 0 ? (
              <span style={{ fontSize: "11.5px", color: "#6B7280" }}>No collections found.</span>
            ) : (
              collections.map((c) => (
                <label
                  key={c.handle}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: "11.5px",
                    padding: "4px 9px",
                    borderRadius: "999px",
                    border: "1px solid #E5E7EB",
                    background: selectedCollections.includes(c.handle) ? "#EFF4FF" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedCollections.includes(c.handle)}
                    onChange={() => toggleCollection(c.handle)}
                  />
                  {c.title}
                </label>
              ))
            )}
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <s-button {...(busy ? { loading: true } : {})} onClick={save}>Save</s-button>
            <button type="button" style={smallBtn} onClick={cancel} disabled={busy}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="dt-row" style={{ opacity: busy ? 0.6 : 1 }}>
      <td style={tdStyle}>
        <div style={{ fontWeight: 500 }}>{review.authorName}</div>
        {review.reviewDate && <div style={{ fontSize: "11px", color: "#6B7280" }}>{review.reviewDate}</div>}
      </td>
      <td style={tdStyle}><Stars rating={review.rating} /></td>
      <td style={{ ...tdStyle, whiteSpace: "normal", maxWidth: "360px" }} title={review.reviewText}>
        {review.reviewText.length > 140 ? review.reviewText.slice(0, 140) + "…" : review.reviewText}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: "160px" }}>
        <Pill label="Homepage" active color="#8c7a4e" />
        {review.collections.map((handle) => {
          const match = collections.find((c) => c.handle === handle);
          return <Pill key={handle} label={match ? match.title : handle} active color="#2563EB" />;
        })}
      </td>
      <td style={tdStyle}>
        <button type="button" onClick={quickToggleActive} disabled={busy} style={{ ...smallBtn, cursor: "pointer" }}>
          {isActive ? <Pill label="Active" active color="#16A34A" /> : <Pill label="Hidden" color="#6B7280" />}
        </button>
      </td>
      <td style={{ ...tdStyle, minWidth: "110px" }}>
        <button type="button" style={smallBtn} onClick={() => setEditing(true)} disabled={busy}>Edit</button>{" "}
        <button type="button" style={{ ...smallBtn, color: "#DC2626" }} onClick={deleteReview} disabled={busy}>Delete</button>
      </td>
    </tr>
  );
}

export default function ReviewsPage() {
  const { reviews, collections } = useLoaderData();

  return (
    <s-page heading={`Google Reviews (${reviews.length})`} width="full">
      <AddReviewForm />

      <s-section heading="All reviews">
        <TableGlobalStyles />
        {reviews.length === 0 ? (
          <s-paragraph>No reviews added yet — use the form above to add your first one.</s-paragraph>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Reviewer</th>
                  <th style={thStyle}>Rating</th>
                  <th style={thStyle}>Review</th>
                  <th style={thStyle}>Shows on</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <ReviewRow key={r.id} review={r} collections={collections} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section slot="aside" heading="How this shows on the storefront">
        <s-paragraph>
          Every <s-text fontWeight="bold">Active</s-text> review shows on the homepage automatically. A review only
          shows on a collection page if you've explicitly checked that collection when editing it — nothing shows on
          a collection page by default.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
