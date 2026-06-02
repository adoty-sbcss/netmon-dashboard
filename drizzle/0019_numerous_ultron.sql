CREATE TABLE "device_acks" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"mac" text NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"acted_by" integer,
	"acted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"model" text NOT NULL,
	"eol_date" date,
	"end_of_sale_date" date,
	"eos_date" date,
	"latest_firmware" text,
	"source" text,
	"notes" text,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifecycle_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"api_key_enc" text,
	"base_url" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_sources_vendor_unique" UNIQUE("vendor")
);
--> statement-breakpoint
CREATE TABLE "registry_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"school_id" integer,
	"name" text NOT NULL,
	"device_type" text DEFAULT 'unknown' NOT NULL,
	"device_type_other" text,
	"ip" text,
	"mac" text,
	"vendor" text,
	"model" text,
	"building" text,
	"room" text,
	"monitor_type" text DEFAULT 'none' NOT NULL,
	"snmp_community_enc" text,
	"firmware_current" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"linked_host_id" integer,
	"linked_switch_id" integer,
	"retired_reason" text,
	"retired_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_acks" ADD CONSTRAINT "device_acks_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_acks" ADD CONSTRAINT "device_acks_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_sources" ADD CONSTRAINT "lifecycle_sources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_devices" ADD CONSTRAINT "registry_devices_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_devices" ADD CONSTRAINT "registry_devices_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_devices" ADD CONSTRAINT "registry_devices_linked_host_id_entities_host_id_fk" FOREIGN KEY ("linked_host_id") REFERENCES "public"."entities_host"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_devices" ADD CONSTRAINT "registry_devices_linked_switch_id_entities_switch_id_fk" FOREIGN KEY ("linked_switch_id") REFERENCES "public"."entities_switch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_devices" ADD CONSTRAINT "registry_devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_devices" ADD CONSTRAINT "registry_devices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_device_ack_district_mac" ON "device_acks" USING btree ("district_id","mac");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lifecycle_vendor_model" ON "lifecycle_models" USING btree ("vendor","model");--> statement-breakpoint
CREATE INDEX "idx_registry_district" ON "registry_devices" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "idx_registry_school" ON "registry_devices" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_registry_mac" ON "registry_devices" USING btree ("mac");--> statement-breakpoint
CREATE INDEX "idx_registry_ip" ON "registry_devices" USING btree ("ip");