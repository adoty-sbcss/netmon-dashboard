CREATE TABLE "ai_provider_settings" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"model" text,
	"api_key_enc" text,
	"endpoint" text,
	"api_version" text,
	"organization" text,
	"project" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"schedule_enabled" boolean DEFAULT true NOT NULL,
	"schedule_cron" text DEFAULT '0 2 * * *' NOT NULL,
	"max_output_tokens" integer DEFAULT 8192 NOT NULL,
	"monthly_spend_cap_usd" double precision,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD CONSTRAINT "ai_provider_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;