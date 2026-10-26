# Owner tasks

Things that only the owner can do outside the code: DNS records, secrets,
dashboard switches and account settings. Every Markdown file in this folder
(except this README) is emailed to **fantasticallogicgrid@gmail.com** by the
**Owner task email** workflow (`.github/workflows/owner-email.yml`,
`scripts/owner-email.py`) when it reaches `main`.

## How to send one (for anyone changing the code)

1. Add a file named `YYYY-MM-DD-short-name.md` here in the same pull request as
   the change that needs it.
2. Start it with a `# ` heading. That becomes the subject, after "To do: ".
3. For each task, write what needs doing and why, numbered steps, and links.
4. Merge. The file is emailed once when it lands on `main`. Editing it later
   emails it again, so change an old file only when there is something new.

To send without a pull request, use **Actions > Owner task email > Run
workflow**. Give it a file path, or give it a subject and a Markdown body.

Rules:

- **No secrets.** Name a secret (for example `RESEND_API_KEY`), never its value.
  The repository and its logs are public.
- Skip mobile app tasks while the mobile apps are paused.
- Use only free services. Flag anything that could cost money.

It needs the repository secrets `GMAIL_USER` and `GMAIL_APP_PASSWORD`, which
the weekly archive email already has (see `server/ARCHIVE.md`). The optional
secret `OWNER_TASKS_TO` sends to a different address.
