CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"company" text NOT NULL,
	"role" text NOT NULL,
	"industry" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "flag_feedback" ADD COLUMN "sub_reason" text;--> statement-breakpoint
-- UI-SPEC waitlist: owner connection only (RLS on with no policy or grant for flowstack_app).
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
