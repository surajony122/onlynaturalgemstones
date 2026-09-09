-- AlterTable
-- Removing the Places-API-based Google Reviews groundwork added in
-- 20260909120000_add_google_reviews_api_settings, per explicit request
-- (user decided to wait for the Business Profile API approval instead
-- of using Places API as a stopgap). Never editing that already-deployed
-- migration -- same standard practice as the earlier GoogleReview
-- table's own add/drop pair (see 20260904000000_add_google_review /
-- 20260904010000_drop_google_review).
ALTER TABLE "AppSettings" DROP COLUMN "googleReviewsApiKey";
ALTER TABLE "AppSettings" DROP COLUMN "googleReviewsPlaceId";
