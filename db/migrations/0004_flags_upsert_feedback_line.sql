ALTER TABLE "flag_feedback" ADD COLUMN "line_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_run_line" UNIQUE("run_id","line_key");