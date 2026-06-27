ALTER TABLE "scan_runs" ADD COLUMN "vlan_id" integer;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD COLUMN "parent_interface" text;--> statement-breakpoint
CREATE INDEX "idx_scan_runs_vlan" ON "scan_runs" USING btree ("vlan_id");