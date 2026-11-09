ALTER TABLE "flag_feedback" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "flag_feedback" ADD COLUMN "app_name" text;--> statement-breakpoint
ALTER TABLE "line_overrides" ADD COLUMN "until" date;--> statement-breakpoint
ALTER TABLE "line_overrides" ADD COLUMN "app_id" text;