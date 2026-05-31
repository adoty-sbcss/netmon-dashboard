CREATE TABLE "config_backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"sensor_id" integer NOT NULL,
	"filename" text NOT NULL,
	"captured_at" timestamp with time zone,
	"size_bytes" integer,
	"content_b64" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "config_backups" ADD CONSTRAINT "config_backups_sensor_id_sensors_id_fk" FOREIGN KEY ("sensor_id") REFERENCES "public"."sensors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_config_backup_sensor_file" ON "config_backups" USING btree ("sensor_id","filename");