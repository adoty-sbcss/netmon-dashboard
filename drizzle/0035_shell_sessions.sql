CREATE TYPE "public"."shell_session_status" AS ENUM('pending', 'active', 'closed', 'killed', 'expired');--> statement-breakpoint
CREATE TABLE "shell_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"status" "shell_session_status" DEFAULT 'pending' NOT NULL,
	"operator_token_hash" text NOT NULL,
	"sensor_token_hash" text NOT NULL,
	"record_key" text NOT NULL,
	"command_id" integer,
	"opened_by" integer,
	"opened_by_email" text,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "shell_sessions" ADD CONSTRAINT "shell_sessions_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shell_sessions" ADD CONSTRAINT "shell_sessions_command_id_command_queue_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."command_queue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shell_sessions" ADD CONSTRAINT "shell_sessions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shell_sessions_sensor" ON "shell_sessions" USING btree ("sensor_id","created_at");