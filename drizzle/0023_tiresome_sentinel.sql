ALTER TABLE "sensors" ADD COLUMN "reported_host_metrics" jsonb;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_metrics_at" timestamp with time zone;