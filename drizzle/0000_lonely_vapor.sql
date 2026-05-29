CREATE TYPE "public"."parse_status" AS ENUM('pending', 'parsed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('global', 'district', 'school', 'sensor');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('superadmin', 'user');--> statement-breakpoint
CREATE TYPE "public"."command_status" AS ENUM('pending', 'approved', 'sent', 'acked', 'done', 'failed', 'rejected');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"target" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_glass_mfa_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "break_glass_mfa_emails_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "districts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingested_bundles" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"district_slug" text,
	"school_slug" text,
	"device_slug" text,
	"size_bytes" bigint,
	"blob_path" text,
	"built_at" timestamp with time zone,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parsed_at" timestamp with time zone,
	"parse_status" "parse_status" DEFAULT 'pending' NOT NULL,
	"parse_error" text,
	CONSTRAINT "ingested_bundles_filename_unique" UNIQUE("filename")
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensors" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text,
	"last_checkin_at" timestamp with time zone,
	"reported_config_version" integer,
	"agent_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"is_break_glass" boolean DEFAULT false NOT NULL,
	"password_hash" text,
	"disabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"ip" text,
	"mac" text,
	"hostname" text,
	"vendor" text,
	"source" text,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dhcp_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"message_type" text,
	"server_ip" text,
	"server_mac" text,
	"client_mac" text,
	"offered_ip" text,
	"subnet_mask" text,
	"router" text,
	"dns_servers" text,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"rule" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "neighbors" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"local_port" text,
	"protocol" text,
	"chassis_id" text,
	"port_id" text,
	"system_name" text,
	"system_description" text,
	"port_description" text,
	"vlan_id" integer,
	"mgmt_ip" text,
	"capabilities" text[],
	"seen_at" timestamp with time zone,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer,
	"bundle_id" integer,
	"source_scan_id" integer,
	"district_slug" text,
	"school_slug" text,
	"device_slug" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"trigger_reason" text,
	"interface" text,
	"interface_cidr" text,
	"gateway_ip" text,
	"gateway_mac" text,
	"network_id" text,
	"duration_sec" integer,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"error" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snmp_polls" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"device_ip" text,
	"oid" text,
	"oid_name" text,
	"value" text,
	"polled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stp_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"bpdu_type" text,
	"root_bridge_id" text,
	"bridge_id" text,
	"port_id" text,
	"root_path_cost" bigint,
	"topology_change" boolean,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "traffic_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_run_id" integer NOT NULL,
	"interface" text,
	"bucket_start" timestamp with time zone,
	"bucket_end" timestamp with time zone,
	"rx_packets" bigint,
	"rx_bytes" bigint,
	"rx_errors" bigint,
	"rx_dropped" bigint,
	"tx_packets" bigint,
	"tx_bytes" bigint,
	"broadcast_packets" bigint,
	"multicast_packets" bigint,
	"tshark_total_packets" bigint
);
--> statement-breakpoint
CREATE TABLE "entities_host" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"school_id" integer,
	"mac" text NOT NULL,
	"ip" text,
	"hostname" text,
	"vendor" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities_switch" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"school_id" integer,
	"chassis_id" text NOT NULL,
	"system_name" text,
	"system_description" text,
	"mgmt_ip" text,
	"capabilities" text[],
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health_rollup_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"school_id" integer,
	"day" date NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topology_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" integer NOT NULL,
	"graph" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "command_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"command" text NOT NULL,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "command_status" DEFAULT 'pending' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"approved_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "command_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"command_id" integer NOT NULL,
	"status" text NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desired_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desired_config_sensor_id_unique" UNIQUE("sensor_id")
);
--> statement-breakpoint
CREATE TABLE "sensor_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensors" ADD CONSTRAINT "sensors_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dhcp_observations" ADD CONSTRAINT "dhcp_observations_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neighbors" ADD CONSTRAINT "neighbors_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_bundle_id_ingested_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."ingested_bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snmp_polls" ADD CONSTRAINT "snmp_polls_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stp_events" ADD CONSTRAINT "stp_events_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traffic_stats" ADD CONSTRAINT "traffic_stats_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities_host" ADD CONSTRAINT "entities_host_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities_host" ADD CONSTRAINT "entities_host_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities_switch" ADD CONSTRAINT "entities_switch_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities_switch" ADD CONSTRAINT "entities_switch_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_rollup_daily" ADD CONSTRAINT "health_rollup_daily_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_rollup_daily" ADD CONSTRAINT "health_rollup_daily_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_queue" ADD CONSTRAINT "command_queue_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_queue" ADD CONSTRAINT "command_queue_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_queue" ADD CONSTRAINT "command_queue_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_results" ADD CONSTRAINT "command_results_command_id_command_queue_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."command_queue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desired_config" ADD CONSTRAINT "desired_config_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desired_config" ADD CONSTRAINT "desired_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_enrollments" ADD CONSTRAINT "sensor_enrollments_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_at" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grants_user_scope" ON "grants" USING btree ("user_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "idx_grants_user" ON "grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_bundles_parse_status" ON "ingested_bundles" USING btree ("parse_status");--> statement-breakpoint
CREATE INDEX "idx_bundles_identity" ON "ingested_bundles" USING btree ("district_slug","school_slug","device_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_schools_district_slug" ON "schools" USING btree ("district_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sensors_school_slug" ON "sensors" USING btree ("school_id","slug");--> statement-breakpoint
CREATE INDEX "idx_devices_scan" ON "devices" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "idx_devices_mac" ON "devices" USING btree ("mac");--> statement-breakpoint
CREATE INDEX "idx_dhcp_scan" ON "dhcp_observations" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "idx_findings_scan" ON "findings" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "idx_findings_severity" ON "findings" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_neighbors_scan" ON "neighbors" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "idx_scan_runs_sensor" ON "scan_runs" USING btree ("sensor_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_scan_runs_started" ON "scan_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_snmp_scan" ON "snmp_polls" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "idx_stp_scan" ON "stp_events" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "idx_traffic_scan" ON "traffic_stats" USING btree ("scan_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_host_district_mac" ON "entities_host" USING btree ("district_id","mac");--> statement-breakpoint
CREATE INDEX "idx_host_school" ON "entities_host" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_switch_district_chassis" ON "entities_switch" USING btree ("district_id","chassis_id");--> statement-breakpoint
CREATE INDEX "idx_switch_school" ON "entities_switch" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_rollup_district_school_day" ON "health_rollup_daily" USING btree ("district_id","school_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_topology_kind_scope" ON "topology_snapshots" USING btree ("kind","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "idx_cmd_sensor_status" ON "command_queue" USING btree ("sensor_id","status");--> statement-breakpoint
CREATE INDEX "idx_cmd_results_command" ON "command_results" USING btree ("command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_enroll_token_hash" ON "sensor_enrollments" USING btree ("token_hash");