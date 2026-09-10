-- Add seller contact fields + delivery-days offset shown on the invoice
-- PDF, and a separate editable HTML template for the invoice EMAIL body
-- (distinct from invoicePdfTemplate, the attached PDF's own layout).
ALTER TABLE "AppSettings" ADD COLUMN "invoiceSellerPhone" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceSellerEmail" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceDeliveryDays" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "invoiceEmailTemplate" TEXT;
