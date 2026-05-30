CREATE TABLE "host_switch_ports" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"source_device_ip" text,
	"mac" text NOT NULL,
	"bridge_port" integer,
	"if_index" integer,
	"if_name" text
);
--> statement-breakpoint
ALTER TABLE "host_switch_ports" ADD CONSTRAINT "host_switch_ports_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_host_switch_ports_scan" ON "host_switch_ports" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "idx_host_switch_ports_mac" ON "host_switch_ports" USING btree ("mac");