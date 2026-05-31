ALTER TABLE "ingest_settings" ADD COLUMN "auto_enroll_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_settings" ADD COLUMN "bootstrap_key_enc" text;