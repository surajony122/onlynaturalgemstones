-- Stores the visual drag-and-drop template builder's block arrays
-- (app/components/template-builder.jsx), so re-opening the builder
-- restores the same editable blocks. The real send path never reads
-- these -- only the compiled HTML in invoicePdfTemplate/
-- invoiceEmailTemplate, which the builder writes on save.
ALTER TABLE "AppSettings" ADD COLUMN "invoicePdfBlocksJson" JSONB;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceEmailBlocksJson" JSONB;
