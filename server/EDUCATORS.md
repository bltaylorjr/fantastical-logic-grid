# Educator puzzle packages

Teachers ask for free printable puzzle packages on the website's Educators page
(https://thelogicgrid.com/educators/, website only, not the desktop app). The
link sits in the top corner of the game page, "For educators".

## How a request moves

1. **The form** (`seo/educators.js`, built into the page by `scripts/seo.mjs`).
   The educator gives their name, school email, school and role, then the
   package: grade level, how many different puzzles (1 to 30), difficulty
   (suited to the grade, builds up from easier to harder, or one level), grid
   size, themes and topics or their own fully custom theme (name, story, cast,
   character names, 2 to 4 categories with their items, how to say a match,
   ordered lists), character names, clue types, questions per puzzle, paper
   size, answer keys, worked solutions, large print, a package title and a note.
   Every choice and every check lives in `engine/src/classroom.js`, shared by
   the page, the Worker and the builder.
2. **School email check** (`server/src/educators.js`). Personal mailboxes
   (Gmail, Outlook, Yahoo and similar) are refused unless the admin setting
   "Accept personal email addresses" is on. A 6-digit code is emailed to the
   address; the educator types it on the page or clicks the link in the email.
   The code is stored only as a hash, works for 2 days and allows 6 tries; up
   to 3 new codes. At most 3 requests per address a day, and "New educator
   requests a day" for everyone.
3. **Review** in the admin dashboard, **Educator requests**. Each request
   shows a badge: School address, Check the school (not a known school
   domain) or Personal email. **Approve and send** or **Decline** (with a
   polite email and your note).
4. **Build and email**: `.github/workflows/educator-packages.yml` runs
   `scripts/educator-packages.py` every 5 minutes. It sends waiting code and
   decline emails, builds each approved package with
   `scripts/educator-package.mjs` (the game's own engine; Chromium prints the
   PDFs) and emails `puzzles.pdf` (cover page and puzzles) and, by default,
   `answer-keys.pdf` to the verified address. Package stories are never used
   twice: the Worker keeps every sent story id and hands them to the builder.

5. **Ideas, problems, feedback and a survey** (`educators/feedback/`, website
   only, not in search). The package email carries a private link
   (`?ref=&key=`) that opens the educator's own section once the PDFs are sent:
   a 2-minute survey on how they used the puzzles and what would help them
   (questions in `EDUCATOR_SURVEY`, `engine/src/classroom.js`) and a box for
   an idea, a problem or feedback, with the team's answers shown under it.
   The key is kept only until the package is marked sent, then only its hash.
   In the admin dashboard, **Educator feedback** lists the notes apart from
   players' notes; **Answer** marks one answered and emails the educator the
   answer (write it in plain, everyday words). **Survey results** counts each
   answer and lists the comments.

## What suits each grade

| Grades | Levels offered first | Grid | Story |
| --- | --- | --- | --- |
| K to 2 | Basic | 3 × 3 | Who is in it, what to match, the question; large print |
| 3 to 5 | Basic, Easy, Medium | 3 × 4 | Adds the opening scene; large print |
| 6 to 8 | Easy, Medium, Hard | 4 × 4 | The full story |
| 9 to 12 | Medium, Hard, Expert | 4 × 5 | The full story |
| College and adult | Any | 4 × 5 | The full story |

The educator can still pick any level and any size that fits on paper (3 to 5
categories, 3 to 6 items).

## Setup

Nothing new is needed: it uses the same secrets as the thank-you emails
(`FLG_ADMIN_TOKEN`, `GMAIL_USER` + `GMAIL_APP_PASSWORD`, optionally
`RESEND_API_KEY`). The database table comes from `migrations/1900_educators.sql`,
applied by the normal deploy.

Optional, for faster emails: the Worker secret `GITHUB_DISPATCH_TOKEN` (a
fine-grained GitHub token for this repository with Actions read and write).
With it the Worker starts the Action as soon as a form is sent or a request is
approved, instead of waiting for the next 5-minute run. Steps: admin dashboard,
Connections and setup, "Educator emails straight away".

## Switches (Settings and switches > Educators)

- **Educator puzzle packages**: off pauses new requests.
- **New educator requests a day**: default 30.
- **Most puzzles in one package**: default 30.
- **Accept personal email addresses**: default off.

Free throughout: GitHub Actions on a public repository, Resend's free plan or
Gmail, and Cloudflare's free Worker and D1.

## Marketing and tracking

The `educators-2026` campaign (server/src/marketing-seed.js) holds 20 draft
ads for teachers, schools and districts, all opening `/educators/` with
their own tracked link. Every page of the website counts a visit from a
campaign link the same way the game does (web/js/page-visit.js), and the
Educators form sends the campaign tags the teacher arrived with. The Worker
keeps them on the request (`educator_requests.campaign`, migration 1915) and
counts three steps for that campaign, channel and ad in the Marketing
numbers: `edu_request` (form sent), `edu_confirm` (school email confirmed)
and `edu_sent` (package emailed). These can only be counted by the Worker,
never sent to `/v1/m`. Requests with no campaign or referring site are not
counted there, but are all listed in Educator requests, where each request
also says which channel and ad it came from.
