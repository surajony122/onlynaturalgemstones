-- DropTable
-- Removing the Google Reviews feature entirely (app pages, storefront
-- proxy, and theme section removed alongside this) -- per explicit
-- request. Postgres drops the table's own index automatically along
-- with the table itself.
DROP TABLE "GoogleReview";
