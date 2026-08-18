-- AlterTable: add triggerKey, defaulting existing rows to "tag" (their
-- original one-notification-ever-per-order semantics), then replace the
-- old orderId-only unique constraint with a compound one on
-- (orderId, triggerKey) so a NEW distinct trigger occurrence (e.g. a
-- fresh "marked as in progress" event) can notify again for an order
-- that was already notified for an earlier occurrence.
ALTER TABLE "OrderProcessingNotification" ADD COLUMN "triggerKey" TEXT NOT NULL DEFAULT 'tag';

DROP INDEX IF EXISTS "OrderProcessingNotification_orderId_key";

CREATE UNIQUE INDEX "OrderProcessingNotification_orderId_triggerKey_key" ON "OrderProcessingNotification"("orderId", "triggerKey");
