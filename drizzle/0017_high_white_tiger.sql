ALTER TABLE "sensors" ADD COLUMN "reported_snmp_enabled" boolean;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_snmp_communities" text;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_sftp_enabled" boolean;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_sftp_host" text;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_sftp_port" integer;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_sftp_user" text;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_config_at" timestamp with time zone;