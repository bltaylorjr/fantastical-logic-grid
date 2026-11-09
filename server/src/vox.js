// Vox, the voice engine, on the Oracle server (docs/VOX-SERVER.md). Vox runs
// in the container flg-vox on the server's private network and has no public
// address. The admin dashboard reaches it here, through the Cloudflare Tunnel
// (the Workers VPC binding VOX), on any device:
//
//   GET  /admin/v1/vox-server       admins: { ready, health? }
//   ANY  /admin/v1/vox/v1/<path>    admins: passed on to Vox's own /v1/<path>
//   GET  /admin/v1/vox-health       anyone: { ok, release } (for the deploy check)
//
// Only signed-in admins get through (checked in admin.js before this runs);
// the key VOX_KEY (a Worker secret; Vox's admin token on the server) is added
// here and never reaches the browser. Until the binding and the secret are both
// set, the dashboard keeps using Vox on the computer (the Windows admin app).

// The VPC Service decides where requests really go; this address only names it.
const ORIGIN = 'http://172.30.0.11:5150';
const PATH = /^v1\/[A-Za-z0-9/_.\-]+$/;
const MAX_UPLOAD = 60 * 1024 * 1024;   // sample recordings for new voices

export const voxReady = (env) => !!(env.VOX && typeof env.VOX.fetch === 'function' && String(env.VOX_KEY || '').length >= 32);

async function voxHealth(env) {
  const res = await env.VOX.fetch(`${ORIGIN}/v1/health`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Vox answered ${res.status}`);
  return res.json();
}

// For signed-in admins: is Vox on the server ready?
export async function voxServerStatus(env) {
  if (!voxReady(env)) return { ready: false, reason: 'not_set_up' };
  try {
    const health = await voxHealth(env);
    return { ready: true, health };
  } catch (e) {
    return { ready: false, reason: 'not_answering' };
  }
}

// For the deploy workflow: only whether it answers and on which release.
export async function voxPublicHealth(env) {
  if (!voxReady(env)) return { ok: false, error: 'vox_off' };
  try {
    const h = await voxHealth(env);
    return { ok: h.status === 'ok', release: h.release || null };
  } catch (e) {
    return { ok: false, error: 'not_answering' };
  }
}

// Pass one request on to Vox, adding its key. sub is "v1/..." plus the query.
export async function voxProxy(req, env, sub, search) {
  if (!voxReady(env)) return new Response(JSON.stringify({ error: 'vox_off', detail: 'Vox is not on the server yet.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  if (!PATH.test(sub) || sub.includes('..')) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_UPLOAD) return new Response(JSON.stringify({ error: 'too_large', detail: 'That upload is too big (60 MB at most).' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
  const headers = { 'X-Vox-Admin-Token': env.VOX_KEY };
  const type = req.headers.get('Content-Type');
  if (type) headers['Content-Type'] = type;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let res;
  try {
    res = await env.VOX.fetch(`${ORIGIN}/${sub}${search || ''}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'vox_unreachable', detail: 'Vox on the server is not answering. It may be restarting; try again in a minute.' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
  const out = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  for (const h of ['Content-Type', 'Content-Disposition', 'X-Vox-Take', 'X-Vox-Take-Id', 'X-Vox-Duration', 'X-Vox-Segments', 'X-Vox-Seed', 'X-Vox-Quality', 'X-Vox-Sample-Rate']) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}
