// Turns structured facts into theme-voiced English. Works from the puzzle's
// category data alone, so saved puzzles can still produce hint text.
//
// model: { K, N, cast: {one, many}, cats: [{ name, labels, pos, neg, ordinal }] }
// Category 0 is always the cast (people names), and items are global ids.

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function joinList(words, conj = 'and') {
  if (words.length <= 1) return words.join('');
  if (words.length === 2) return `${words[0]} ${conj} ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} ${conj} ${words[words.length - 1]}`;
}

export function makeLanguage(model) {
  const { N, cast, cats } = model;
  const catOf = (g) => Math.floor(g / N);
  const label = (g) => cats[catOf(g)].labels[g % N];
  const isKey = (g) => catOf(g) === 0;
  const fill = (tpl, x) => tpl.replace('{x}', x);

  const pos = (g) => fill(cats[catOf(g)].pos, label(g));
  const neg = (g) => fill(cats[catOf(g)].neg, label(g));
  const subj = (g) => (isKey(g) ? label(g) : `the ${cast.one} who ${pos(g)}`);

  // "Ada was in the Library" / "the suspect who drank Cocoa was not in the Library"
  function pair(x, y, v) {
    if (isKey(y) || (!isKey(x) && catOf(y) < catOf(x))) [x, y] = [y, x];
    return `${subj(x)} ${v > 0 ? pos(y) : neg(y)}`;
  }
  // Same category list in one predicate: "was in the Library or Study"
  // Items of one category are listed in the grid's order (ids follow it).
  const inGridOrder = (gs) => [...gs].sort((p, q) => p - q);
  function listPred(tplKey, x, ys, conj) {
    ys = inGridOrder(ys);
    const c = catOf(ys[0]);
    if (c === 0) {
      const names = joinList(ys.map(label), conj);
      return tplKey === 'pos' ? `${subj(x)} is ${names}` : `${subj(x)} is not ${names}`;
    }
    return `${subj(x)} ${fill(cats[c][tplKey], joinList(ys.map(label), conj))}`;
  }

  return {
    label, subj, pos, neg, pair, catOf, isKey,
    name: label,
    cast: () => cast.many,
    catName: (c) => (c === 0 ? cast.one : cats[c].name.toLowerCase()),
    list: (gs, conj = 'and') => joinList(inGridOrder(gs).map(label), conj),
    inGridOrder,
    posList: (x, ys) => listPred('pos', x, ys, 'or'),
    negList: (x, ys) => listPred('neg', x, ys, 'or'),
    gap: (c, d) => cats[c].ordinal.gaps[d],
    ordinal: (c) => cats[c].ordinal,
  };
}

// Clue text. Each renderer returns one sentence.
export function clueText(L, c, rng) {
  const flip = () => (rng ? rng.next() < 0.5 : false);
  switch (c.type) {
    case 'is':
      return cap(L.pair(c.a, c.b, 1)) + '.';
    case 'not':
      return cap(L.pair(c.a, c.b, -1)) + '.';
    case 'neither': {
      c = { ...c, xs: L.inGridOrder(c.xs) };
      if (L.isKey(c.b)) return cap(L.negList(c.b, c.xs)) + '.';
      return `Neither ${L.subj(c.xs[0])} nor ${L.subj(c.xs[1])} ${L.pos(c.b)}.`;
    }
    case 'either': {
      const [b1, b2] = L.inGridOrder([c.b1, c.b2]);
      c = { ...c, b1, b2 };
      if (L.isKey(c.b1)) return `${cap(L.subj(c.a))} is either ${L.label(c.b1)} or ${L.label(c.b2)}.`;
      return `${cap(L.subj(c.a))} either ${L.pos(c.b1)} or ${L.pos(c.b2)}.`;
    }
    case 'pairs':
      [c.x1, c.x2] = L.inGridOrder([c.x1, c.x2]);
      [c.y1, c.y2] = L.inGridOrder([c.y1, c.y2]);
      return `Of ${L.subj(c.x1)} and ${L.subj(c.x2)}, one ${L.pos(c.y1)} and the other ${L.pos(c.y2)}.`;
    case 'allDiff': {
      // Three different people. A plain list ("Ada, the suspect who...") reads
      // like an appositive, so spell it out.
      const [x, y, z] = c.items;
      return `${cap(L.pair(x, y, -1))}, and neither of them ${L.pos(z)}.`;
    }
    case 'less': {
      const o = L.ordinal(c.o);
      return flip()
        ? `${cap(L.subj(c.b))} ${o.more} ${L.subj(c.a)}.`
        : `${cap(L.subj(c.a))} ${o.less} ${L.subj(c.b)}.`;
    }
    case 'diff': {
      const o = L.ordinal(c.o);
      const d = `exactly ${o.gaps[c.d]}`;
      return flip()
        ? `${cap(L.subj(c.b))} ${o.moreBy.replace('{d}', d)} ${L.subj(c.a)}.`
        : `${cap(L.subj(c.a))} ${o.lessBy.replace('{d}', d)} ${L.subj(c.b)}.`;
    }
    case 'ifthen':
      return `If ${L.pair(c.p[0], c.p[1], 1)}, then ${L.pair(c.q[0], c.q[1], 1)}.`;
    default:
      throw new Error(`Unknown clue type ${c.type}`);
  }
}
