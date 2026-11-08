CREATE TABLE "review_followups" (
	"review_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"support_score" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_followups_review_id_day_pk" PRIMARY KEY("review_id","day")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"user_id" uuid,
	"role" text NOT NULL,
	"scores" jsonb NOT NULL,
	"price_band" text,
	"body" text NOT NULL,
	"verified_months" integer NOT NULL,
	"incentivised" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "reviews_org_app" UNIQUE("org_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "vendor_replies" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"vendor_name" text NOT NULL,
	"body" text NOT NULL,
	"entered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_followups" ADD CONSTRAINT "review_followups_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_followups" ADD CONSTRAINT "review_followups_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_replies" ADD CONSTRAINT "vendor_replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_app_status" ON "reviews" USING btree ("app_id","status");--> statement-breakpoint
-- Reviews: the app role may read its own org's reviews and insert new ones only as pending and not incentivised.
-- Publishing, rejecting, editing and withdrawing go through the owner connection (lib/reviews), with audit_log rows.
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_read ON reviews FOR SELECT USING (org_id = app_org_id());
--> statement-breakpoint
CREATE POLICY tenant_insert ON reviews FOR INSERT WITH CHECK (org_id = app_org_id() AND status = 'pending' AND incentivised = false);
--> statement-breakpoint
GRANT SELECT, INSERT ON reviews TO flowstack_app;
--> statement-breakpoint
ALTER TABLE review_followups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON review_followups USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON review_followups TO flowstack_app;
--> statement-breakpoint
-- Vendor replies are public text entered by our team: owner connection only.
ALTER TABLE vendor_replies ENABLE ROW LEVEL SECURITY;
