-- Return Received / Refund Processed WhatsApp template names (Settings
-- page) -- same "blank means use the built-in default" convention as
-- interaktOrderTemplateName.
ALTER TABLE "AppSettings" ADD COLUMN "interaktReturnTemplateName" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "interaktRefundTemplateName" TEXT;
