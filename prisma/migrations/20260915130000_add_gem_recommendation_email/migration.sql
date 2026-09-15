-- Gem Recommendation email template/subject (Settings page) -- same
-- "blank means use the built-in default" convention as
-- orderProcessingEmailTemplate/orderProcessingEmailSubject.
ALTER TABLE "AppSettings" ADD COLUMN "gemRecommendationEmailTemplate" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "gemRecommendationEmailSubject" TEXT;
