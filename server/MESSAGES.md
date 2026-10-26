# Messages and the Communication section

Players and the game's team can write to each other inside the game, and the
admin dashboard's **Communication** section brings everything players send
into one inbox. All of it runs on the free Cloudflare plan (Worker + D1); the
optional email notices use the same free sender as the thank-you emails
(`FEEDBACK-EMAILS.md`).

## In the game: Menu > Messages

- **News from the team**: a title and a few lines, written in the dashboard,
  shown to everyone (signed in or not). The newest five show. It comes with
  `GET /v1/config`, so it costs no extra requests.
- **You and the team** (signed in): write to the team (a question, an idea or
  a problem), read the team's replies and answer. Replies are signed
  "The team"; players never see which admin wrote.
- **Email me when the team writes**: a short no-reply notice, at most one a
  day, never with the message itself. Needs a confirmed email. Turning it off
  removes the stored address.
- **Ideas and problems**: signed-in players can tick "Let the team reply to
  me in Messages". Only then is that one idea or problem linked to their
  account (through a new conversation). Every other idea and problem stays
  anonymous.
- **Addressed**: when the team marks a linked idea or problem addressed in the
  dashboard (a short plain note of what was done, and optionally the version),
  the player gets that note as a reply from the team in Messages: "Good news:
  we've addressed your idea in version 1.7.2. What we did: ...". If they
  also ticked "Email me an update", the note (with the version) goes by
  email as well (see `FEEDBACK-EMAILS.md`), and no separate "new message"
  notice is sent. Anonymous ideas and problems are only marked. See
  `src/followups.js`.
- **Puzzle details**: an idea or problem sent while a puzzle is open carries
  that puzzle's story id, title, theme, topic, difficulty, seed, size, engine
  version and clue texts (`feedback.puzzle`), unless the player unticks
  "Include the puzzle I'm playing". Nothing about the player: no marks, notes
  or name. The inbox shows it under the message.
- The Menu button and the Messages item show a number for unread replies and
  news not seen on this device. The game checks every 10 minutes while open.

## In the dashboard: Communication

- **Inbox**: messages, ideas, problems, error reports and the log of emails to
  players in one list, newest first. Filter by kind, by new/open, done or all,
  and by words. Open a conversation to read it and reply; tick "Mark done
  after sending", or use Mark done and Reopen. A player's reply reopens a done
  conversation.
- **Send to players**: message one player (screen name or player id, or Send a
  message on their page under Players), news for everyone's Messages, and the
  home-screen banner (announcements).
- The old links `#feedback`, `#errors` and `#announcements` open Communication.

| Role | Can |
|---|---|
| Viewer | see error reports, the email log, news and banners (not what players wrote) |
| Moderator | read and answer messages, ideas and problems; mark them done |
| Admin | also write to a player first, publish news and banners, delete conversations |

Every dashboard request is in the audit log.

## Limits

- A player: 20 messages a day, at most 5 open conversations they started, and
  30 requests a minute (`LIMIT_MESSAGES`, namespace 41060). Banned players can
  read but not send.
- Everyone together: 2,000 player messages a day; the team 500 messages a day.
- Text: players up to 1,000 characters (email and web addresses and long
  numbers are blanked), the team up to 2,000, news up to 1,500.
- Switches (Settings and switches > Messages): **Messages between players and
  the team** (off hides Messages and stops new ones) and **Email players when
  the team writes** (also needs Thank-you emails on, and counts toward its
  daily cap).

## Data (migration `1300_messages.sql`)

`conversations`, `conversation_messages`, `message_contacts` (only players who
turned email notices on) and `news`; `feedback.conversation_id` links an idea
or problem when the player asked for a reply. The daily cleanup removes done
conversations after 180 days, any conversation idle for a year, and news 90
days after it ends. Deleting an account removes its conversations and address.
