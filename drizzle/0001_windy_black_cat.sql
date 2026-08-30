ALTER TABLE "products" ADD COLUMN "is_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rate_source" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "verified_by_id" uuid;