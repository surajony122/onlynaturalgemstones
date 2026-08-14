-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "whatsappIntervalValue" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "whatsappIntervalUnit" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "whatsappLastSentAt" TIMESTAMP(3);
