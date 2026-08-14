-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "interaktApiKey" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "interaktTemplateName" TEXT;

-- AlterTable
ALTER TABLE "AstroLead" ADD COLUMN "whatsappSendStatus" TEXT;
