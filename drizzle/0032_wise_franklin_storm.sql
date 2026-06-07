CREATE TABLE "security_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"action" text NOT NULL,
	"actor_type" text,
	"actor" text,
	"source_ip" text,
	"user_agent" text,
	"target" text,
	"district_id" integer,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"analyzed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_secevent_at" ON "security_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "idx_secevent_cat_sev" ON "security_events" USING btree ("category","severity");--> statement-breakpoint
CREATE INDEX "idx_secevent_ip" ON "security_events" USING btree ("source_ip");--> statement-breakpoint
CREATE INDEX "idx_secevent_analyzed" ON "security_events" USING btree ("analyzed_at");