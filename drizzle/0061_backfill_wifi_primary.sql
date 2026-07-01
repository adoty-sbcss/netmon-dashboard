-- WIFI-6: default the speed-test primary to each school's FIRST-added Wi-Fi profile,
-- for existing schools that don't have one yet. New schools get this via the create
-- action; the collector also defaults the first network when none is flagged. Idempotent:
-- schools that already have a primary are skipped, so re-running is a no-op.
UPDATE "wifi_network_profiles"
SET "speedtest_primary" = true
WHERE "id" IN (
  SELECT DISTINCT ON ("school_id") "id"
  FROM "wifi_network_profiles"
  ORDER BY "school_id", "created_at" ASC, "id" ASC
)
AND "school_id" NOT IN (
  SELECT "school_id" FROM "wifi_network_profiles" WHERE "speedtest_primary" = true
);
