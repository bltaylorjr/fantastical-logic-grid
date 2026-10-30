-- Approve or Disapprove an idea or problem in admin > Communication.
-- Approved ones (status 'approved') wait for the weekly improvement run and
-- its Claude task to fix them; Disapproved ones are closed (status 'done',
-- declined = 1) and the player gets the plain thank-you if they asked for email.
ALTER TABLE feedback ADD COLUMN approved_at INTEGER;
ALTER TABLE feedback ADD COLUMN approved_by TEXT;
ALTER TABLE feedback ADD COLUMN declined INTEGER NOT NULL DEFAULT 0;
