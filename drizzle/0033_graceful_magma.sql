CREATE TABLE "security_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"trigger" text NOT NULL,
	"event_count" integer,
	"provider_id" text NOT NULL,
	"model" text,
	"status" text DEFAULT 'running' NOT NULL,
	"prose" text,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"cost_usd" double precision,
	"latency_ms" integer,
	"error" text,
	"requested_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "security_analyses" ADD CONSTRAINT "security_analyses_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_security_analyses_created" ON "security_analyses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_security_analyses_run" ON "security_analyses" USING btree ("run_id");