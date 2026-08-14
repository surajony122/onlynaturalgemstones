-- AlterTable
ALTER TABLE "AstroLead" ADD COLUMN "whatsappFirstSentAt" TIMESTAMP(3);
ALTER TABLE "AstroLead" ADD COLUMN "whatsappFollowUpSentAt" TIMESTAMP(3);
ALTER TABLE "AstroLead" ADD COLUMN "whatsappFollowUpStatus" TEXT;
