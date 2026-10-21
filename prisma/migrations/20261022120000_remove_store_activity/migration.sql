-- The Store activity log was removed from the app. Drops its three tables if
-- they exist (they are only there if the previous migration already ran).
DROP TABLE IF EXISTS "StoreDeletionEvent";
DROP TABLE IF EXISTS "FileSnapshotItem";
DROP TABLE IF EXISTS "StoreSnapshotRun";
