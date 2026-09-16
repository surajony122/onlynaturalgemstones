-- Editable label shown before the linked gemstone's SKU on the invoice
-- PDF's "Gemstone Customisation" row (default: "For gemstone SKU:").
ALTER TABLE "AppSettings" ADD COLUMN "invoiceCustomisationLinkLabel" TEXT;
