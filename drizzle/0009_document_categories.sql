-- Document kinds become rows the koperasi can add to, instead of an enum
-- frozen in four places. The four kinds the site shipped with are seeded so
-- every existing document keeps its slug and its place on the shelf.
CREATE TABLE "document_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(60) NOT NULL,
	"icon" varchar(40),
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_categories_slug_uq" ON "document_categories" USING btree ("slug");
--> statement-breakpoint
INSERT INTO "document_categories" ("name", "slug", "icon", "sort_order") VALUES
	('Laporan Tahunan', 'laporan', 'file-text', 10),
	('Laporan Keuangan', 'keuangan', 'chart', 20),
	('Legalitas & Perizinan', 'legalitas', 'briefcase', 30),
	('Dokumen Lainnya', 'lainnya', 'folder', 40)
ON CONFLICT DO NOTHING;
