CREATE TABLE "district_webperf" (
	"district_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "district_webperf_urls" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"added_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webperf_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"trigger" text,
	"url" text,
	"dns_ms" double precision,
	"tcp_ms" double precision,
	"tls_ms" double precision,
	"ttfb_ms" double precision,
	"total_ms" double precision,
	"http_status" integer,
	"size_bytes" bigint,
	"speed_mbps" double precision,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "district_webperf" ADD CONSTRAINT "district_webperf_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "district_webperf" ADD CONSTRAINT "district_webperf_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "district_webperf_urls" ADD CONSTRAINT "district_webperf_urls_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "district_webperf_urls" ADD CONSTRAINT "district_webperf_urls_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webperf_results" ADD CONSTRAINT "webperf_results_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_webperf_url_district" ON "district_webperf_urls" USING btree ("district_id","url");--> statement-breakpoint
CREATE INDEX "idx_webperf_results_sensor" ON "webperf_results" USING btree ("sensor_id","created_at");