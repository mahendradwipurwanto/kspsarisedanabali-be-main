ALTER TABLE "pages" ADD COLUMN "show_in_footer" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Keep the footer showing exactly what it shows today: until now the row was
-- every published page that is not a fixed route. Anything unwanted there is
-- one switch away in the console.
UPDATE "pages" SET "show_in_footer" = true WHERE "is_system" = false AND "status" = 'published' AND "deleted_at" IS NULL;
