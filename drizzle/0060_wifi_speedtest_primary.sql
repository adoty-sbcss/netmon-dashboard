ALTER TABLE "wifi_network_profiles" ADD COLUMN "speedtest_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "speedtest_results" ADD COLUMN "transport" text DEFAULT 'wired' NOT NULL;--> statement-breakpoint
ALTER TABLE "speedtest_results" ADD COLUMN "ssid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_speedtest_wifi_run" ON "speedtest_results" USING btree ("sensor_id","transport","ssid","started_at");