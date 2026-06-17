CREATE INDEX "idx_host_switch_ports_source_ip" ON "host_switch_ports" USING btree ("source_device_ip");--> statement-breakpoint
CREATE INDEX "idx_snmp_device_oid" ON "snmp_polls" USING btree ("device_ip","oid_name");--> statement-breakpoint
CREATE INDEX "idx_host_ip" ON "entities_host" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "idx_switch_mgmt_ip" ON "entities_switch" USING btree ("mgmt_ip");--> statement-breakpoint
CREATE INDEX "idx_issue_scope_status" ON "issues" USING btree ("scope_type","scope_id","status");