CREATE TABLE "dns_probes" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"resolver_ip" text,
	"resolver_source" text,
	"query_name" text,
	"query_type" text,
	"expected_status" text,
	"status" text,
	"query_time_ms" integer,
	"answer_count" integer,
	"answers_text" text,
	"error" text,
	"probed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dns_resolver_health" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"resolver_ip" text,
	"resolver_source" text,
	"probes" integer,
	"ok" integer,
	"errors" integer,
	"nxdomain_rewrite" boolean,
	"mean_ms" double precision
);
--> statement-breakpoint
ALTER TABLE "dns_probes" ADD CONSTRAINT "dns_probes_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_resolver_health" ADD CONSTRAINT "dns_resolver_health_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dns_probes_scan" ON "dns_probes" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "idx_dns_resolver_health_scan" ON "dns_resolver_health" USING btree ("scan_run_id");