CREATE TABLE "notification_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"alerts" boolean DEFAULT true NOT NULL,
	"reports" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"from_override" text,
	"report_enabled" boolean DEFAULT true NOT NULL,
	"report_day_of_month" integer DEFAULT 1 NOT NULL,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"alert_min_severity" text DEFAULT 'critical' NOT NULL,
	"alert_on_security" boolean DEFAULT true NOT NULL,
	"alert_on_sensor_offline" boolean DEFAULT true NOT NULL,
	"alert_on_storage" boolean DEFAULT true NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notif_recipient_email" ON "notification_recipients" USING btree ("email");