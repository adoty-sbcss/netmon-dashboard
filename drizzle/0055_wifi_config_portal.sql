CREATE TABLE "wifi_network_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"label" text,
	"ssid" text NOT NULL,
	"auth_method" text DEFAULT 'open' NOT NULL,
	"captive_portal" boolean DEFAULT false NOT NULL,
	"captive_auto_accept" boolean DEFAULT false NOT NULL,
	"credential_scope" text DEFAULT 'shared' NOT NULL,
	"shared_identity" text,
	"shared_secret_enc" text,
	"is_district_ssid" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule_enabled" boolean DEFAULT false NOT NULL,
	"schedule_interval_hours" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wifi_profile_sensors" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"sensor_id" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"identity" text,
	"secret_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wifi_experience" ADD COLUMN "captive_auto_accepted" boolean;--> statement-breakpoint
ALTER TABLE "wifi_network_profiles" ADD CONSTRAINT "wifi_network_profiles_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wifi_network_profiles" ADD CONSTRAINT "wifi_network_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wifi_profile_sensors" ADD CONSTRAINT "wifi_profile_sensors_profile_id_wifi_network_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."wifi_network_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wifi_profile_sensors" ADD CONSTRAINT "wifi_profile_sensors_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wifi_profiles_school" ON "wifi_network_profiles" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wifi_profile_school_ssid" ON "wifi_network_profiles" USING btree ("school_id","ssid");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wifi_profile_sensor" ON "wifi_profile_sensors" USING btree ("profile_id","sensor_id");--> statement-breakpoint
CREATE INDEX "idx_wifi_profile_sensors_sensor" ON "wifi_profile_sensors" USING btree ("sensor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wifi_exp_run" ON "wifi_experience" USING btree ("sensor_id","ssid","generated_at");