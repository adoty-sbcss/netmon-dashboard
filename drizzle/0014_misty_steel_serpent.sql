CREATE TABLE "branding_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"app_name" text,
	"tagline" text,
	"description" text,
	"primary_color" text,
	"logo_color_a" text,
	"logo_color_b" text,
	"logo_mime" text,
	"logo_data" text,
	"favicon_mime" text,
	"favicon_data" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branding_settings" ADD CONSTRAINT "branding_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;