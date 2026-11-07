CREATE TABLE "checkins" (
	"org_id" uuid NOT NULL,
	"install_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"checked_at" timestamp with time zone,
	CONSTRAINT "checkins_install_id_kind_pk" PRIMARY KEY("install_id","kind")
);
--> statement-breakpoint
CREATE TABLE "installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"line_key" text,
	"baseline" jsonb NOT NULL,
	"source" text NOT NULL,
	"installed_on" date NOT NULL,
	"renewal_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installs_org_app" UNIQUE("org_id","app_id")
);
--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_install_id_installs_id_fk" FOREIGN KEY ("install_id") REFERENCES "public"."installs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installs" ADD CONSTRAINT "installs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkins_due" ON "checkins" USING btree ("status","due_on");--> statement-breakpoint
ALTER TABLE installs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON installs USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON installs TO flowstack_app;
--> statement-breakpoint
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON checkins USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON checkins TO flowstack_app;
