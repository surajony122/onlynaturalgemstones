-- Idempotency key for the new automatic "return_whatsapp" rows written
-- by webhooks.returns.process.jsx -- lets a retried/redelivered
-- returns/process webhook for the same Return be skipped instead of
-- sending the WhatsApp message twice. Nullable + unique: legacy manual
-- rows (return_email, refund_email, refund_whatsapp) have no returnId
-- and Postgres allows any number of NULLs under a unique constraint.
ALTER TABLE "OrderReturnEmailNotification" ADD COLUMN "returnId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OrderReturnEmailNotification_returnId_key" ON "OrderReturnEmailNotification"("returnId");
