CREATE TABLE "latency_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"trigger" text,
	"label" text,
	"target" text,
	"latency_ms" double precision,
	"jitter_ms" double precision,
	"loss_pct" double precision,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "latency_results" ADD CONSTRAINT "latency_results_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_latency_results_sensor" ON "latency_results" USING btree ("sensor_id","created_at");