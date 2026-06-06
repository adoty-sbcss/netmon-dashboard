ALTER TABLE "entities_host" ADD COLUMN "map_hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entities_host" ADD COLUMN "map_hidden_by" integer;--> statement-breakpoint
ALTER TABLE "entities_switch" ADD COLUMN "map_hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entities_switch" ADD COLUMN "map_hidden_by" integer;--> statement-breakpoint
ALTER TABLE "entities_host" ADD CONSTRAINT "entities_host_map_hidden_by_users_id_fk" FOREIGN KEY ("map_hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities_switch" ADD CONSTRAINT "entities_switch_map_hidden_by_users_id_fk" FOREIGN KEY ("map_hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;