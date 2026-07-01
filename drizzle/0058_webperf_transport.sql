ALTER TABLE "webperf_results" ADD COLUMN "transport" text DEFAULT 'wired' NOT NULL;--> statement-breakpoint
ALTER TABLE "webperf_results" ADD COLUMN "ssid" text;