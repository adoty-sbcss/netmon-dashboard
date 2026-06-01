CREATE TABLE "district_iperf" (
	"district_id" integer PRIMARY KEY NOT NULL,
	"server_host" text,
	"server_port" integer DEFAULT 5201 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iperf_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"trigger" text,
	"server_host" text,
	"server_port" integer,
	"protocol" text,
	"direction" text,
	"duration_sec" integer,
	"throughput_mbps" double precision,
	"retransmits" integer,
	"jitter_ms" double precision,
	"loss_pct" double precision,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"raw" jsonb,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "district_iperf" ADD CONSTRAINT "district_iperf_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "district_iperf" ADD CONSTRAINT "district_iperf_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iperf_results" ADD CONSTRAINT "iperf_results_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_iperf_results_sensor" ON "iperf_results" USING btree ("sensor_id","created_at");