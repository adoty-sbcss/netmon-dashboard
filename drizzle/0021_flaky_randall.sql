CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" integer NOT NULL,
	"issue_key" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"confidence" text,
	"title" text NOT NULL,
	"detail" text,
	"recommendation" text,
	"status" text DEFAULT 'open' NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"missed_runs" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp with time zone,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_issue_scope_key" ON "issues" USING btree ("scope_type","scope_id","issue_key");--> statement-breakpoint
CREATE INDEX "idx_issue_district_status" ON "issues" USING btree ("district_id","status");