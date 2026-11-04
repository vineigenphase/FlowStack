-- Row-level security (BACKEND.md §12). The app runs tenant queries as flowstack_app inside withOrg(),
-- which sets app.org_id for the transaction. Admin/queue code uses the owner connection (no SET ROLE).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowstack_app') THEN
    CREATE ROLE flowstack_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT flowstack_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO flowstack_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON orgs USING (id = app_org_id()) WITH CHECK (id = app_org_id());
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON orgs TO flowstack_app;
--> statement-breakpoint
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON org_members USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON org_members TO flowstack_app;
--> statement-breakpoint
ALTER TABLE xero_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON xero_connections USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON xero_connections TO flowstack_app;
--> statement-breakpoint
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON sync_runs USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_runs TO flowstack_app;
--> statement-breakpoint
ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON sync_cursors USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_cursors TO flowstack_app;
--> statement-breakpoint
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON accounts USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts TO flowstack_app;
--> statement-breakpoint
ALTER TABLE account_maps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON account_maps USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON account_maps TO flowstack_app;
--> statement-breakpoint
ALTER TABLE statements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON statements USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON statements TO flowstack_app;
--> statement-breakpoint
ALTER TABLE statement_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON statement_lines USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON statement_lines TO flowstack_app;
--> statement-breakpoint
ALTER TABLE trial_balance ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON trial_balance USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON trial_balance TO flowstack_app;
--> statement-breakpoint
ALTER TABLE supplier_spend ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON supplier_spend USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_spend TO flowstack_app;
--> statement-breakpoint
ALTER TABLE detected_apps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON detected_apps USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON detected_apps TO flowstack_app;
--> statement-breakpoint
ALTER TABLE flags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON flags USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON flags TO flowstack_app;
--> statement-breakpoint
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON recommendations USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendations TO flowstack_app;
--> statement-breakpoint
ALTER TABLE flag_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON flag_feedback USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON flag_feedback TO flowstack_app;
--> statement-breakpoint
ALTER TABLE line_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON line_overrides USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON line_overrides TO flowstack_app;
--> statement-breakpoint
ALTER TABLE org_essentials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON org_essentials USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON org_essentials TO flowstack_app;
--> statement-breakpoint
ALTER TABLE shortlist ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON shortlist USING (org_id = app_org_id()) WITH CHECK (org_id = app_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON shortlist TO flowstack_app;
--> statement-breakpoint
GRANT SELECT ON apps TO flowstack_app;
--> statement-breakpoint
GRANT SELECT ON fingerprints TO flowstack_app;
--> statement-breakpoint
GRANT SELECT ON integrations TO flowstack_app;
--> statement-breakpoint
GRANT SELECT ON app_facts TO flowstack_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO flowstack_app;
