CREATE TABLE "school_committed_rate" (
	"school_id" integer PRIMARY KEY NOT NULL,
	"committed_mbps" integer,
	"label" text,
	"note" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uplink_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"sensor_id" integer,
	"chassis_id" text NOT NULL,
	"ifindex" text NOT NULL,
	"if_name" text,
	"speed_mbps" integer,
	"in_octets" bigint,
	"out_octets" bigint,
	"in_mbps" double precision,
	"out_mbps" double precision,
	"sampled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_committed_rate" ADD CONSTRAINT "school_committed_rate_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_committed_rate" ADD CONSTRAINT "school_committed_rate_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uplink_samples" ADD CONSTRAINT "uplink_samples_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uplink_samples" ADD CONSTRAINT "uplink_samples_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_uplink_samples_school" ON "uplink_samples" USING btree ("school_id","sampled_at");--> statement-breakpoint
CREATE INDEX "idx_uplink_samples_iface" ON "uplink_samples" USING btree ("school_id","chassis_id","ifindex","sampled_at");