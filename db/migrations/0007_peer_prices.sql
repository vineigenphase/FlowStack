CREATE TABLE "price_observations" (
	"app_id" text NOT NULL,
	"org_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"size_band" text,
	"industry" text,
	CONSTRAINT "price_observations_app_id_org_id_month_pk" PRIMARY KEY("app_id","org_id","month")
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "share_prices" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Cross-tenant on purpose: no policy and no grant for flowstack_app, so only the owner connection (lib/prices) can read it.
ALTER TABLE price_observations ENABLE ROW LEVEL SECURITY;
