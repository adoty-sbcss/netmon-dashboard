CREATE TABLE "wifi_experience" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"generated_at" timestamp with time zone,
	"interface" text,
	"ssid" text,
	"auth" text,
	"associated" boolean,
	"assoc_ms" integer,
	"dhcp_ms" integer,
	"ip" text,
	"gateway" text,
	"signal" integer,
	"signal_unit" text,
	"captive_state" text,
	"captive_http_code" text,
	"captive_redirect" text,
	"ping_ok" boolean,
	"rtt_ms" double precision,
	"loss_pct" integer,
	"dns_ok" boolean,
	"isolation_target" text,
	"isolation_reachable" boolean,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wifi_experience" ADD CONSTRAINT "wifi_experience_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_wifi_experience_sensor" ON "wifi_experience" USING btree ("sensor_id");--> statement-breakpoint
CREATE INDEX "idx_wifi_experience_ssid" ON "wifi_experience" USING btree ("ssid");