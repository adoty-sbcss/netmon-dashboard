ALTER TABLE "entities_host" ADD COLUMN "class_confidence" double precision;--> statement-breakpoint
ALTER TABLE "entities_host" ADD COLUMN "class_method" text;--> statement-breakpoint
ALTER TABLE "entities_host" ADD COLUMN "class_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entities_host" ADD COLUMN "class_signal_hash" text;