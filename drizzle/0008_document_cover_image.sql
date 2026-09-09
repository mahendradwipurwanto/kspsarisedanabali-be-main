-- A document may carry cover artwork, so the Laporan Keuangan page can shelve
-- reports the way an annual-report archive does: cover, year, title. Optional;
-- a document without one keeps rendering with the placeholder mark.
ALTER TABLE "documents" ADD COLUMN "cover_image" text;
