-- 3-stage wishlist reminder email sequence (5 min / 1 hour / 24 hours
-- after the customer's latest wishlist activity). emailSendStatus is
-- reused as "stage 1" (see schema.prisma comment); these are the new
-- stage 2/3 columns plus sentAt timestamps for all three stages.
ALTER TABLE "WishlistLead" ADD COLUMN "emailStage1SentAt" TIMESTAMP(3);
ALTER TABLE "WishlistLead" ADD COLUMN "emailStage2Status" TEXT;
ALTER TABLE "WishlistLead" ADD COLUMN "emailStage2SentAt" TIMESTAMP(3);
ALTER TABLE "WishlistLead" ADD COLUMN "emailStage3Status" TEXT;
ALTER TABLE "WishlistLead" ADD COLUMN "emailStage3SentAt" TIMESTAMP(3);

-- Critical backfill: every row that already exists at the moment this
-- migration runs predates the 3-stage sequence entirely. Without this,
-- the very first processDueWishlistEmails run after deploy would see
-- emailStage2Status/emailStage3Status as NULL on every existing lead
-- (many of them days or weeks old), compute elapsed time since their
-- old createdAt as far past both the 1-hour and 24-hour thresholds, and
-- -- combined with the code's one-stage-per-run throttle -- still send
-- a "stage 2" (and, on the run after that, "stage 3") email to
-- potentially every historical wishlist lead who was ever emailed
-- under the old single-reminder system. Marking them "not applicable"
-- here means only leads created AFTER this deploy ever progress through
-- stages 2 and 3. emailSendStatus (stage 1) is deliberately left
-- untouched -- a lead still legitimately pending there (e.g. Gmail
-- wasn't configured yet) keeps working exactly as it already did.
UPDATE "WishlistLead" SET "emailStage2Status" = 'skipped: pre-dates the 3-stage sequence' WHERE "emailStage2Status" IS NULL;
UPDATE "WishlistLead" SET "emailStage3Status" = 'skipped: pre-dates the 3-stage sequence' WHERE "emailStage3Status" IS NULL;
