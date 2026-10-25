// Reads the weekly archive zips (made by server/src/zip.js) in the browser.
// Handles stored and deflated files, which covers zips re-saved by Windows or
// macOS too. Nothing leaves the browser.

const MAX_TOTAL = 400 * 1024 * 1024; // refuse zips that unpack to more than this

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Returns Map(name -> Uint8Array).
export async function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This is not a zip file.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const method = view.getUint16(at + 10, true);
    const packedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    total += size;
    if (total > MAX_TOTAL) throw new Error('The zip unpacks to more than 400 MB.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + packedSize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflate(data));
    else throw new Error(`${name} uses a compression this viewer cannot open.`);
  }
  return out;
}

// RFC 4180 CSV to an array of objects (header row = keys). Undoes the
// apostrophe the archive puts in front of formula-like text.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const push = () => { row.push(cell); cell = ''; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') push();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      push();
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { push(); rows.push(row); }
  const [head, ...body] = rows;
  if (!head) return { columns: [], rows: [] };
  const unescape = (v) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);
  return { columns: head, rows: body.filter((r) => r.length > 1 || r[0] !== '').map((r) => Object.fromEntries(head.map((h, i) => [h, unescape(r[i] ?? '')]))) };
}

// One archive: { name, manifest, tables: { table: { columns, rows } } }.
export async function readArchive(file) {
  const files = await readZip(await file.arrayBuffer());
  const dec = new TextDecoder();
  let manifest = null;
  if (files.has('manifest.json')) {
    try { manifest = JSON.parse(dec.decode(files.get('manifest.json'))); } catch (e) { manifest = null; }
  }
  const tables = {};
  for (const [name, data] of files) {
    const m = name.match(/(?:^|\/)([\w-]+)\.csv$/);
    if (m) tables[m[1]] = parseCsv(dec.decode(data));
  }
  if (!Object.keys(tables).length) throw new Error('No CSV files in this zip.');
  return { name: file.name, manifest, tables };
}
