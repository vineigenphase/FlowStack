CREATE TABLE "recommendations_v2" (
	"flag_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"rank" integer NOT NULL,
	"match" real NOT NULL,
	"components" jsonb NOT NULL,
	"in_use" boolean NOT NULL,
	"kind" text,
	"reason" text NOT NULL,
	CONSTRAINT "recommendations_v2_flag_id_app_id_pk" PRIMARY KEY("flag_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "xero_app_listings" (
	"listing_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"captured_at" text NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations_v2" ADD CONSTRAINT "recommendations_v2_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations_v2" ADD CONSTRAINT "recommendations_v2_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ENGINE-V2 §1.3: v2 shadow ranking is the business's own data (written inside withOrg, like recommendations).
ALTER TABLE recommendations_v2 ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON recommendations_v2 USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendations_v2 TO flowstack_app;
--> statement-breakpoint
-- The Xero app database is global and read-only to the app role (like app_facts); loaded by the owner connection.
GRANT SELECT ON xero_app_listings TO flowstack_app;
