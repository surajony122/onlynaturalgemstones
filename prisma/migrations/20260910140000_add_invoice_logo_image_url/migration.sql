-- Optional override for the invoice PDF's logo image -- falls back to
-- the shop's own Shopify logo when blank.
ALTER TABLE "AppSettings" ADD COLUMN "invoiceLogoImageUrl" TEXT;
