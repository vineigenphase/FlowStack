CREATE TABLE "account_maps" (
	"org_id" uuid NOT NULL,
	"xero_account_id" uuid NOT NULL,
	"category" text NOT NULL,
	"confidence" real NOT NULL,
	"source" text NOT NULL,
	"rule_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_maps_org_id_xero_account_id_pk" PRIMARY KEY("org_id","xero_account_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"org_id" uuid NOT NULL,
	"xero_account_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"class" text,
	"reporting_code" text,
	"system_account" text,
	"status" text,
	CONSTRAINT "accounts_org_id_xero_account_id_pk" PRIMARY KEY("org_id","xero_account_id")
);
--> statement-breakpoint
CREATE TABLE "app_facts" (
	"app_id" text NOT NULL,
	"field" text NOT NULL,
	"value" jsonb,
	"state" text NOT NULL,
	"quote" text,
	"source_url" text,
	"checked_at" timestamp with time zone,
	"checked_by" text,
	"sample" boolean DEFAULT true NOT NULL,
	CONSTRAINT "app_facts_app_id_field_pk" PRIMARY KEY("app_id","field")
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"categories" text[] NOT NULL,
	"markets" text[] NOT NULL,
	"crawl" jsonb,
	"sample" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_pages" (
	"app_id" text NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"text_hash" text,
	"text" text,
	CONSTRAINT "crawl_pages_app_id_kind_pk" PRIMARY KEY("app_id","kind")
);
--> statement-breakpoint
CREATE TABLE "detected_apps" (
	"org_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"spend_12m" numeric(14, 2) NOT NULL,
	"months_seen" integer NOT NULL,
	"last_seen" date NOT NULL,
	"present" boolean NOT NULL,
	"evidence" jsonb NOT NULL,
	CONSTRAINT "detected_apps_org_id_app_id_pk" PRIMARY KEY("org_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "fingerprints" (
	"app_id" text NOT NULL,
	"pattern" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "fingerprints_app_id_pattern_pk" PRIMARY KEY("app_id","pattern")
);
--> statement-breakpoint
CREATE TABLE "flag_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"rule_id" text,
	"rule_version" integer,
	"answer" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"statement_kind" text NOT NULL,
	"line_key" text NOT NULL,
	"xero_account_id" uuid,
	"rule_id" text,
	"rule_version" integer,
	"value" numeric(14, 2) NOT NULL,
	"base" numeric(14, 2) NOT NULL,
	"materiality" real NOT NULL,
	"band" text NOT NULL,
	"coverage_gap" real NOT NULL,
	"strength" real NOT NULL,
	"state" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"from_app" text NOT NULL,
	"to_app" text NOT NULL,
	"kind" text NOT NULL,
	CONSTRAINT "integrations_from_app_to_app_pk" PRIMARY KEY("from_app","to_app")
);
--> statement-breakpoint
CREATE TABLE "line_overrides" (
	"org_id" uuid NOT NULL,
	"line_key" text NOT NULL,
	"rule_id" text NOT NULL,
	"state" text DEFAULT 'marked_fine' NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_overrides_org_id_line_key_rule_id_pk" PRIMARY KEY("org_id","line_key","rule_id")
);
--> statement-breakpoint
CREATE TABLE "org_essentials" (
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"covered" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_essentials_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	CONSTRAINT "org_members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_currency" text DEFAULT 'GBP' NOT NULL,
	"country" text,
	"fy_end_month" integer DEFAULT 3 NOT NULL,
	"fy_end_day" integer DEFAULT 31 NOT NULL,
	"industry" text,
	"markets" text[] DEFAULT '{"UK"}' NOT NULL,
	"include_current_month" boolean DEFAULT false NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"flag_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"rank" integer NOT NULL,
	"match" real NOT NULL,
	"components" jsonb NOT NULL,
	"in_use" boolean NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "recommendations_flag_id_app_id_pk" PRIMARY KEY("flag_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"org_id" uuid,
	"ref" jsonb NOT NULL,
	"ref_hash" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assignee" text,
	"resolution" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "review_queue_kind_ref" UNIQUE("kind","ref_hash")
);
--> statement-breakpoint
CREATE TABLE "shortlist" (
	"org_id" uuid NOT NULL,
	"app_id" text NOT NULL,
	"line_key" text DEFAULT '' NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shortlist_org_id_app_id_line_key_pk" PRIMARY KEY("org_id","app_id","line_key")
);
--> statement-breakpoint
CREATE TABLE "statement_lines" (
	"statement_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"line_key" text NOT NULL,
	"xero_account_id" uuid,
	"code" text,
	"name" text NOT NULL,
	"section" text NOT NULL,
	"category" text,
	"value" numeric(14, 2) NOT NULL,
	"sort" integer NOT NULL,
	CONSTRAINT "statement_lines_statement_id_line_key_pk" PRIMARY KEY("statement_id","line_key")
);
--> statement-breakpoint
CREATE TABLE "statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period_from" date,
	"period_to" date NOT NULL,
	"derived" boolean DEFAULT false NOT NULL,
	"reconciled" boolean,
	"recon_diff" numeric(14, 2),
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_spend" (
	"org_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"contact_name" text NOT NULL,
	"name_norm" text NOT NULL,
	"month" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "supplier_spend_org_id_contact_id_month_source_pk" PRIMARY KEY("org_id","contact_id","month","source")
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"org_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"modified_since" timestamp with time zone,
	CONSTRAINT "sync_cursors_org_id_endpoint_pk" PRIMARY KEY("org_id","endpoint")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"egress_bytes" integer DEFAULT 0 NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "trial_balance" (
	"org_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"xero_account_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"ytd_debit" numeric(14, 2) NOT NULL,
	"ytd_credit" numeric(14, 2) NOT NULL,
	"as_at" date NOT NULL,
	CONSTRAINT "trial_balance_run_id_xero_account_id_pk" PRIMARY KEY("run_id","xero_account_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"xero_user_id" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "xero_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tenant_id" text NOT NULL,
	"connection_id" text,
	"enc_access" "bytea",
	"enc_refresh" "bytea",
	"expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xero_connections_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "account_maps" ADD CONSTRAINT "account_maps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_facts" ADD CONSTRAINT "app_facts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detected_apps" ADD CONSTRAINT "detected_apps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fingerprints" ADD CONSTRAINT "fingerprints_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_feedback" ADD CONSTRAINT "flag_feedback_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flag_feedback" ADD CONSTRAINT "flag_feedback_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_run_id_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_overrides" ADD CONSTRAINT "line_overrides_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_essentials" ADD CONSTRAINT "org_essentials_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shortlist" ADD CONSTRAINT "shortlist_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_statement_id_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statements" ADD CONSTRAINT "statements_run_id_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_spend" ADD CONSTRAINT "supplier_spend_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_balance" ADD CONSTRAINT "trial_balance_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_balance" ADD CONSTRAINT "trial_balance_run_id_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xero_connections" ADD CONSTRAINT "xero_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flags_org_run" ON "flags" USING btree ("org_id","run_id");--> statement-breakpoint
CREATE INDEX "flags_org_line" ON "flags" USING btree ("org_id","line_key");--> statement-breakpoint
CREATE INDEX "review_queue_open" ON "review_queue" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "statements_org_kind" ON "statements" USING btree ("org_id","kind","created_at");