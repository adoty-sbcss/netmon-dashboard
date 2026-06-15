CREATE TABLE "snmp_device_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"device_ip" text NOT NULL,
	"community" text,
	"version" text,
	"last_succeeded_at" timestamp with time zone,
	"failure_count" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snmp_device_credentials" ADD CONSTRAINT "snmp_device_credentials_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_snmp_cred_school_ip" ON "snmp_device_credentials" USING btree ("school_id","device_ip");--> statement-breakpoint
CREATE INDEX "idx_dhcp_client_mac" ON "dhcp_observations" USING btree ("client_mac");--> statement-breakpoint
CREATE INDEX "idx_neighbors_chassis" ON "neighbors" USING btree ("chassis_id");--> statement-breakpoint
CREATE INDEX "idx_snmp_device_ip" ON "snmp_polls" USING btree ("device_ip");