-- A publicly-reachable URL to a signature/seal image shown on the
-- invoice PDF, above "Authorised Seal & Signatory", when set.
ALTER TABLE "AppSettings" ADD COLUMN "invoiceSealImageUrl" TEXT;
