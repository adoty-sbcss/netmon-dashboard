CREATE TABLE "ingest_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"host" text,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text,
	"auth_mode" text DEFAULT 'password' NOT NULL,
	"password_enc" text,
	"private_key_enc" text,
	"passphrase_enc" text,
	"base_dir" text DEFAULT '/' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_summary" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_settings" ADD CONSTRAINT "ingest_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;