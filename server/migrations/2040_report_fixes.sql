-- Automatic code fixes for reported problems (server/PUZZLE-REPORTS.md, "Code
-- fixes"): when a merged pull request says "Fixes reports: PZ-..., WS-...",
-- the Report fixes Action closes those reports with the PR's plain-language
-- player note and the version the fix shipped in. A puzzle report that needed
-- a fix in the puzzle maker goes back to the doctor first; the note waits here
-- in case the rebuilt engine finds nothing left to repair.
ALTER TABLE puzzle_reports ADD COLUMN fix_note TEXT;
ALTER TABLE puzzle_reports ADD COLUMN fixed_in TEXT;
