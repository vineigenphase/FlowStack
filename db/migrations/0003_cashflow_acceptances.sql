CREATE TABLE "cashflow_acceptances" (
	"org_id" uuid NOT NULL,
	"period_to" date NOT NULL,
	"diff" numeric(14, 2) NOT NULL,
	"note" text NOT NULL,
	"accepted_by" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashflow_acceptances_org_id_period_to_pk" PRIMARY KEY("org_id","period_to")
);
--> statement-breakpoint
ALTER TABLE "cashflow_acceptances" ADD CONSTRAINT "cashflow_acceptances_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE cashflow_acceptances ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON cashflow_acceptances USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT ON cashflow_acceptances TO flowstack_app;
