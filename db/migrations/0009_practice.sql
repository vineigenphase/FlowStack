CREATE TABLE "firm_invites" (
	"token" text PRIMARY KEY NOT NULL,
	"firm_id" uuid NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" uuid,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "firm_members" (
	"firm_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	CONSTRAINT "firm_members_firm_id_user_id_pk" PRIMARY KEY("firm_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "firm_orgs" (
	"firm_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "firm_orgs_firm_id_org_id_pk" PRIMARY KEY("firm_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "firms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbooks" (
	"firm_id" uuid NOT NULL,
	"industry" text NOT NULL,
	"job_key" text NOT NULL,
	"app_id" text NOT NULL,
	CONSTRAINT "playbooks_firm_id_industry_job_key_pk" PRIMARY KEY("firm_id","industry","job_key")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"token" text NOT NULL,
	"items" jsonb NOT NULL,
	"chosen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fee_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "proposals_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "firm_invites" ADD CONSTRAINT "firm_invites_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_members" ADD CONSTRAINT "firm_members_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_members" ADD CONSTRAINT "firm_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_orgs" ADD CONSTRAINT "firm_orgs_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "firm_orgs" ADD CONSTRAINT "firm_orgs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_firm" ON "proposals" USING btree ("firm_id","status");--> statement-breakpoint
-- Cross-org tables: RLS on with no policy or grant, so only the owner connection (lib/firms, after a membership check) reads them.
ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE firm_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE firm_orgs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE firm_invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
