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
  try { const body = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`http://localhost:${port}/`));
