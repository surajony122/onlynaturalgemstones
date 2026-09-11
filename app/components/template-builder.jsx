/**
 * A drag-and-drop, block-based visual editor for the GST invoice's two
 * templates (the PDF and its email), per explicit request in place of
 * hand-typing raw HTML. Genuinely new, self-contained editor -- no new
 * npm dependency (drag/drop is plain HTML5 draggable/dragover/drop, not
 * a library), to keep this app's Render footprint the same as before.
 *
 * Architecture, and WHY it needs no changes anywhere else in this app:
 * this component's only real job is compileBlocksToHtml(blocks) --
 * turning a block array into an HTML STRING that still contains literal
 * {{token}} placeholders (e.g. "{{invoice_number}}"), exactly the same
 * shape as a hand-typed custom template already is. The caller (Settings
 * page) saves that compiled string into the SAME AppSettings field
 * (invoicePdfTemplate / invoiceEmailTemplate) a raw-HTML edit would have
 * saved it into -- the real send path (orderInvoice.server.js) never
 * knows or cares whether a template came from typing or from this
 * builder. The block array itself is saved separately (a new JSON
 * field) purely so re-opening the builder next time can restore the
 * same blocks -- HTML can't be reliably reverse-parsed back into blocks,
 * so a raw-HTML edit made outside the builder won't be reflected back
 * into it (documented in the UI).
 *
 * Block shape: { id, type, ...type-specific fields }. Every block type's
 * compile() function returns an HTML fragment string; unknown/blank
 * fields fall back to sane defaults so a freshly-added block always
 * renders something instead of nothing.
 */
import { useRef, useState } from "react";
import { brand, Icon } from "./table-kit";

// ---- Block model -------------------------------------------------

let idCounter = 0;
function newId() {
  idCounter += 1;
  return `blk_${Date.now().toString(36)}_${idCounter}`;
}

export const BLOCK_TYPES = [
  { type: "heading", label: "Heading" },
  { type: "text", label: "Text" },
  { type: "image", label: "Image" },
  { type: "table", label: "Table" },
  { type: "itemsTable", label: "Items Table (auto)", pdfOnly: true },
  { type: "button", label: "Button", emailOnly: true },
  { type: "divider", label: "Divider" },
  { type: "spacer", label: "Spacer" },
];

const DEFAULT_ITEM_HEADERS = ["ITEM(s) DESCRIPTION", "HSN", "Qty", "RATE (₹)", "CGST", "SGST", "IGST", "AMOUNT (₹)"];

export function defaultBlockFor(type) {
  const id = newId();
  switch (type) {
    case "heading":
      return { id, type, text: "Heading", align: "center", fontSize: 20, color: "#d97b3f", bold: true };
    case "text":
      return { id, type, html: "Some text — use “+ Insert field” to add a dynamic value.", align: "left", fontSize: 12, color: "#222" };
    case "image":
      return { id, type, src: "__SHOP_LOGO__", width: 160, align: "center" };
    case "table":
      return { id, type, rows: [["Column A", "Column B"], ["", ""]], bordered: true, headerRow: true, borderColor: "#333" };
    case "itemsTable":
      return { id, type, headers: [...DEFAULT_ITEM_HEADERS], headerBg: "#f3efe6", borderColor: "#999" };
    case "button":
      return { id, type, text: "View Your Order", url: "{{order_status_url}}", bg: "#8c7a4e", color: "#ffffff", align: "center" };
    case "divider":
      return { id, type, color: "#333333", thickness: 1, marginY: 10 };
    case "spacer":
      return { id, type, height: 16 };
    default:
      return { id, type: "text", html: "", align: "left", fontSize: 12, color: "#222" };
  }
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- Compiler: blocks -> HTML string (still carrying {{token}}s) ---

function compileBlock(b) {
  switch (b.type) {
    case "heading":
      return `<div style="text-align:${b.align || "center"};font-size:${b.fontSize || 20}px;font-weight:${b.bold === false ? "normal" : "bold"};color:${b.color || "#222"};margin:6px 0;">${b.text || ""}</div>`;
    case "text":
      return `<div style="text-align:${b.align || "left"};font-size:${b.fontSize || 12}px;color:${b.color || "#222"};line-height:1.6;margin:6px 0;">${b.html || ""}</div>`;
    case "image": {
      if (b.src === "__SHOP_LOGO__") return `<div style="text-align:${b.align || "center"};margin:6px 0;">{{brand_header_html}}</div>`;
      if (b.src === "__SEAL__") return `<div style="text-align:${b.align || "center"};margin:6px 0;">{{seal_html}}</div>`;
      return `<div style="text-align:${b.align || "center"};margin:6px 0;"><img src="${esc(b.src || "")}" style="max-width:${b.width || 160}px;"></div>`;
    }
    case "table": {
      const rows = b.rows && b.rows.length ? b.rows : [[""]];
      const colCount = Math.max(...rows.map((r) => r.length));
      const cellBorder = b.bordered ? `border:1px solid ${b.borderColor || "#333"};` : "";
      const rowsHtml = rows
        .map(
          (row, ri) =>
            `<tr>${row
              .map(
                (cell) =>
                  `<td style="padding:6px 8px;vertical-align:top;font-size:10px;${cellBorder}width:${(100 / colCount).toFixed(2)}%;${ri === 0 && b.headerRow ? "font-weight:bold;" : ""}">${cell || ""}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");
      return `<table style="width:100%;border-collapse:collapse;margin:6px 0;${b.bordered ? `border:1px solid ${b.borderColor || "#333"};` : ""}">${rowsHtml}</table>`;
    }
    case "itemsTable": {
      const headers = b.headers && b.headers.length ? b.headers : DEFAULT_ITEM_HEADERS;
      const headerCells = headers
        .map((h) => `<th style="background:${b.headerBg || "#f3efe6"};border:1px solid ${b.borderColor || "#999"};padding:6px 8px;font-size:9.5px;text-align:left;">${esc(h)}</th>`)
        .join("");
      return `<table style="width:100%;border-collapse:collapse;margin:6px 0;"><tr>${headerCells}</tr>{{line_items_rows}}</table>`;
    }
    case "button":
      return `<div style="text-align:${b.align || "center"};margin:10px 0;"><a href="${esc(b.url || "#")}" style="display:inline-block;background:${b.bg || "#8c7a4e"};color:${b.color || "#fff"} !important;text-decoration:none;padding:10px 20px;border-radius:4px;font-size:14px;">${esc(b.text || "Button")}</a></div>`;
    case "divider":
      return `<div style="border-top:${b.thickness || 1}px solid ${b.color || "#333"};margin:${b.marginY ?? 10}px 0;"></div>`;
    case "spacer":
      return `<div style="height:${b.height || 16}px;"></div>`;
    default:
      return "";
  }
}

export function compileBlocksToHtml(blocks, { title = "Document" } = {}) {
  const body = (blocks || []).map(compileBlock).join("\n");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>body { font-family: Helvetica, Arial, sans-serif; }</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ---- UI ------------------------------------------------------------

const panelInput = { width: "100%", padding: "7px 9px", borderRadius: "7px", border: `1px solid ${brand.border}`, fontSize: "12.5px", boxSizing: "border-box", marginBottom: "8px" };
const panelLabel = { display: "block", fontSize: "11px", fontWeight: 600, color: brand.muted, marginBottom: "4px", marginTop: "10px", textTransform: "uppercase", letterSpacing: "0.03em" };
const smallBtn = { padding: "5px 10px", borderRadius: "6px", border: `1px solid ${brand.border}`, background: "#fff", color: brand.body, fontSize: "11.5px", cursor: "pointer" };

// A tiny "+ field" dropdown that appends {{token}} to a given value via
// its own onChange-shaped setter -- avoids tracking cursor position /
// focus across an arbitrary set of property-panel inputs, at the cost
// of always inserting at the end rather than at the cursor.
function TokenPicker({ tokens, onInsert }) {
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value) onInsert(e.target.value);
        e.target.value = "";
      }}
      style={{ ...panelInput, marginBottom: "6px", color: brand.muted, fontSize: "11.5px" }}
    >
      <option value="">+ Insert field…</option>
      {tokens.map((t) => (
        <option key={t.token} value={`{{${t.token}}}`}>
          {`{{${t.token}}}`} — {t.description}
        </option>
      ))}
    </select>
  );
}

function TableEditor({ block, onChange, tokens }) {
  const rows = block.rows || [[""]];
  const updateCell = (ri, ci, value) => {
    const next = rows.map((r) => r.slice());
    next[ri][ci] = value;
    onChange({ ...block, rows: next });
  };
  const addRow = () => onChange({ ...block, rows: [...rows, rows[0].map(() => "")] });
  const removeRow = (ri) => onChange({ ...block, rows: rows.filter((_, i) => i !== ri) });
  const addCol = () => onChange({ ...block, rows: rows.map((r) => [...r, ""]) });
  const removeCol = (ci) => onChange({ ...block, rows: rows.map((r) => r.filter((_, i) => i !== ci)) });

  return (
    <div>
      <label style={panelLabel}>
        <input type="checkbox" checked={!!block.bordered} onChange={(e) => onChange({ ...block, bordered: e.target.checked })} style={{ marginRight: "6px" }} />
        Show borders
      </label>
      <label style={panelLabel}>
        <input type="checkbox" checked={!!block.headerRow} onChange={(e) => onChange({ ...block, headerRow: e.target.checked })} style={{ marginRight: "6px" }} />
        Bold first row (header)
      </label>
      <label style={panelLabel}>Cells</label>
      <div style={{ border: `1px solid ${brand.border}`, borderRadius: "8px", overflow: "hidden", marginBottom: "8px" }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex", borderTop: ri === 0 ? "none" : `1px solid ${brand.divider}` }}>
            {row.map((cell, ci) => (
              <textarea
                key={ci}
                value={cell}
                onChange={(e) => updateCell(ri, ci, e.target.value)}
                rows={2}
                style={{ flex: 1, border: "none", borderRight: ci === row.length - 1 ? "none" : `1px solid ${brand.divider}`, padding: "6px 7px", fontSize: "11px", resize: "vertical", fontFamily: "inherit" }}
              />
            ))}
            <button type="button" onClick={() => removeRow(ri)} title="Remove row" style={{ ...smallBtn, border: "none", color: brand.danger, display: "inline-flex", alignItems: "center" }}><Icon name="x" size={13} color="currentColor" /></button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
        <button type="button" onClick={addRow} style={smallBtn}>+ Row</button>
        <button type="button" onClick={addCol} style={smallBtn}>+ Column</button>
        {rows[0].length > 1 && (
          <button type="button" onClick={() => removeCol(rows[0].length - 1)} style={smallBtn}>− Column</button>
        )}
      </div>
      <p style={{ fontSize: "11px", color: brand.muted, marginTop: 0 }}>
        Click into a cell, then use the field picker below to insert a value like a customer's name into that cell.
      </p>
      <TokenPicker tokens={tokens} onInsert={(t) => updateCell(rows.length - 1, 0, (rows[rows.length - 1][0] || "") + t)} />
    </div>
  );
}

function PropertiesPanel({ block, onChange, tokens, isPdf }) {
  if (!block) {
    return <p style={{ fontSize: "12.5px", color: brand.muted }}>Select a block on the left to edit it, or add a new one below.</p>;
  }
  const set = (patch) => onChange({ ...block, ...patch });

  switch (block.type) {
    case "heading":
    case "text": {
      const field = block.type === "heading" ? "text" : "html";
      return (
        <div>
          <label style={panelLabel}>Content</label>
          <textarea value={block[field] || ""} onChange={(e) => set({ [field]: e.target.value })} rows={3} style={{ ...panelInput, fontFamily: "inherit" }} />
          <TokenPicker tokens={tokens} onInsert={(t) => set({ [field]: (block[field] || "") + t })} />
          <label style={panelLabel}>Align</label>
          <select value={block.align || "left"} onChange={(e) => set({ align: e.target.value })} style={panelInput}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          <label style={panelLabel}>Font size (px)</label>
          <input type="number" value={block.fontSize || 12} onChange={(e) => set({ fontSize: parseInt(e.target.value, 10) || 12 })} style={panelInput} />
          <label style={panelLabel}>Color</label>
          <input type="color" value={block.color || "#222222"} onChange={(e) => set({ color: e.target.value })} style={{ ...panelInput, height: "34px", padding: "3px" }} />
        </div>
      );
    }
    case "image":
      return (
        <div>
          <label style={panelLabel}>Source</label>
          <select value={["__SHOP_LOGO__", "__SEAL__"].includes(block.src) ? block.src : "custom"} onChange={(e) => set({ src: e.target.value === "custom" ? "" : e.target.value })} style={panelInput}>
            <option value="__SHOP_LOGO__">My shop's logo (automatic)</option>
            {isPdf && <option value="__SEAL__">My signature/seal image (Settings)</option>}
            <option value="custom">Custom image URL…</option>
          </select>
          {!["__SHOP_LOGO__", "__SEAL__"].includes(block.src) && (
            <>
              <label style={panelLabel}>Image URL</label>
              <input type="text" value={block.src || ""} onChange={(e) => set({ src: e.target.value })} placeholder="https://…" style={panelInput} />
            </>
          )}
          <label style={panelLabel}>Max width (px)</label>
          <input type="number" value={block.width || 160} onChange={(e) => set({ width: parseInt(e.target.value, 10) || 160 })} style={panelInput} />
          <label style={panelLabel}>Align</label>
          <select value={block.align || "center"} onChange={(e) => set({ align: e.target.value })} style={panelInput}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      );
    case "table":
      return <TableEditor block={block} onChange={onChange} tokens={tokens} />;
    case "itemsTable":
      return (
        <div>
          <p style={{ fontSize: "11.5px", color: brand.muted, marginTop: 0 }}>
            The item rows themselves (with HSN/Qty/CGST/SGST/IGST) are always filled in automatically per order — only
            the column headers are editable here.
          </p>
          <label style={panelLabel}>Column headers</label>
          {(block.headers || DEFAULT_ITEM_HEADERS).map((h, i) => (
            <input
              key={i}
              type="text"
              value={h}
              onChange={(e) => {
                const next = (block.headers || DEFAULT_ITEM_HEADERS).slice();
                next[i] = e.target.value;
                set({ headers: next });
              }}
              style={{ ...panelInput, marginBottom: "4px" }}
            />
          ))}
          <label style={panelLabel}>Header background</label>
          <input type="color" value={block.headerBg || "#f3efe6"} onChange={(e) => set({ headerBg: e.target.value })} style={{ ...panelInput, height: "34px", padding: "3px" }} />
        </div>
      );
    case "button":
      return (
        <div>
          <label style={panelLabel}>Button text</label>
          <input type="text" value={block.text || ""} onChange={(e) => set({ text: e.target.value })} style={panelInput} />
          <label style={panelLabel}>Link URL</label>
          <input type="text" value={block.url || ""} onChange={(e) => set({ url: e.target.value })} style={panelInput} />
          <TokenPicker tokens={tokens} onInsert={(t) => set({ url: (block.url || "") + t })} />
          <label style={panelLabel}>Background color</label>
          <input type="color" value={block.bg || "#8c7a4e"} onChange={(e) => set({ bg: e.target.value })} style={{ ...panelInput, height: "34px", padding: "3px" }} />
          <label style={panelLabel}>Align</label>
          <select value={block.align || "center"} onChange={(e) => set({ align: e.target.value })} style={panelInput}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
      );
    case "divider":
      return (
        <div>
          <label style={panelLabel}>Color</label>
          <input type="color" value={block.color || "#333333"} onChange={(e) => set({ color: e.target.value })} style={{ ...panelInput, height: "34px", padding: "3px" }} />
          <label style={panelLabel}>Thickness (px)</label>
          <input type="number" value={block.thickness || 1} onChange={(e) => set({ thickness: parseInt(e.target.value, 10) || 1 })} style={panelInput} />
        </div>
      );
    case "spacer":
      return (
        <div>
          <label style={panelLabel}>Height (px)</label>
          <input type="number" value={block.height || 16} onChange={(e) => set({ height: parseInt(e.target.value, 10) || 16 })} style={panelInput} />
        </div>
      );
    default:
      return null;
  }
}

function blockSummary(block) {
  switch (block.type) {
    case "heading":
      return block.text || "(empty heading)";
    case "text":
      return (block.html || "(empty text)").replace(/<[^>]+>/g, "").slice(0, 40);
    case "image":
      return block.src === "__SHOP_LOGO__" ? "Shop logo" : block.src === "__SEAL__" ? "Seal image" : block.src || "(no image set)";
    case "table":
      return `Table (${(block.rows || []).length} rows)`;
    case "itemsTable":
      return "Items table (auto)";
    case "button":
      return `Button: ${block.text || ""}`;
    case "divider":
      return "Divider";
    case "spacer":
      return `Spacer (${block.height || 16}px)`;
    default:
      return block.type;
  }
}

/**
 * @param {object[]} blocks
 * @param {(blocks: object[]) => void} onChange
 * @param {{token:string, description:string}[]} tokens - the template's
 *   own available-placeholders list (ORDER_INVOICE_PLACEHOLDERS or
 *   ORDER_INVOICE_EMAIL_PLACEHOLDERS), passed in rather than imported,
 *   since this file must stay import-safe from a plain client bundle.
 * @param {boolean} isPdf - hides/shows pdf-only or email-only block
 *   types (see BLOCK_TYPES' pdfOnly/emailOnly flags) and the seal-image
 *   option on Image blocks.
 */
export function TemplateBuilder({ blocks, onChange, tokens, isPdf }) {
  const [selectedId, setSelectedId] = useState(blocks[0]?.id || null);
  const dragIndex = useRef(null);

  const selected = blocks.find((b) => b.id === selectedId) || null;

  const updateBlock = (updated) => {
    onChange(blocks.map((b) => (b.id === updated.id ? updated : b)));
  };
  const addBlock = (type) => {
    const b = defaultBlockFor(type);
    const insertAt = selectedId ? blocks.findIndex((x) => x.id === selectedId) + 1 : blocks.length;
    const next = blocks.slice();
    next.splice(insertAt, 0, b);
    onChange(next);
    setSelectedId(b.id);
  };
  const removeBlock = (id) => {
    onChange(blocks.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const moveBlock = (from, to) => {
    if (from === to || to < 0 || to >= blocks.length) return;
    const next = blocks.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const visibleTypes = BLOCK_TYPES.filter((t) => (isPdf ? !t.emailOnly : !t.pdfOnly));

  return (
    <div style={{ display: "flex", gap: "14px", border: `1px solid ${brand.border}`, borderRadius: "12px", overflow: "hidden" }}>
      {/* Canvas */}
      <div style={{ flex: "1 1 55%", padding: "14px", background: brand.panel, minHeight: "360px" }}>
        {blocks.length === 0 && (
          <p style={{ fontSize: "12.5px", color: brand.muted, textAlign: "center", marginTop: "40px" }}>
            No blocks yet — add one below to start building this template.
          </p>
        )}
        {blocks.map((b, i) => (
          <div
            key={b.id}
            draggable
            onDragStart={() => {
              dragIndex.current = i;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex.current != null) moveBlock(dragIndex.current, i);
              dragIndex.current = null;
            }}
            onClick={() => setSelectedId(b.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "9px 12px",
              marginBottom: "6px",
              borderRadius: "9px",
              border: `1px solid ${selectedId === b.id ? brand.accent : brand.border}`,
              background: "#fff",
              cursor: "grab",
              boxShadow: selectedId === b.id ? `0 0 0 2px ${brand.accentTint}` : "none",
            }}
          >
            <span style={{ color: brand.faint, fontSize: "14px", lineHeight: 1 }}>⠿</span>
            <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: brand.accent, letterSpacing: "0.03em", minWidth: "72px" }}>
              {BLOCK_TYPES.find((t) => t.type === b.type)?.label || b.type}
            </span>
            <span style={{ fontSize: "12px", color: brand.body, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {blockSummary(b)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeBlock(b.id);
              }}
              title="Delete block"
              style={{ display: "inline-flex", alignItems: "center", border: "none", background: "none", color: brand.danger, cursor: "pointer", fontSize: "13px", padding: "2px 4px" }}
            >
              <Icon name="x" size={13} color="currentColor" />
            </button>
          </div>
        ))}

        <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${brand.divider}` }}>
          <label style={{ ...panelLabel, marginTop: 0 }}>Add a block</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {visibleTypes.map((t) => (
              <button key={t.type} type="button" onClick={() => addBlock(t.type)} style={smallBtn}>
                + {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Properties panel */}
      <div style={{ flex: "1 1 45%", padding: "14px", borderLeft: `1px solid ${brand.border}`, background: "#fff", minHeight: "360px" }}>
        <label style={{ ...panelLabel, marginTop: 0 }}>
          {selected ? `Editing: ${BLOCK_TYPES.find((t) => t.type === selected.type)?.label}` : "Properties"}
        </label>
        <PropertiesPanel block={selected} onChange={updateBlock} tokens={tokens} isPdf={isPdf} />
      </div>
    </div>
  );
}
