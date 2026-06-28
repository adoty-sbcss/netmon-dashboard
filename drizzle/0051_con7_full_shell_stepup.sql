CREATE TABLE "console_stepup_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_email" text NOT NULL,
	"sensor_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shell_sessions" ADD COLUMN "mode" text DEFAULT 'restricted' NOT NULL;--> statement-breakpoint
ALTER TABLE "console_stepup_challenges" ADD CONSTRAINT "console_stepup_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "console_stepup_challenges" ADD CONSTRAINT "console_stepup_challenges_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_console_stepup_user" ON "console_stepup_challenges" USING btree ("user_id","created_at");