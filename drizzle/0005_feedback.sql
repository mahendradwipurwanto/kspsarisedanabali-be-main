CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(20) DEFAULT 'saran' NOT NULL,
	"rating" integer,
	"name" varchar(160),
	"email" varchar(200),
	"phone" varchar(40),
	"subject" varchar(200),
	"message" text NOT NULL,
	"branch_id" uuid,
	"status" varchar(20) DEFAULT 'baru' NOT NULL,
	"note" text,
	"handled_by_id" uuid,
	"handled_at" timestamp with time zone,
	"source" varchar(30) DEFAULT 'feedback_form' NOT NULL,
	"session_id" varchar(64),
	"referrer" text,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_created_idx" ON "feedback" USING btree ("created_at");