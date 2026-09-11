-- Editable subject line for the order-processing email (Settings page).
-- Same "blank means use the built-in default" convention as
-- orderProcessingEmailTemplate.
ALTER TABLE "AppSettings" ADD COLUMN "orderProcessingEmailSubject" TEXT;
