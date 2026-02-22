ALTER TABLE "ticket_forms" ALTER COLUMN "field_ids" SET DATA TYPE bigint[];--> statement-breakpoint
ALTER TABLE "ticket_forms" ALTER COLUMN "field_ids" SET DEFAULT '{}';