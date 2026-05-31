CREATE TABLE "topology_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"school_id" integer NOT NULL,
	"kind" text NOT NULL,
	"node_id" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topology_positions" ADD CONSTRAINT "topology_positions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_topo_pos_school_kind_node" ON "topology_positions" USING btree ("school_id","kind","node_id");