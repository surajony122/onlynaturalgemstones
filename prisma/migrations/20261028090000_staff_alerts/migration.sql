-- Staff alert contacts and preferences (Staff access page) + WhatsApp alert template name + per-alert WhatsApp result.
ALTER TABLE "TeamMember" ADD COLUMN "alertEmail" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "alertWhatsapp" TEXT;
ALTER TABLE "TeamMember" ADD COLUMN "alertAstro" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamMember" ADD COLUMN "alertWishlist" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TeamMember" ADD COLUMN "alertCheckout" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AppSettings" ADD COLUMN "leadAlertWhatsappTemplate" TEXT;
ALTER TABLE "LeadAlert" ADD COLUMN "whatsappStatus" TEXT;
