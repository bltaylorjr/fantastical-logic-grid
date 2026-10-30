-- Ideas, problems, feedback and a short survey from educators (educators.js).
-- The section opens with a private link in the email that carries their PDFs:
-- feedback_key is that link's key, kept only until the package is marked sent;
-- from then on only its hash (feedback_hash) is kept.
ALTER TABLE educator_requests ADD COLUMN feedback_key TEXT;
ALTER TABLE educator_requests ADD COLUMN feedback_hash TEXT;

-- kind: survey (answers as JSON, one per request), idea, problem or feedback.
-- status: new or addressed. reply_mail = 1 while the "we answered you" email
-- waits for the GitHub Action.
CREATE TABLE IF NOT EXISTS educator_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,                        -- the team's answer, in plain words (emailed)
  addressed_at INTEGER,
  addressed_by TEXT,
  reply_mail INTEGER NOT NULL DEFAULT 0,
  mail_tries INTEGER NOT NULL DEFAULT 0,
  mail_claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS educator_feedback_request ON educator_feedback (request_id, kind);
CREATE INDEX IF NOT EXISTS educator_feedback_status ON educator_feedback (kind, status, created_at);
CREATE INDEX IF NOT EXISTS educator_feedback_mail ON educator_feedback (reply_mail);
