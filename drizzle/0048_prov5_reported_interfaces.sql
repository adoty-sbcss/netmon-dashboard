ALTER TABLE "sensors" ADD COLUMN "reported_interfaces" jsonb;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_interfaces_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "last_host_action" jsonb;