-- Book Studio (admin/book-studio/): the owner can let any admin publish books
-- with a per-admin switch. The owner and admins always can, and the new
-- "publisher" role (Book Studio only, nothing else in the dashboard) always can.
ALTER TABLE admins ADD COLUMN publishing INTEGER NOT NULL DEFAULT 0;
