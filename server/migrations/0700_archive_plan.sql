-- The weekly archive sent by the GitHub Action (archive.js exportArchive):
-- which rows a zip holds (JSON [{ table, cutoff, maxRowid }]), kept until the
-- email is confirmed so exactly those rows are removed.
ALTER TABLE archive_log ADD COLUMN plan TEXT;
