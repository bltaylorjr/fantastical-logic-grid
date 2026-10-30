# Writing stories for The Fantastical Logic Grid

Stories come in through one standard form, `submissions/TEMPLATE.md`. Each
filled-in copy is checked automatically against the same rules the game's
tests use, then added to the game. The full Author Packet (Writing Guide PDF
and fillable Word form) has the writing rules with examples.

## Step by step: upload a story on GitHub's website

No coding or tools needed beyond a web browser and a GitHub account.

1. **Get the form.** Open
   [authors/submissions/TEMPLATE.md](submissions/TEMPLATE.md) on GitHub, click the
   **Download raw file** button (the arrow at the top right of the file), and save it.
2. **Name it.** Rename your copy to your topic id, for example `snow-day.md`.
   Lowercase letters, numbers and dashes only.
3. **Fill it in.** Open it in any plain text editor (Notepad, TextEdit in plain text
   mode, or VS Code). Type after each colon and dash. Leave lines that start with `>`
   alone. If you drafted in the Word form, copy each answer into the matching line.
4. **Upload it.** Go to the repository on GitHub, open the `authors` folder, then
   `submissions`. Click **Add file > Upload files**, and drag your file in.
5. **Describe the change.** Under *Commit changes*, write a short message such as
   `Add story submission: snow-day`.
6. **Use a new branch.** Choose **Create a new branch for this commit and start a
   pull request**, then click **Propose changes**, then **Create pull request**.
7. **Read the check.** Within a minute, the pull request shows **Story submission
   check**. A green check mark means it is ready. A red X means something needs
   fixing: click **Details** to see each item marked `FIX`, in plain English.
8. **Fix and re-check.** In the pull request, open **Files changed**, click the
   **...** menu on your file, choose **Edit file**, make the fix, and commit it to
   the same branch. The check runs again by itself.
9. **Ask for it to be added.** When the check is green, comment on the pull request
   (or ask Claude) to add the topic to the game. The story text stays exactly as you
   wrote it; only the code around it is added.

Upload from your own GitHub account. Your commit is the dated record that you
wrote the story, which matters for copyright.

## Check a file yourself (optional)

If you have Node.js installed, from the repository folder:

```
node scripts/check-story-submission.mjs authors/submissions/snow-day.md
node scripts/check-story-submission.mjs --themes        # the theme ids
node scripts/check-story-submission.mjs --emit authors/submissions/snow-day.md   # also prints the code for topics.js
```

`FIX` lines must be fixed; `CHECK` lines are worth a second look but don't block.
When a file passes, the checker prints a sample story built from it and how many
different storylines it can tell.

## The rules in short

- Write every story part yourself, in your own words.
- At least 5 categories, one of them numbered (a time or a number); 8 items in each plain category; no item or cast name used twice.
- Never name a category item or a cast name in any story part; it reads like a clue.
- Openings use `{n}` or `{N}` and `{many}`; leads use `{x}`; endings use `{Fact}`.
- Stories stay under 150 words, so keep each part to about 10 to 25 words.
- History topics: real people, dates and places go only in the Fact card, with a source link you actually read.

Optional fields for numbered categories, when the checker can't work out the
"by" phrase from yours: `Fewer by phrase` / `More by phrase` (Type: number) or
`Earlier by phrase` / `Later by phrase` (Type: time), each with `{d}` where the
gap goes, for example `walked {d} fewer than`.
