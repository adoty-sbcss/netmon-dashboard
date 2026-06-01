CREATE TABLE "network_reachability" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"ip" text,
	"hostname" text,
	"vendor" text,
	"source" text,
	"ping_alive" boolean,
	"ping_rtt_ms" double precision,
	"ping_loss_pct" integer,
	"snmp_responded" boolean,
	"snmp_version" text,
	"traceroute_hops" integer,
	"traceroute_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "network_reachability" ADD CONSTRAINT "network_reachability_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_net_reach_scan" ON "network_reachability" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "idx_net_reach_ip" ON "network_reachability" USING btree ("ip");