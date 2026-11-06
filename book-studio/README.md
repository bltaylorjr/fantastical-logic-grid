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

Books are kept in the browser that made them (IndexedDB). **Project > Save project file**
keeps a copy or moves a book to another computer.

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
