CREATE TABLE "guest_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"flag_id" uuid,
	"app_id" text,
	"line_key" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_actions" ADD CONSTRAINT "guest_actions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_actions_guest" ON "guest_actions" USING btree ("guest_id","created_at");--> statement-breakpoint
-- NEXT-STEPS P0.2: guest actions are owner-only (RLS on, no policy or grant for flowstack_app).
ALTER TABLE guest_actions ENABLE ROW LEVEL SECURITY;
