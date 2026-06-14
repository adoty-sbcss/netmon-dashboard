CREATE TABLE "help_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"slug" text,
	"query" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_help_events_type_created" ON "help_events" USING btree ("type","created_at");