CREATE TABLE "wifi_surveys" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"generated_at" timestamp with time zone,
	"stale" boolean,
	"backend" text,
	"regdom" text,
	"survey_host" text,
	"interface" text,
	"ssid" text,
	"bssid" text,
	"band" text,
	"channel" integer,
	"freq_mhz" integer,
	"rate_mbps" integer,
	"signal" integer,
	"signal_unit" text,
	"security" text,
	"auth" text,
	"cipher" text,
	"pmf" boolean,
	"mode" text,
	"in_use" boolean,
	"is_district_ssid" boolean,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wifi_surveys" ADD CONSTRAINT "wifi_surveys_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wifi_surveys_sensor" ON "wifi_surveys" USING btree ("sensor_id");--> statement-breakpoint
CREATE INDEX "idx_wifi_surveys_ssid" ON "wifi_surveys" USING btree ("ssid");--> statement-breakpoint
CREATE INDEX "idx_wifi_surveys_bssid" ON "wifi_surveys" USING btree ("bssid");