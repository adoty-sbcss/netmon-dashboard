CREATE TABLE "district_sftp" (
	"id" serial PRIMARY KEY NOT NULL,
	"district_id" integer NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"home_dir" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "district_sftp_district_id_unique" UNIQUE("district_id")
);
--> statement-breakpoint
ALTER TABLE "district_sftp" ADD CONSTRAINT "district_sftp_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE cascade ON UPDATE no action;