# Reference: Story parts

Every story is built from one part of each kind, picked fresh for each puzzle. Full rules and examples: the Author Packet (`authors/packet/`).

| Kind | The code calls it | What it does | Fill-ins |
| --- | --- | --- | --- |
| Title word | `adjs` | "The ___ Snowman" | none |
| Opening | `openings` | Sets the scene and the head count | `{n}` `{N}` `{many}` |
| Incident | `incidents` | What is at stake: `{ name, text, prize }` | none |
| Mix-up | `mishaps` | Why the facts got scrambled | none |
| Lead | `leads` | Ties the answer to one category | `{x}` |
| Ending | `endings` | The reward on solve | `{Fact}` `{winner}` `{prize}` |

## How a story comes together

```
[opening] [incident] [mix-up]          <- first paragraph
The cast are Ada, Basil and Clara.
Use the clues to match ... [lead]
The one who ... is behind [prize]. Can you work out who ...?
```

## Rules

1. Never name a grid item or a cast name in a part: it reads like a clue.
2. Never write the head count as a number; `{n}` keeps it right at every size.
3. About 10 to 25 words per part. The whole story stays under 150.
4. Add new parts at the **end** of a list. Stories remember parts by position.
5. Your own words only, which keeps them yours under copyright.

## In the code

```js
mishaps: [
  'The holiday letter went out with all the names mixed up.',
  'Your new sentence goes at the end.',
],
```

Single quotes around each sentence, a comma after each, and `\'` for an apostrophe. See [JavaScript lists](javascript-lists.md).
