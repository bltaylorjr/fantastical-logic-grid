-- Classroom puzzle packages for educators (educators.js). One row per request
-- from the website's Educators page. The educator proves the school address
-- with a code emailed to it; the team approves or declines in the admin
-- dashboard; the GitHub Action educator-packages.yml then builds the PDFs and
-- emails them to that verified address.
--
-- status: unverified (code sent), pending (verified, waiting for the team),
-- approved (waiting to be built), building, sent, declined, failed, expired.
-- mail: which email waits for the Action (verify, declined) or NULL.
CREATE TABLE IF NOT EXISTS educator_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,         -- short public reference the page and emails use
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  school TEXT NOT NULL,
  role TEXT NOT NULL,
  grade TEXT NOT NULL,
  count INTEGER NOT NULL,
  request TEXT NOT NULL,            -- the cleaned request (JSON, classroom.js checkRequest)
  domain_kind TEXT NOT NULL,        -- school, unknown or personal (classroom.js schoolEmail)
  status TEXT NOT NULL DEFAULT 'unverified',
  code_hash TEXT,                   -- SHA-256 of the emailed code; cleared once verified
  mail TEXT,                        -- the email waiting to go: verify or declined
  mail_code TEXT,                   -- the code itself, only until the verify email is sent
  mail_tries INTEGER NOT NULL DEFAULT 0,
  mail_claimed_at INTEGER,
  verify_tries INTEGER NOT NULL DEFAULT 0,
  resends INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  reviewed_at INTEGER,
  reviewed_by TEXT,
  note TEXT,                        -- the team's note: a decline reason (emailed) or a remark
  build_tries INTEGER NOT NULL DEFAULT 0,
  build_claimed_at INTEGER,
  sent_at INTEGER,
  puzzles INTEGER,                  -- how many puzzles went out
  story_ids TEXT                    -- JSON list of the stories used, so none is used again
);
CREATE INDEX IF NOT EXISTS educator_requests_status ON educator_requests (status, created_at);
CREATE INDEX IF NOT EXISTS educator_requests_email ON educator_requests (email, created_at);
CREATE INDEX IF NOT EXISTS educator_requests_mail ON educator_requests (mail);
