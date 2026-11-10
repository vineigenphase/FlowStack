CREATE TABLE "app_status_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"answer" text NOT NULL,
	"replaced_by_app_id" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "detected_apps" ADD COLUMN "cycle" text;--> statement-breakpoint
ALTER TABLE "detected_apps" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "detected_apps" ADD COLUMN "next_expected" date;--> statement-breakpoint
ALTER TABLE "app_status_answers" ADD CONSTRAINT "app_status_answers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- v1.1 C: the business records its own answers about its apps.
ALTER TABLE app_status_answers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON app_status_answers USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON app_status_answers TO flowstack_app;
