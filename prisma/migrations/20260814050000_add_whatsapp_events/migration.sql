-- CreateTable
CREATE TABLE "WhatsAppMessageEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "trackingId" TEXT,
    "phone" TEXT,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppMessageEvent_trackingId_idx" ON "WhatsAppMessageEvent"("trackingId");

-- CreateIndex
CREATE INDEX "WhatsAppMessageEvent_messageId_idx" ON "WhatsAppMessageEvent"("messageId");

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "interaktWebhookSecret" TEXT;
