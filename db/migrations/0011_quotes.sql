CREATE TABLE "quote_replies" (
	"request_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"price_monthly" numeric(14, 2),
	"price_text" text NOT NULL,
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"entered_by" text NOT NULL,
	CONSTRAINT "quote_replies_request_id_app_id_pk" PRIMARY KEY("request_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"line_key" text,
	"app_ids" text[] NOT NULL,
	"situation" jsonb NOT NULL,
	"reply_to" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "quote_replies" ADD CONSTRAINT "quote_replies_request_id_quote_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_replies" ADD CONSTRAINT "quote_replies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The business reads its own requests and replies and creates requests; replies are entered by our team (owner connection).
ALTER TABLE quote_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON quote_requests USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON quote_requests TO flowstack_app;
--> statement-breakpoint
ALTER TABLE quote_replies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON quote_replies USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT ON quote_replies TO flowstack_app;
