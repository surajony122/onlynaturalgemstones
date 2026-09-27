-- The custom-app Google Reviews feature (googleReviews.server.js, proxy.google-reviews.jsx,
-- the Place ID field on Settings) was removed per explicit request -- going with a Shopify
-- App Store review app instead. Dropping the now-unused column added by the earlier migration
-- rather than deleting that migration's file, so migration history stays consistent for anyone
-- re-running migrate deploy against a fresh database.
ALTER TABLE "AppSettings" DROP COLUMN "googlePlaceId";
