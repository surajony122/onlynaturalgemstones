-- AlterTable
-- Backfills a column that should have shipped alongside the "Wishlist
-- Reminder" WhatsApp template feature (app.settings.jsx /
-- appSettings.server.js already reference interaktWishlistTemplateName)
-- but never got a migration -- every settings save has been failing with
-- a Prisma "Unknown argument" error as a result. See schema.prisma's
-- comment on this field for the confirmed live error.
ALTER TABLE "AppSettings" ADD COLUMN "interaktWishlistTemplateName" TEXT;
