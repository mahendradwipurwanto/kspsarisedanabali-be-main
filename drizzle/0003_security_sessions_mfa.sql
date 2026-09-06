ALTER TABLE "refresh_tokens" ADD COLUMN "revoked_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by_id" uuid;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "label" varchar(120);--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "signing_key" text;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "mfa_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;