-- Idempotency key for the automatic "refund_whatsapp" rows written by
-- webhooks.refunds.create.jsx -- lets a retried/redelivered refunds/
-- create webhook for the same refund be skipped instead of sending the
-- WhatsApp message twice. Nullable + unique: legacy manual rows
-- (return_email, refund_email, return_whatsapp) have no refundId and
-- Postgres allows any number of NULLs under a unique constraint.
--
-- returnId (added in the previous migration) is left in place, unused
-- -- it briefly backed an automatic "Return Received" flow that was
-- tried and reverted before this one shipped.
ALTER TABLE "OrderReturnEmailNotification" ADD COLUMN "refundId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OrderReturnEmailNotification_refundId_key" ON "OrderReturnEmailNotification"("refundId");
