import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  repriceDesignVariants,
  findJewelryProducts,
  setupJewelryVariantsForProducts,
  fixChannelsForProducts,
  setInventoryForProducts,
  removeJewelryVariantsForProducts,
  SETUP_BATCH_SIZE,
  BULK_BATCH_SIZE,
  PRODUCT_ID_NUMERIC,
} from "../utils/repriceDesignVariants.server";
import { findLiveThemeId, inspectThemeCustomizerFiles, listThemes } from "../utils/shopify-admin.server";
import { tableWrapStyle, tableStyle, thStyle, tdStyle, TableGlobalStyles, Pill, brand } from "../components/table-kit";
import { FriendlyError, FriendlyErrorInline } from "../components/friendly-error";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  // PRODUCT_ID_NUMERIC/SETUP_BATCH_SIZE live in a .server.js file — React
  // Router strips server-only modules from the client bundle, so a
  // component can't import them directly for use in JSX (that broke the
  // build). Returning them from the loader and reading them via
  // useLoaderData is the server -> client handoff React Router supports.
  return {
    productId: PRODUCT_ID_NUMERIC,
    setupBatchSize: SETUP_BATCH_SIZE,
    bulkBatchSize: BULK_BATCH_SIZE,
    // .myshopify.com domain minus the suffix — matches the path segment
    // admin.shopify.com/store/<this> uses for deep links to a product.
    shopDomain: (session.shop || "").replace(".myshopify.com", ""),
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "scanSetup") {
    try {
      const result = await findJewelryProducts(admin);
      return { intent, ok: true, ...result };
    } catch (err) {
      console.error("[app._index] scanSetup failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "setupSelected") {
    try {
      const items = JSON.parse(formData.get("items") || "[]");
      if (!Array.isArray(items) || !items.length) {
        return { intent, ok: false, error: "Check at least one product first." };
      }
      console.log("[app._index] setupSelected items:", JSON.stringify(items));
      const result = await setupJewelryVariantsForProducts(admin, items);
      return { intent, ok: true, ...result };
    } catch (err) {
      // Logged with the full stack (not just err.message) — this is the
      // ONE place a real Shopify/GraphQL failure from this button lands,
      // and the UI's friendly-error card only shows err.message, which is
      // sometimes too short to actually diagnose from (e.g. a bare
      // "productSet failed: [...]" with truncated userErrors). Render's
      // Logs tab is the fallback when a screenshot of the UI card isn't
      // getting the detail across.
      console.error("[app._index] setupSelected failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "fixChannels") {
    try {
      const productGids = JSON.parse(formData.get("productGids") || "[]");
      if (!Array.isArray(productGids) || !productGids.length) {
        return { intent, ok: false, error: "Check at least one product first." };
      }
      const result = await fixChannelsForProducts(admin, productGids);
      return { intent, ok: true, ...result };
    } catch (err) {
      console.error("[app._index] fixChannels failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "setInventory") {
    try {
      const productGids = JSON.parse(formData.get("productGids") || "[]");
      const quantity = parseInt(formData.get("quantity"), 10);
      if (!Array.isArray(productGids) || !productGids.length) {
        return { intent, ok: false, error: "Check at least one product first." };
      }
      if (!Number.isInteger(quantity) || quantity < 0) {
        return { intent, ok: false, error: "Enter a valid stock quantity (0 or more) first." };
      }
      const result = await setInventoryForProducts(admin, productGids, quantity);
      return { intent, ok: true, quantity, ...result };
    } catch (err) {
      console.error("[app._index] setInventory failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "listThemes") {
    try {
      const themes = await listThemes(admin);
      return { intent, ok: true, themes };
    } catch (err) {
      console.error("[app._index] listThemes failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "inspectTheme") {
    try {
      const themeId = formData.get("themeId");
      const themeName = formData.get("themeName");
      const theme = themeId ? { id: themeId, name: themeName || themeId } : await findLiveThemeId(admin);
      const result = await inspectThemeCustomizerFiles(admin, theme.id);
      console.log(
        "[app._index] inspectTheme:",
        JSON.stringify({ theme, totalFilesScanned: result.totalFilesScanned, candidates: result.candidates }),
      );
      return { intent, ok: true, theme, ...result };
    } catch (err) {
      console.error("[app._index] inspectTheme failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  if (intent === "removeVariants") {
    try {
      const productGids = JSON.parse(formData.get("productGids") || "[]");
      if (!Array.isArray(productGids) || !productGids.length) {
        return { intent, ok: false, error: "Check at least one product first." };
      }
      const result = await removeJewelryVariantsForProducts(admin, productGids);
      return { intent, ok: true, ...result };
    } catch (err) {
      console.error("[app._index] removeVariants failed:", err);
      return { intent, ok: false, error: String(err.message || err) };
    }
  }

  try {
    const result = await repriceDesignVariants(admin);
    return { intent: "reprice", ok: true, ...result };
  } catch (err) {
    console.error("[app._index] reprice failed:", err);
    return { intent: "reprice", ok: false, error: String(err.message || err) };
  }
};

export default function Index() {
  const { productId, shopDomain, setupBatchSize, bulkBatchSize } = useLoaderData();
  const fetcher = useFetcher();
  const scanFetcher = useFetcher();
  const setupFetcher = useFetcher();
  const channelFetcher = useFetcher();
  const inventoryFetcher = useFetcher();
  const removeFetcher = useFetcher();
  const themeFetcher = useFetcher();
  const themeListFetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  const isScanning = scanFetcher.state !== "idle";
  const isSettingUp = setupFetcher.state !== "idle";
  const isFixingChannels = channelFetcher.state !== "idle";
  const isSettingInventory = inventoryFetcher.state !== "idle";
  const isRemoving = removeFetcher.state !== "idle";
  const isInspectingTheme = themeFetcher.state !== "idle";
  const isListingThemes = themeListFetcher.state !== "idle";
  const [selectedThemeId, setSelectedThemeId] = useState("");
  const [bulkQuantity, setBulkQuantity] = useState("10");

  // Local copy of the scanned product list so a successful Apply can
  // optimistically update the rows it just touched, without forcing a
  // full re-scan to see progress — synced from scanFetcher's result
  // whenever a fresh scan comes back.
  const [products, setProducts] = useState([]);
  const [checked, setChecked] = useState(() => new Set());
  const [searchText, setSearchText] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all"); // all | missing | setup
  const [designFilter, setDesignFilter] = useState("all"); // all | incomplete
  // Per-product Type selection (Ring/Bracelet/Pendent subset) — keyed by
  // product id. Defaults to the product's CURRENT Types if it's already
  // set up (so re-scanning never silently proposes removing something),
  // or its full availableTypes if it isn't set up yet (today's automatic
  // behavior) — nothing changes for a product unless you touch its
  // checkboxes yourself.
  const [selectedTypes, setSelectedTypes] = useState({});

  useEffect(() => {
    if (scanFetcher.data?.intent === "scanSetup" && scanFetcher.data.ok) {
      const scanned = scanFetcher.data.products || [];
      setProducts(scanned);
      setChecked(new Set());
      setSearchText("");
      setCollectionFilter("all");
      setStatusFilter("all");
      setSelectedTypes(
        Object.fromEntries(
          scanned.map((p) => {
            const current = p.currentTypes || [];
            const available = p.availableTypes || [];
            return [p.id, current.length ? [...current] : [...available]];
          })
        )
      );
    }
  }, [scanFetcher.data]);

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(`Repriced ${fetcher.data.variantCount} variants`);
    } else if (fetcher.data && !fetcher.data.ok) {
      shopify.toast.show("Couldn't reprice the variants — see details below", { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (scanFetcher.data?.intent === "scanSetup" && !scanFetcher.data.ok) {
      shopify.toast.show("Couldn't scan your products — try again in a moment", { isError: true });
    }
  }, [scanFetcher.data, shopify]);

  useEffect(() => {
    if (setupFetcher.data?.intent !== "setupSelected") return;
    if (!setupFetcher.data.ok) {
      shopify.toast.show(
        setupFetcher.data.error === "Check at least one product first."
          ? setupFetcher.data.error
          : "Couldn't apply those changes — try again in a moment",
        { isError: true }
      );
      return;
    }
    const results = setupFetcher.data.results || [];
    const resultByGid = Object.fromEntries(results.map((r) => [r.productGid, r]));
    const succeededGids = new Set(results.filter((r) => r.ok).map((r) => r.productGid));
    // Update each succeeded row in place (now "set up" with its new
    // Types) instead of removing it — it stays visible/editable, since
    // this table is for changing selections too, not just first-time
    // setup.
    setProducts((prev) =>
      prev.map((p) => {
        const r = resultByGid[p.id];
        if (!r?.ok) return p;
        return { ...p, hasSetup: true, currentTypes: r.types || [] };
      })
    );
    setChecked((prev) => {
      const next = new Set(prev);
      succeededGids.forEach((gid) => next.delete(gid));
      return next;
    });
    const failCount = results.length - succeededGids.size;
    shopify.toast.show(
      `Applied to ${succeededGids.size} product${succeededGids.size === 1 ? "" : "s"}` +
        (failCount ? ` · ${failCount} failed (see table)` : "") +
        (setupFetcher.data.skipped ? ` · ${setupFetcher.data.skipped} more selected — click Apply again` : ""),
      { isError: failCount > 0 && succeededGids.size === 0 }
    );
  }, [setupFetcher.data, shopify]);

  useEffect(() => {
    if (channelFetcher.data?.intent !== "fixChannels") return;
    if (!channelFetcher.data.ok) {
      shopify.toast.show(
        channelFetcher.data.error === "Check at least one product first."
          ? channelFetcher.data.error
          : "Couldn't fix channels for those products — try again in a moment",
        { isError: true }
      );
      return;
    }
    const results = channelFetcher.data.results || [];
    const resultByGid = Object.fromEntries(results.map((r) => [r.productGid, r]));
    const succeededGids = new Set(results.filter((r) => r.ok).map((r) => r.productGid));
    // A succeeded fix means the product is now published to Online Store
    // only — update the count locally so the pill flips green immediately
    // instead of waiting for a re-scan.
    setProducts((prev) =>
      prev.map((p) => (resultByGid[p.id]?.ok ? { ...p, publicationCount: 1 } : p))
    );
    const failCount = results.length - succeededGids.size;
    shopify.toast.show(
      `Fixed channels on ${succeededGids.size} product${succeededGids.size === 1 ? "" : "s"}` +
        (failCount ? ` · ${failCount} failed` : "") +
        (channelFetcher.data.skipped ? ` · ${channelFetcher.data.skipped} more selected — click again` : ""),
      { isError: failCount > 0 && succeededGids.size === 0 }
    );
  }, [channelFetcher.data, shopify]);

  useEffect(() => {
    if (removeFetcher.data?.intent !== "removeVariants") return;
    if (!removeFetcher.data.ok) {
      shopify.toast.show(
        removeFetcher.data.error === "Check at least one product first."
          ? removeFetcher.data.error
          : "Couldn't remove variants for those products — try again in a moment",
        { isError: true }
      );
      return;
    }
    const results = removeFetcher.data.results || [];
    const resultByGid = Object.fromEntries(results.map((r) => [r.productGid, r]));
    const succeededGids = new Set(results.filter((r) => r.ok).map((r) => r.productGid));
    // A succeeded removal collapses the product back to a single
    // untracked default variant — reflect that immediately: no longer
    // "set up", no Types, no tracked stock.
    setProducts((prev) =>
      prev.map((p) =>
        resultByGid[p.id]?.ok
          ? { ...p, hasSetup: false, currentTypes: [], tracksInventory: false, totalInventory: 0, hasOutOfStockVariants: false }
          : p
      )
    );
    setSelectedTypes((prev) => {
      const next = { ...prev };
      succeededGids.forEach((gid) => { next[gid] = []; });
      return next;
    });
    const failCount = results.length - succeededGids.size;
    shopify.toast.show(
      `Removed variants on ${succeededGids.size} product${succeededGids.size === 1 ? "" : "s"}` +
        (failCount ? ` · ${failCount} failed (see table)` : "") +
        (removeFetcher.data.skipped ? ` · ${removeFetcher.data.skipped} more selected — click again` : ""),
      { isError: failCount > 0 && succeededGids.size === 0 }
    );
  }, [removeFetcher.data, shopify]);

  useEffect(() => {
    if (inventoryFetcher.data?.intent !== "setInventory") return;
    if (!inventoryFetcher.data.ok) {
      shopify.toast.show(inventoryFetcher.data.error || "Couldn't set inventory — try again in a moment", { isError: true });
      return;
    }
    const results = inventoryFetcher.data.results || [];
    const succeededGids = new Set(results.filter((r) => r.ok).map((r) => r.productGid));
    // Every tracked variant on a succeeded product is now exactly this
    // quantity — reflect that in the Stock column immediately (also
    // flips hasOutOfStockVariants off, since every variant just got the
    // same positive-or-zero number).
    setProducts((prev) =>
      prev.map((p) =>
        succeededGids.has(p.id)
          ? { ...p, totalInventory: inventoryFetcher.data.quantity, hasOutOfStockVariants: inventoryFetcher.data.quantity === 0 }
          : p
      )
    );
    const failCount = results.length - succeededGids.size;
    shopify.toast.show(
      `Set stock to ${inventoryFetcher.data.quantity} on ${succeededGids.size} product${succeededGids.size === 1 ? "" : "s"}` +
        (failCount ? ` · ${failCount} failed (see table)` : "") +
        (inventoryFetcher.data.skipped ? ` · ${inventoryFetcher.data.skipped} more selected — click again` : ""),
      { isError: failCount > 0 && succeededGids.size === 0 }
    );
  }, [inventoryFetcher.data, shopify]);

  const reprice = () => fetcher.submit({}, { method: "POST" });
  const scanSetup = () => scanFetcher.submit({ intent: "scanSetup" }, { method: "POST" });
  const listThemesForInspector = () => themeListFetcher.submit({ intent: "listThemes" }, { method: "POST" });
  const inspectTheme = () => {
    const selected = (themeListFetcher.data?.themes || []).find((t) => t.id === selectedThemeId);
    themeFetcher.submit(
      selected ? { intent: "inspectTheme", themeId: selected.id, themeName: selected.name } : { intent: "inspectTheme" },
      { method: "POST" }
    );
  };

  const toggle = (id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleType = (id, type) => {
    setSelectedTypes((prev) => {
      const current = prev[id] || [];
      const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
      return { ...prev, [id]: next };
    });
  };

  // Every distinct collection name across the scanned list, for the
  // collection dropdown — derived, not stored, so it always reflects
  // whatever's actually in the list right now.
  const allCollections = [...new Set(products.flatMap((p) => p.collections || []))].sort();

  const filteredProducts = products.filter((p) => {
    const q = searchText.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.handle.toLowerCase().includes(q) ||
      (p.collections || []).some((c) => c.toLowerCase().includes(q));
    const matchesCollection = collectionFilter === "all" || (p.collections || []).includes(collectionFilter);
    const matchesStatus =
      statusFilter === "all" || (statusFilter === "missing" ? !p.hasSetup : p.hasSetup);
    const matchesDesign = designFilter === "all" || !p.designCoverage?.complete;
    return matchesSearch && matchesCollection && matchesStatus && matchesDesign;
  });

  const missingCount = products.filter((p) => !p.hasSetup).length;
  const designIncompleteCount = products.filter((p) => p.designCoverage && !p.designCoverage.complete).length;

  const checkAllShown = () => setChecked(new Set(filteredProducts.map((p) => p.id)));
  const clearChecked = () => setChecked(new Set());

  // A row checked but left with zero Types ticked can't be applied
  // (there'd be nothing to build) — skip those from the submission
  // rather than sending an empty Customised option list, and let the
  // merchant know via the toast so it's not a silent no-op.
  const applySetup = () => {
    const items = [...checked]
      .map((id) => ({ productGid: id, types: selectedTypes[id] || [] }))
      .filter((item) => item.types.length > 0);
    const skippedForNoTypes = checked.size - items.length;
    if (!items.length) {
      shopify.toast.show("Each selected product needs at least one Type checked first", { isError: true });
      return;
    }
    if (skippedForNoTypes > 0) {
      shopify.toast.show(
        `${skippedForNoTypes} selected product${skippedForNoTypes === 1 ? " has" : "s have"} no Types checked — skipping ${skippedForNoTypes === 1 ? "it" : "them"} for now`,
        { isError: true }
      );
    }
    setupFetcher.submit({ intent: "setupSelected", items: JSON.stringify(items) }, { method: "POST" });
  };

  const fixChannels = () => {
    channelFetcher.submit({ intent: "fixChannels", productGids: JSON.stringify([...checked]) }, { method: "POST" });
  };

  const removeVariants = () => {
    if (!checked.size) return;
    const ok = window.confirm(
      `Remove the jewelry variant set from ${checked.size} product${checked.size === 1 ? "" : "s"}? ` +
        `This deletes their Type/Metal/Design variants (existing orders are unaffected) and collapses each ` +
        `back to a single default variant at its base price. You can run Apply again later to rebuild it.`
    );
    if (!ok) return;
    removeFetcher.submit({ intent: "removeVariants", productGids: JSON.stringify([...checked]) }, { method: "POST" });
  };

  const setInventoryBulk = () => {
    const quantity = parseInt(bulkQuantity, 10);
    if (!Number.isInteger(quantity) || quantity < 0) {
      shopify.toast.show("Enter a valid stock quantity (0 or more) first", { isError: true });
      return;
    }
    inventoryFetcher.submit(
      { intent: "setInventory", productGids: JSON.stringify([...checked]), quantity: String(quantity) },
      { method: "POST" }
    );
  };

  const resultByGid = Object.fromEntries(
    (setupFetcher.data?.intent === "setupSelected" ? setupFetcher.data.results || [] : []).map((r) => [r.productGid, r])
  );
  const channelResultByGid = Object.fromEntries(
    (channelFetcher.data?.intent === "fixChannels" ? channelFetcher.data.results || [] : []).map((r) => [r.productGid, r])
  );
  const inventoryResultByGid = Object.fromEntries(
    (inventoryFetcher.data?.intent === "setInventory" ? inventoryFetcher.data.results || [] : []).map((r) => [r.productGid, r])
  );
  const removeResultByGid = Object.fromEntries(
    (removeFetcher.data?.intent === "removeVariants" ? removeFetcher.data.results || [] : []).map((r) => [r.productGid, r])
  );

  return (
    <s-page heading="Shubh Gems — Jewelry Pricing" inlineSize="large">
      <s-button
        slot="primary-action"
        onClick={reprice}
        {...(isLoading ? { loading: true } : {})}
      >
        Reprice Design Variants
      </s-button>

      <s-section>
        {/* Collapsed by default — the full explanation is useful once, not
            every time the page loads. A native <details> keeps this a
            dropdown with zero extra JS state. */}
        <details>
          <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 500, color: brand.body }}>
            What this does &amp; how pricing/inventory/channels work
          </summary>
          <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <s-paragraph>
              The "test" gemstone's Ring/Bracelet/Pendant × Metal × Design
              variants each carry a real, baked-in price (stone price +
              setting/design cost). Prices don't update themselves when metal
              rates change in your theme settings — click the button above
              whenever you update a rate, and every affected variant gets
              recomputed and pushed to Shopify in one shot.
            </s-paragraph>
            <s-paragraph>
              Price formula per variant: <s-text>stone's own price</s-text> +
              either the design's explicit catalog price, or{" "}
              <s-text>weight × (metal rate + making charge)</s-text> when no
              explicit price is set for that design.
            </s-paragraph>
            <s-paragraph>
              Which designs (and which Types) a product gets depends on its assigned template —{" "}
              <s-text>product.pearl.json</s-text> gets the pearl design catalog, which only has Ring and Pendent (no
              Bracelet at all — pearls just don't come as bracelets), and only Silver/Gold metals (no Panchdhatu or
              Copper — pearls don't come in those either). Every other product uses the default catalog with all three
              Types and all 8 metals.
            </s-paragraph>
            <s-paragraph>
              Every variant is set to track inventory and stop selling at 0 — a new design starts with{" "}
              <s-text>1 in stock</s-text>, so the moment one order comes in for that exact Type/Metal/Design, it shows
              "Sold out" on the storefront and in Admin automatically. If you actually have more than one of a specific
              piece, bump that variant's quantity by hand in Admin — Reprice/Apply never resets a variant's stock once
              it's already being tracked, only sets the starting "1" the first time. Every variant is also published to
              the Online Store channel only — explicitly unpublished from Google, Meta/Facebook, and any other sales
              channel, so nothing shows up there. Use "Fix channels for N selected" below to clean that up on its own,
              without needing to rebuild a product's whole variant matrix just to trigger it.
            </s-paragraph>
            <s-paragraph>
              <s-text>Numeric ID of the "test" product: {productId}</s-text>
            </s-paragraph>
          </div>
        </details>
      </s-section>

      <s-section heading="Inspect storefront customizer">
        <s-paragraph>
          Reads a theme's actual files and finds any whose path mentions "jewel", "custom", or "design" — use this to
          check what's really driving (or not driving) the customization UI on a product page, instead of guessing
          from screenshots. Defaults to your live theme; use "List themes" to pick a different one (e.g. an older
          backup theme) to compare against.
        </s-paragraph>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <s-button {...(isListingThemes ? { loading: true } : {})} onClick={listThemesForInspector}>
            List themes
          </s-button>
          {themeListFetcher.data?.intent === "listThemes" && themeListFetcher.data.ok && (
            <select
              value={selectedThemeId}
              onChange={(e) => setSelectedThemeId(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "10px", border: `1px solid ${brand.border}`, fontSize: "12.5px", color: brand.body, background: "#fff" }}
            >
              <option value="">Live theme (default)</option>
              {themeListFetcher.data.themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.role === "MAIN" ? "(live)" : `(${t.role.toLowerCase()})`}
                </option>
              ))}
            </select>
          )}
          <s-button {...(isInspectingTheme ? { loading: true } : {})} onClick={inspectTheme}>
            Inspect {selectedThemeId ? "selected theme" : "storefront customizer"}
          </s-button>
        </div>
        {themeListFetcher.data?.intent === "listThemes" && !themeListFetcher.data.ok && (
          <div style={{ marginTop: "12px" }}>
            <FriendlyError message="Couldn't list themes." detail={themeListFetcher.data.error} />
          </div>
        )}
        {themeFetcher.data?.intent === "inspectTheme" && !themeFetcher.data.ok && (
          <div style={{ marginTop: "12px" }}>
            <FriendlyError message="Couldn't inspect the live theme's files." detail={themeFetcher.data.error} />
          </div>
        )}
        {themeFetcher.data?.intent === "inspectTheme" && themeFetcher.data.ok && (
          <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <p style={{ fontSize: "12.5px", color: brand.muted, margin: 0 }}>
              Live theme: <s-text fontWeight="bold">{themeFetcher.data.theme?.name}</s-text> ·{" "}
              {themeFetcher.data.totalFilesScanned} files scanned · {themeFetcher.data.candidateCount} matched
            </p>
            {themeFetcher.data.candidates?.length > 0 && (
              <p style={{ fontSize: "12px", color: brand.body, margin: 0 }}>
                Matching files: {themeFetcher.data.candidates.join(", ")}
              </p>
            )}
            {themeFetcher.data.candidateCount === 0 && (
              <FriendlyErrorInline message="No theme file matched 'jewel'/'custom'/'design' at all — the dynamic customizer may not be part of this theme." />
            )}
            {(themeFetcher.data.contents || []).map((f) => (
              <div key={f.filename} style={{ border: `1px solid ${brand.border}`, borderRadius: "10px", padding: "10px" }}>
                <p style={{ fontSize: "12.5px", fontWeight: 600, color: brand.body, margin: "0 0 6px" }}>
                  {f.filename} ({f.length.toLocaleString()} chars{f.length > 3000 ? ", showing first 3,000" : ""})
                </p>
                {f.excerpt ? (
                  <pre style={{ fontSize: "11px", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "260px", overflow: "auto", background: brand.panel, padding: "8px", borderRadius: "6px", margin: 0 }}>
                    {f.excerpt}
                  </pre>
                ) : (
                  <span style={{ fontSize: "12px", color: brand.muted }}>Could not read this file's content.</span>
                )}
              </div>
            ))}
          </div>
        )}
      </s-section>

      {fetcher.data?.ok && (
        <s-section heading="Last run">
          <s-paragraph>
            Stone price used: ₹{fetcher.data.stonePrice} · Design set: {fetcher.data.designSet} · Metals:{" "}
            {fetcher.data.metals?.join(", ")} · Variants updated: {fetcher.data.variantCount} · Design values:{" "}
            {fetcher.data.designValueCount}
          </s-paragraph>
          {fetcher.data.publishDiagnostic && !fetcher.data.publishDiagnostic.foundOnlineStore && (
            <FriendlyErrorInline
              message="Couldn't confirm the Online Store channel — variants may not be published correctly"
              detail={JSON.stringify(fetcher.data.publishDiagnostic)}
            />
          )}
        </s-section>
      )}
      {fetcher.data && !fetcher.data.ok && (
        <s-section heading="Last run failed">
          <FriendlyError
            message="Couldn't reprice the test product's variants. Nothing was changed — your existing prices are untouched."
            detail={fetcher.data.error}
          />
        </s-section>
      )}

      <s-section heading="Set up or change jewelry variants">
        <s-paragraph>
          Scans every product in the store and shows its Type(Customised)/Metal setup, sales channel status, stock,
          and whether the global design catalog actually has designs to show for it (the "Design set" column — this
          is what the storefront's dynamic customizer falls back to for any product that doesn't have native
          variants, so a red "missing" pill here means that product's shopper could see an empty design picker).
          Check products, pick Types (for new or already-set-up products alike), then Apply — or just fix sales
          channels or stock in bulk without touching variants at all.{" "}
          <s-text fontWeight="bold">Unticking a Type that's already live deletes those variants</s-text> (existing
          orders are unaffected, but it stops being sellable until re-added).
        </s-paragraph>
        <s-button {...(isScanning ? { loading: true } : {})} onClick={scanSetup}>
          Scan Products
        </s-button>

        {setupFetcher.data?.intent === "setupSelected" && !setupFetcher.data.ok && (
          <div style={{ marginTop: "12px" }}>
            <FriendlyError
              message={
                setupFetcher.data.error === "Check at least one product first."
                  ? setupFetcher.data.error
                  : "Couldn't apply those changes. Nothing was changed — existing variants/prices are untouched."
              }
              detail={setupFetcher.data.error}
            />
          </div>
        )}
        {channelFetcher.data?.intent === "fixChannels" && !channelFetcher.data.ok && (
          <div style={{ marginTop: "12px" }}>
            <FriendlyError
              message={
                channelFetcher.data.error === "Check at least one product first."
                  ? channelFetcher.data.error
                  : "Couldn't fix channels for those products."
              }
              detail={channelFetcher.data.error}
            />
          </div>
        )}
        {inventoryFetcher.data?.intent === "setInventory" && !inventoryFetcher.data.ok && (
          <div style={{ marginTop: "12px" }}>
            <FriendlyError
              message={
                inventoryFetcher.data.error?.startsWith("Check at least") || inventoryFetcher.data.error?.startsWith("Enter a valid")
                  ? inventoryFetcher.data.error
                  : "Couldn't set inventory for those products."
              }
              detail={inventoryFetcher.data.error}
            />
          </div>
        )}
        {removeFetcher.data?.intent === "removeVariants" && !removeFetcher.data.ok && (
          <div style={{ marginTop: "12px" }}>
            <FriendlyError
              message={
                removeFetcher.data.error === "Check at least one product first."
                  ? removeFetcher.data.error
                  : "Couldn't remove variants for those products."
              }
              detail={removeFetcher.data.error}
            />
          </div>
        )}

        {scanFetcher.data?.intent === "scanSetup" && scanFetcher.data.ok && (
          <div style={{ marginTop: "12px" }}>
            <p style={{ fontSize: "12.5px", color: brand.muted, margin: "0 0 10px" }}>
              Scanned {scanFetcher.data.scanned} product{scanFetcher.data.scanned === 1 ? "" : "s"} ·{" "}
              {missingCount} not set up yet · {designIncompleteCount} missing global designs for some Type/Metal
              {scanFetcher.data.truncated ? " · stopped early (catalog larger than the scan's safety cap — rerun to continue)" : ""}
            </p>
            {products.length === 0 ? (
              <s-paragraph>No products found.</s-paragraph>
            ) : (
              <>
                {/* Sticky so the filters + action buttons stay reachable
                    while scrolling a long product list — position:sticky
                    against the page's own scroll container, with an opaque
                    background so table rows don't show through underneath. */}
                <div style={{ position: "sticky", top: 0, zIndex: 5, background: "#fff", paddingTop: "4px", paddingBottom: "10px", marginBottom: "2px" }}>
                  <div style={{ display: "flex", gap: "10px", margin: "0 0 10px", alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="Search title, handle, or collection…"
                      style={{ padding: "8px 12px", borderRadius: "10px", border: `1px solid ${brand.border}`, fontSize: "12.5px", minWidth: "220px", color: brand.body }}
                    />
                    <select
                      value={collectionFilter}
                      onChange={(e) => setCollectionFilter(e.target.value)}
                      style={{ padding: "8px 12px", borderRadius: "10px", border: `1px solid ${brand.border}`, fontSize: "12.5px", color: brand.body, background: "#fff" }}
                    >
                      <option value="all">All collections</option>
                      {allCollections.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      style={{ padding: "8px 12px", borderRadius: "10px", border: `1px solid ${brand.border}`, fontSize: "12.5px", color: brand.body, background: "#fff" }}
                    >
                      <option value="all">Any status</option>
                      <option value="missing">Not set up yet</option>
                      <option value="setup">Already set up</option>
                    </select>
                    <select
                      value={designFilter}
                      onChange={(e) => setDesignFilter(e.target.value)}
                      style={{ padding: "8px 12px", borderRadius: "10px", border: `1px solid ${brand.border}`, fontSize: "12.5px", color: brand.body, background: "#fff" }}
                    >
                      <option value="all">Any design coverage</option>
                      <option value="incomplete">Missing global designs</option>
                    </select>
                    {(searchText || collectionFilter !== "all" || statusFilter !== "all" || designFilter !== "all") && (
                      <button
                        type="button"
                        onClick={() => { setSearchText(""); setCollectionFilter("all"); setStatusFilter("all"); setDesignFilter("all"); }}
                        style={{ fontSize: "12px", padding: "8px 14px", borderRadius: "10px", border: `1px solid ${brand.border}`, background: brand.panel, color: brand.body, cursor: "pointer" }}
                      >
                        Clear filters
                      </button>
                    )}
                    <span style={{ fontSize: "12px", color: brand.muted }}>
                      Showing {filteredProducts.length} of {products.length}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", paddingBottom: "10px", borderBottom: `1px solid ${brand.border}` }}>
                    <button
                      type="button"
                      onClick={checkAllShown}
                      style={{ fontSize: "12px", padding: "8px 14px", borderRadius: "10px", border: `1px solid ${brand.border}`, background: brand.panel, color: brand.body, cursor: "pointer" }}
                    >
                      Check all shown ({filteredProducts.length})
                    </button>
                    <button
                      type="button"
                      onClick={clearChecked}
                      style={{ fontSize: "12px", padding: "8px 14px", borderRadius: "10px", border: `1px solid ${brand.border}`, background: brand.panel, color: brand.body, cursor: "pointer" }}
                    >
                      Clear selection
                    </button>
                    <s-button {...(isSettingUp ? { loading: true } : {})} onClick={applySetup}>
                      Apply to {checked.size} selected
                    </s-button>
                    <s-button {...(isFixingChannels ? { loading: true } : {})} onClick={fixChannels}>
                      Fix channels for {checked.size} selected
                    </s-button>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "3px", background: brand.panel, borderRadius: "10px" }}>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={bulkQuantity}
                        onChange={(e) => setBulkQuantity(e.target.value)}
                        style={{ width: "60px", padding: "5px 8px", borderRadius: "8px", border: `1px solid ${brand.border}`, fontSize: "12.5px", color: brand.body }}
                      />
                      <s-button {...(isSettingInventory ? { loading: true } : {})} onClick={setInventoryBulk}>
                        Set stock for {checked.size} selected
                      </s-button>
                    </div>
                    <s-button tone="critical" {...(isRemoving ? { loading: true } : {})} onClick={removeVariants}>
                      Remove variants for {checked.size} selected
                    </s-button>
                    <span style={{ fontSize: "12px", color: brand.muted }}>
                      Apply processes up to {setupBatchSize} per click (click again for the rest); Fix channels/Set
                      stock/Remove variants process up to {bulkBatchSize} per click. Setting stock only works on
                      products already Applied (needs tracked variants).
                    </span>
                  </div>
                </div>
                <TableGlobalStyles />
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}></th>
                        <th style={thStyle}>Title</th>
                        <th style={thStyle}>Setup status</th>
                        <th style={thStyle}>Channels</th>
                        <th style={thStyle}>Stock</th>
                        <th style={thStyle}>Handle</th>
                        <th style={thStyle}>Collections</th>
                        <th style={thStyle}>Design set</th>
                        <th style={thStyle}>Types</th>
                        <th style={thStyle}>Last result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((p) => {
                        const result = resultByGid[p.id];
                        const channelResult = channelResultByGid[p.id];
                        const inventoryResult = inventoryResultByGid[p.id];
                        const types = selectedTypes[p.id] || [];
                        const currentTypes = p.currentTypes || [];
                        const changed =
                          p.hasSetup &&
                          (types.length !== currentTypes.length || types.some((t) => !currentTypes.includes(t)));
                        return (
                          <tr key={p.id} className="dt-row">
                            <td style={tdStyle}>
                              <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />
                            </td>
                            <td style={tdStyle}>
                              <a
                                href={`https://admin.shopify.com/store/${shopDomain}/products/${p.numericId}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: brand.accent, fontWeight: 500 }}
                              >
                                {p.title}
                              </a>
                            </td>
                            <td style={tdStyle}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                <Pill
                                  label={p.hasSetup ? `Set up (${currentTypes.join("/") || "—"})` : "Not set up"}
                                  active
                                  color={p.hasSetup ? brand.success : brand.muted}
                                />
                                {removeResultByGid[p.id] && (
                                  removeResultByGid[p.id].ok ? (
                                    <span style={{ fontSize: "11px", color: brand.success }}>✓ removed</span>
                                  ) : (
                                    <FriendlyErrorInline message="Couldn't remove" detail={removeResultByGid[p.id].error} />
                                  )
                                )}
                              </div>
                            </td>
                            <td style={tdStyle}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                {p.publicationCount === null ? (
                                  <span style={{ fontSize: "12px", color: brand.muted }}>—</span>
                                ) : (
                                  <Pill
                                    label={
                                      p.publicationCount === 0
                                        ? "Not published anywhere"
                                        : p.publicationCount === 1
                                          ? "1 channel"
                                          : `${p.publicationCount} channels`
                                    }
                                    active
                                    color={p.publicationCount === 1 ? brand.success : p.publicationCount === 0 ? brand.danger : "#B45309"}
                                  />
                                )}
                                {channelResult && (
                                  channelResult.ok ? (
                                    <span style={{ fontSize: "11px", color: brand.success }}>✓ fixed</span>
                                  ) : (
                                    <FriendlyErrorInline message="Couldn't fix" detail={channelResult.error} />
                                  )
                                )}
                              </div>
                            </td>
                            <td style={tdStyle}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                {!p.tracksInventory ? (
                                  <span style={{ fontSize: "12px", color: brand.muted }}>Not tracked</span>
                                ) : (
                                  <>
                                    <span style={{ fontSize: "12.5px", color: brand.body, fontWeight: 500 }}>
                                      {p.totalInventory} in stock
                                    </span>
                                    {p.hasOutOfStockVariants && (
                                      <span style={{ fontSize: "11px", color: brand.danger }}>some designs sold out</span>
                                    )}
                                  </>
                                )}
                                {inventoryResult && (
                                  inventoryResult.ok ? (
                                    <span style={{ fontSize: "11px", color: brand.success }}>✓ set</span>
                                  ) : (
                                    <FriendlyErrorInline message="Couldn't set" detail={inventoryResult.error} />
                                  )
                                )}
                              </div>
                            </td>
                            <td style={tdStyle}>{p.handle}</td>
                            <td style={{ ...tdStyle, fontSize: "12px", color: brand.muted }}>
                              {(p.collections || []).join(", ") || "—"}
                            </td>
                            <td style={tdStyle}>
                              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                <span style={{ fontSize: "12px", color: brand.muted }}>{p.designSet || "—"}</span>
                                {p.designCoverage && (
                                  p.designCoverage.complete ? (
                                    <Pill label="✓ designs ready" active color={brand.success} />
                                  ) : (
                                    <span title={`Global catalog has no designs for: ${p.designCoverage.missing.join(", ")}`}>
                                      <Pill
                                        label={`⚠ missing ${p.designCoverage.missing.length}`}
                                        active
                                        color={brand.danger}
                                      />
                                    </span>
                                  )
                                )}
                              </div>
                            </td>
                            <td style={tdStyle}>
                              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                                {(p.availableTypes || []).map((t) => (
                                  <label
                                    key={t}
                                    style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: brand.body, whiteSpace: "nowrap" }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={types.includes(t)}
                                      onChange={() => toggleType(p.id, t)}
                                    />
                                    {t}
                                  </label>
                                ))}
                                {changed && (
                                  <span style={{ fontSize: "11px", color: "#B45309", fontWeight: 500 }}>changed</span>
                                )}
                              </div>
                            </td>
                            <td style={tdStyle}>
                              {result ? (
                                result.ok ? (
                                  <Pill
                                    label={`✓ ${result.variantCount} variants — ${(result.types || []).join("/")} · ${result.metals?.length || 0} metals (${result.designSet})`}
                                    active
                                    color={brand.success}
                                  />
                                ) : (
                                  <FriendlyErrorInline message="Couldn't apply this one" detail={result.error} />
                                )
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
