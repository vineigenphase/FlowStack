ALTER TABLE "detected_apps" ADD COLUMN "last_paid_date" date;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "books_through" date;--> statement-breakpoint
ALTER TABLE "supplier_spend" ADD COLUMN "last_date" date;