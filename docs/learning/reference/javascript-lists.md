# Reference: JavaScript lists and lookup tables

Much of the game's content is stored as plain data in JavaScript: lists and lookup tables. Editing data is the safest way to start with JavaScript.

## A list (array): items in order

```js
['⭐', '🌠', '✨']
 │    │    └─ third item
 │    └─ items are separated by commas
 └─ square brackets hold the list
```

- Text goes in **single quotes**: `'Mint tea'`.
- An apostrophe inside text needs a backslash: `'Grandma\'s recipe'`.
- Numbers need no quotes: `[5, 10, 15]`.

## A lookup table (object): names to values

```js
const FALLING = {
  holiday: ['❄️', '❄️', '⛄'],
  parks: ['🍂', '🍁', '🍃'],
};
```

| Piece | Meaning |
| --- | --- |
| `const FALLING =` | The table's name. |
| `{ ... };` | Curly braces hold the table. |
| `holiday:` | A key (the name to look up), then a colon. |
| `['❄️', ...]` | The value for that key, here a list. |
| `,` after each entry | Separates entries. A trailing comma after the last entry is fine. |

The game looks things up like this: `FALLING['holiday']`, or `FALLING.holiday`, gives the holiday list.

## Rules that prevent most mistakes

1. Copy an existing line and change it, so the pattern stays the same.
2. Count the brackets: every `[` has a `]`, every `{` has a `}`.
3. Every item and every entry ends with a comma.
4. Keys are lowercase ids exactly as the game spells them (`scifi`, not `SciFi`).
5. When adding to a list the game remembers by position (story parts), add at the **end**.

## Common mistakes

| Mistake | What happens | Fix |
| --- | --- | --- |
| Missing comma between items | The whole file fails to load | Add the comma |
| `'` inside text with no `\` | The text ends early; the file fails | Write `\'` |
| Smart quotes `‘ ’` from Word | The file fails | Type plain `'` in the GitHub editor |
| Misspelled key | Nothing happens; the game uses its default | Match the id exactly |

The **Tests** check on your pull request catches a broken file before players see it.
