#!/usr/bin/env node
// Command line generator.
//   node cli.js --difficulty hard --theme mystery --clues 12 --seed abc
//   node cli.js --difficulty mensa --json > puzzle.json
//   node cli.js --options        (list difficulties, themes and clue types)
import { generatePuzzle, formatPuzzleText, describeOptions } from './src/index.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

if (flag('help')) {
  console.log(`Options:
  --difficulty basic|easy|medium|hard|expert|mensa   (default easy)
  --theme <id>|random                                (default random)
  --categories <3-6>  --items <3-8>                  (default: the tier's size)
  --clues <n>          target number of clues
  --types a,b,c        only these clue types (see --options)
  --names "A,B,C"      custom cast names
  --title "..."        custom title
  --questions <1-6>    story questions (default 3)
  --seed <text>        same seed + options = same puzzle
  --json               print the full puzzle JSON
  --no-key             leave the answer key out of the text
  --options            list difficulties, themes and clue types`);
  process.exit(0);
}
if (flag('options')) {
  console.log(JSON.stringify(describeOptions(), null, 2));
  process.exit(0);
}

const num = (v) => (v != null ? Number(v) : undefined);
const puzzle = generatePuzzle({
  difficulty: value('difficulty') || 'easy',
  theme: value('theme') || 'random',
  categories: num(value('categories')),
  items: num(value('items')),
  clueCount: num(value('clues')),
  clueTypes: value('types') ? value('types').split(',') : undefined,
  customNames: value('names') ? value('names').split(',') : undefined,
  title: value('title'),
  questions: num(value('questions')),
  seed: value('seed'),
});

if (flag('json')) console.log(JSON.stringify(puzzle, null, 2));
else {
  console.log(formatPuzzleText(puzzle, { answerKey: !flag('no-key') }));
  if (puzzle.notes.length) console.log('\nNotes:\n  ' + puzzle.notes.join('\n  '));
  console.log(`\nSeed: ${puzzle.seed}  ·  ${puzzle.stats.clueCount} clues  ·  difficulty score ${puzzle.stats.difficultyScore}`);
}
