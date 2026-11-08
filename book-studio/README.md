# Book Studio

The puzzle book editor inside Grid Admin, at **https://flg-api.btay74.workers.dev/admin/book-studio/**.
It edits a whole book page by page, generates Sudoku, word search and maze puzzles with an
answer key, designs the full-wrap cover, and with one click applies a publisher's print
specs (Amazon KDP, IngramSpark, Lulu, Barnes & Noble Press, Draft2Digital Print, Bookvault)
and exports a submission packet: interior PDF, cover PDF, front-cover JPG, metadata sheet,
preflight report and an upload checklist.

It is separate from **Books and covers** (`admin/books.js`), which builds books from the
games' own puzzle engines. Book Studio is a free-form editor for any puzzle book, including
imported manuscripts (.docx, .odt, .rtf, .txt, .md, .html, .epub, .pdf, .csv) and images.

## Who can use it

- The owner and every **admin**.
- A **publisher**: a role that opens Book Studio and nothing else in the dashboard. Add them
  under Admins > Role > Publisher, then send them the link above.
- A **moderator** or **viewer** when the owner ticks **Can publish books** for them under Admins.

The page asks `GET /admin/v1/me` (`canPublish`) when it opens, and checks in with
`POST /admin/v1/publishing/export` before every export, so taking access away works at
once and every exported book (title, publisher, page count) is in the audit log. Book Studio has its
own sign-in screen, sharing Grid Admin's session (signing in to one signs in to both, same
1-hour idle lock):

- **Email and password** (the game's accounts). Someone the owner has added can press
  **First time? Create your password**; they confirm their email from the link before the
  server says anything about their access. **Forgot password?** sends a reset link.
- **Face ID, fingerprint or Windows Hello** (passkeys, through `admin/passkeys.js`). After a
  password sign-in on a device that has one, Book Studio offers to set it up; **Set up Face ID
  or fingerprint** at the top does it later. Devices are listed and removed in Grid Admin
  under Face ID and fingerprint (owner, admins and the rest of the dashboard's roles).

**Grid books** (Grid Admin only) is the dashboard's Books and covers (`admin/books.js`) inside
Book Studio: books made from the game's own puzzles, never reusing one. **Open in the editor**
turns a book into editor pages (`src/gridbooks.js`): text pages stay editable, puzzles and
answer keys are fixed blocks shrunk to fit, and the cover comes in as one picture. Anyone
who may publish books may make, save and publish Grid books.

## Sync and the app

Every book is saved in the browser first (IndexedDB), then synced to the signed-in account a
few seconds later (`src/sync.js`, server `server/src/studio-sync.js`, tables `studio_books` and
`studio_book_parts`). Sign in with the same email on another computer, phone or the app and
the newest book opens; **Project > Your books on every device** lists them all, opens one or
removes it from the account. The status bar says Synced, Offline or what went wrong.

- Books belong to the account that saved them; nobody else sees them. Up to 15 MB a book,
  200 books and 300 MB per account (pictures are most of the size).
- If two devices change the same book before syncing, nothing is overwritten: the second
  device's version is kept as its own book, "Title (Windows copy)".
- One browser, two people: the book left open by one account is set aside for them, never
  synced to the next account that signs in.
- **Get the app** (top bar, hidden inside the app): the Windows app (`desktop-book-studio/`,
  released by `.github/workflows/book-studio-desktop.yml` to the `book-studio-desktop` release)
  and, everywhere else, installing the page itself (`manifest.webmanifest`, `sw.js`, both written
  by `build.mjs`). Installed, it opens with no connection for someone who ticked "Keep me signed
  in" and syncs when the connection is back. Exports still need a connection, because each one
  checks in with the server.

**Project > Save project file** still keeps a copy on disk. Opening a project file makes it a
new book on the account, so it never replaces a synced one.

## Changing it

The code is in `book-studio/src/` (one page: `shell.html`, then `specs.js`, `core.js`,
`editor.js`, `puzzles.js`, `import.js`, `cover.js`, `publish.js`, `main.js`, and `auth.js`
for the Grid Admin sign-in). Build it into `admin/book-studio/` with:

```
npm --prefix book-studio ci
node book-studio/build.mjs
```

CI rebuilds it and fails if `admin/book-studio/` is out of date, then runs
`scripts/e2e-book-studio.cjs` against the real Worker. `node book-studio/build.mjs --standalone`
writes a single-file copy with no sign-in to `dist/book-studio.html` (libraries from a CDN).

Publisher numbers live in `specs.js` and follow the publisher spec sheet compiled on
2026-11-05. Some are safe defaults where a publisher does not publish a number; the app
says so and links each publisher's own calculator.

PDFs are 300 DPI images of each page (grayscale for black-and-white interiors). KDP accepts
them; IngramSpark prefers PDF/X-1a, so run its upload validator. Paperback only for now.
