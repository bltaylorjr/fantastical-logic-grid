// Building blocks for topics (topics.js and the more-topics-*.js files):
// categories, numbered categories and their scales, in the shape themes.js uses.
import { clock, plural, money } from './themes.js';

export { clock, plural, money };
export const cat = (id, name, pos, neg, items, extra = {}) => ({ id, name, pos, neg, items, ...extra });
export const ord = (id, name, pos, neg, o, extra = {}) => ({ id, name, pos, neg, ordinal: o, ...extra });
export const countOrd = (start, step, label, less, more, lessBy, moreBy, gap) => ({
  start, step, count: 8, label: label || ((v) => String(v)), less, more, lessBy, moreBy, gap,
});
export const ageOrd = (start, step) => countOrd(start, step, null, 'is younger than', 'is older than',
  'is {d} younger than', 'is {d} older than', (s) => plural(s * step, 'year', 'years'));
export const timeOrd = (verb, startMin, step) => ({
  start: 0, step, count: 8, label: clock(startMin),
  less: `${verb} earlier than`, more: `${verb} later than`, lessBy: `${verb} {d} earlier than`, moreBy: `${verb} {d} later than`,
  gap: (s) => ((s * step) % 60 === 0 ? plural((s * step) / 60, 'hour', 'hours') : plural(s * step, 'minute', 'minutes')),
});

