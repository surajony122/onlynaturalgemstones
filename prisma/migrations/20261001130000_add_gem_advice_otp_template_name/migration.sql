-- Adds the configurable WhatsApp template name for the Gem
-- Recommendation form's OTP step (defaults to "ong_gem_advice_otp" in
-- code when left blank) -- same editable-template pattern as
-- AppSettings.interaktTemplateName, kept as its own column since this
-- is a separate, Authentication-category template.

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "gemAdviceOtpTemplateName" TEXT;
