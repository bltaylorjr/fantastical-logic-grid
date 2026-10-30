# Reference: HTML text

HTML is the page's structure: each piece of content sits between an **opening tag** and a **closing tag**.

```html
<p class="muted">Both are always at the top of the page.</p>
 │  └──────────┘ └──────────────────────────────────────┘ └─┘
 │  attribute     content: the words players see           closing tag
 opening tag
```

## Tags you'll meet

| Tag | Means | Example |
| --- | --- | --- |
| `<h1>` to `<h3>` | Headings, biggest to smallest | `<h2>Tips and tricks</h2>` |
| `<p>` | A paragraph | `<p>Solve it in five minutes.</p>` |
| `<b>` | Bold words inside a sentence | `Try <b>How to play</b> first.` |
| `<a href="...">` | A link | `<a href="/terms/">Terms</a>` |
| `<button>` | A button the game listens to | leave these alone |
| `<div>` | A box that groups things | leave these alone |

## Attributes: look, but don't touch

| Attribute | What it does | Safe to change? |
| --- | --- | --- |
| `id="..."` | The game's code finds the element by this name | **No** |
| `class="..."` | Picks the look from the style sheet | Only when a task says so |
| `aria-...="..."` | Helps screen readers | **No** |
| `hidden` | Hides it until the game shows it | **No** |

## Rules that prevent most mistakes

1. Change the words **between** tags, not the tags.
2. Every opening tag keeps its closing tag: `<p>` ... `</p>`.
3. To write `<` or `>` as text, use `&lt;` and `&gt;`. To write `&`, use `&amp;`.
4. Apostrophes and quotes in words are fine in HTML text.
5. Read it aloud: players can hear the page read out, so it should sound natural.

## Common mistakes

| Mistake | What happens | Fix |
| --- | --- | --- |
| Deleted a `</p>` | The next part of the page joins your paragraph | Put the closing tag back |
| Changed an `id` | A button or box stops working | Undo; the tests usually catch this |
| Typed `<` in a sentence | The browser thinks a tag starts | Use `&lt;` |
