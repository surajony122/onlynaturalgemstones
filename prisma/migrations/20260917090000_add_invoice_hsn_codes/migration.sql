-- HSN codes for the invoice PDF's own HSN column (loose/customisation
-- flat defaults, plus per-collection overrides) -- same shape/precedence
-- as the existing invoiceGstRateLoose/invoiceGstRateCustomisation/
-- invoiceCollectionGstRates fields.
ALTER TABLE "AppSettings" ADD COLUMN "invoiceHsnLoose" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceHsnCustomisation" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceCollectionHsnCodes" JSONB;
