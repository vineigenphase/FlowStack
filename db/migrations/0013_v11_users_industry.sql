ALTER TABLE "users" ADD COLUMN "job_title" text;
--> statement-breakpoint
-- v1.1 P: the SaaS industry key is now 'saas'.
UPDATE "orgs" SET "industry" = 'saas' WHERE "industry" = 'saas_tech';
