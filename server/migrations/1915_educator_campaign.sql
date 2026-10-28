-- The campaign an educator's request came from (educators.js): the cleaned
-- campaign tags as JSON { c, s, m, k }, or NULL. Used to count requests,
-- confirmed addresses and packages sent in the admin Marketing numbers.
ALTER TABLE educator_requests ADD COLUMN campaign TEXT;
