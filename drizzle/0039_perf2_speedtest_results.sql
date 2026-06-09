CREATE TABLE "speedtest_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"trigger" text,
	"provider" text,
	"download_mbps" double precision,
	"upload_mbps" double precision,
	"latency_ms" double precision,
	"jitter_ms" double precision,
	"loss_pct" double precision,
	"server" text,
	"isp" text,
	"result_url" text,
	"external_ip" text,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"raw" jsonb,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "speedtest_results" ADD CONSTRAINT "speedtest_results_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_speedtest_results_sensor" ON "speedtest_results" USING btree ("sensor_id","created_at");