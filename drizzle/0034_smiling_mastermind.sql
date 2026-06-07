CREATE TABLE "release_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"stable_sha" text,
	"notes" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_channel" text;--> statement-breakpoint
ALTER TABLE "sensors" ADD COLUMN "reported_sha" text;--> statement-breakpoint
ALTER TABLE "release_settings" ADD CONSTRAINT "release_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;