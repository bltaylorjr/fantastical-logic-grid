// The grid's shape. Standard staircase layout: every pair of categories
// appears exactly once. Columns: categories 1..K-1. Rows: category 0, then
// K-1 down to 2. No other engine files needed, so the tutorial can draw grids
// without loading the story library.
export function gridLayout(cats) {
  const K = cats.length;
  const columns = cats.slice(1).map((c) => c.id);
  const rowIdx = [0, ...Array.from({ length: K - 2 }, (_, i) => K - 1 - i)];
  const rows = rowIdx.map((i) => cats[i].id);
  const blocks = [];
  rowIdx.forEach((r, ri) => {
    for (let c = 1; c <= K - 1 - ri; c++) blocks.push({ row: cats[r].id, column: cats[c].id });
  });
  return { columns, rows, blocks };
}
