CREATE TABLE "school_policy" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"snmp_enabled" boolean DEFAULT true NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_policy_school_id_unique" UNIQUE("school_id")
);
--> statement-breakpoint
ALTER TABLE "entities_host" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entities_host" ADD COLUMN "excluded_by" integer;--> statement-breakpoint
ALTER TABLE "entities_switch" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entities_switch" ADD COLUMN "excluded_by" integer;--> statement-breakpoint
ALTER TABLE "school_policy" ADD CONSTRAINT "school_policy_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_policy" ADD CONSTRAINT "school_policy_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities_host" ADD CONSTRAINT "entities_host_excluded_by_users_id_fk" FOREIGN KEY ("excluded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities_switch" ADD CONSTRAINT "entities_switch_excluded_by_users_id_fk" FOREIGN KEY ("excluded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;