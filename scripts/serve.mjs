// Tiny static server for local testing: node scripts/serve.mjs dist/web 8080
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
const [dir = 'dist/web', port = 8080] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.vtt': 'text/vtt' };
createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = join(dir, normalize(p).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    const type = types[extname(file)] || 'application/octet-stream';
    // Range requests, as real hosts serve them, so the video streams and seeks.
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r) {
      const start = r[1] ? +r[1] : Math.max(0, body.length - +r[2]);
      const end = r[1] && r[2] ? Math.min(+r[2], body.length - 1) : body.length - 1;
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}` });
      return res.end(body.subarray(start, end + 1));
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes' }); res.end(body);
  }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`http://localhost:${port}/`));
