CREATE TABLE "ai_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" integer NOT NULL,
	"district_id" integer NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"trigger" text NOT NULL,
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
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_analyses_scope" ON "ai_analyses" USING btree ("district_id","scope_type","scope_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_analyses_run" ON "ai_analyses" USING btree ("run_id");