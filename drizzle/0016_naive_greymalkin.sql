CREATE TABLE "dhcp_authorized_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"server_ip" text NOT NULL,
	"label" text,
	"note" text,
	"added_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dhcp_authorized_servers" ADD CONSTRAINT "dhcp_authorized_servers_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dhcp_authorized_servers" ADD CONSTRAINT "dhcp_authorized_servers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dhcp_authz_district_ip" ON "dhcp_authorized_servers" USING btree ("district_id","server_ip");--> statement-breakpoint
CREATE INDEX "idx_dhcp_authz_district" ON "dhcp_authorized_servers" USING btree ("district_id");