CREATE TABLE "app_state_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"from_state" text,
	"state" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app_state_history" ADD CONSTRAINT "app_state_history_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_state_history_app" ON "app_state_history" USING btree ("org_id","app_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contributions_ref" ON "contributions" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "contributions_user" ON "contributions" USING btree ("user_id","created_at");--> statement-breakpoint
-- NEXT-STEPS P2.14: lifecycle history is the business's own data (detection writes it inside withOrg).
ALTER TABLE app_state_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON app_state_history USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON app_state_history TO flowstack_app;
--> statement-breakpoint
-- Round-2 3f: contributions are owner-only (RLS on, no policy or grant for flowstack_app) until the model is decided.
ALTER TABLE contributions ENABLE ROW LEVEL SECURITY;
