ALTER TABLE "wifi_experience" ADD COLUMN "bssid" text;--> statement-breakpoint
ALTER TABLE "wifi_experience" ADD COLUMN "band" text;--> statement-breakpoint
ALTER TABLE "wifi_experience" ADD COLUMN "rx_rate_mbps" double precision;--> statement-breakpoint
ALTER TABLE "wifi_experience" ADD COLUMN "download_mbps" double precision;--> statement-breakpoint
ALTER TABLE "wifi_experience" ADD COLUMN "targets" jsonb;