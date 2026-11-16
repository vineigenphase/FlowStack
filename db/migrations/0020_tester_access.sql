CREATE TABLE "access_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"note" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "design_partner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "approved_by" text;--> statement-breakpoint
-- NEXT-STEPS P0.5: invite codes are owner-only (RLS on, no policy or grant for flowstack_app).
ALTER TABLE access_codes ENABLE ROW LEVEL SECURITY;
