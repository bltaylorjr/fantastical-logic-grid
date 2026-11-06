// AI pictures for the game, painted by Cloudflare Workers AI on its free daily
// allowance (no key; on the free plan Cloudflare refuses requests past the
// allowance and never bills). The admin dashboard chooses whether stories get
// a scene, a scene and portraits, or no AI pictures, and caps new pictures a
// day.
//
//   POST /v1/picture   { prompt, kind: scene|portrait }  ->  image/jpeg
//
// The same prompt always returns the cached picture, which does not count
// toward the cap. Each device also keeps its pictures, so a story's are made
// once.
import { json, corsHeaders, readText, TooLarge } from './http.js';
import { getSettings } from './settings.js';
import { bump } from './learn.js';

const STYLE = 'Warm storybook illustration, painterly, soft cinematic light, rich color, family friendly, a purely pictorial wordless scene with plain unmarked surfaces.';

// Every picture is wordless; only the title, laid over it as page text, has
// words. Things that usually carry writing are asked for blank, and words that
// invite lettering (equations, numbers, price tags) are dropped.
export function wordless(prompt) {
  return prompt
    .replace(/\b(an? |the )?periodic tables?\b/gi, 'a grid of colored tiles')
    .replace(/\b(equations?|formulas?|number puzzles)\b/gi, 'chalk doodles')
    .replace(/\b(numbers?|letters?|words?|writing|captions?|price tags?|graffiti|headlines?)\b/gi, ' ')
    .replace(/\b(price |neon |road|roadside |street |shop |missing-person |survey |paw print )?(signs?|posters?|banners?|scoreboards?|results boards?|chalkboards?|blackboards?|billboards?|placards?|menus?|newspapers?|labels?|notebooks?|sketchbooks?|maps?)\b/gi,
      (all, kind, thing) => `blank ${kind && /neon/i.test(kind) ? 'glowing ' : ''}${thing}`)
    .replace(/\bblank\s+blank\b/gi, 'blank')
    .replace(/\s+([,.])/g, '$1').replace(/,(\s*,)+/g, ',').replace(/\b(and|with|of|in)\s*([,.])/gi, '$2').replace(/\s+/g, ' ').trim();
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function postPicture(req, env, ctx) {
  const settings = await getSettings(env);
  if (settings.ai_pictures === 'none') return json(req, env, { error: 'switched_off' }, 503);
  if (!env.AI) return json(req, env, { error: 'not_set_up' }, 503);
  let body;
  try { body = JSON.parse(await readText(req, 4_000)); } catch (e) { return json(req, env, { error: e instanceof TooLarge ? 'too_large' : 'bad_request' }, e instanceof TooLarge ? 413 : 400); }
  const kind = body?.kind === 'portrait' ? 'portrait' : 'scene';
  if (kind === 'portrait' && settings.ai_pictures !== 'all') return json(req, env, { error: 'switched_off' }, 503);
  // Names in brackets, quotes, initials and numbers come out as made-up
  // lettering in the picture, so they never reach the model.
  const cleaned = String(body?.prompt || '').replace(/\([^)]*\)|\[[^\]]*\]|"[^"]*"|“[^”]*”/g, ' ').replace(/\b[A-Z]{2,}\b|\d+(st|nd|rd|th)?\b/g, ' ').replace(/\s+/g, ' ').trim();
  const prompt = wordless(cleaned);
  if (prompt.length < 10 || prompt.length > 1500) return json(req, env, { error: 'bad_request' }, 400);
  const model = settings.picture_model;
  const key = new Request(`https://flg-cloud.internal/picture/${await sha256(`${model}|${kind}|${prompt}`)}`);
  const hit = await caches.default.match(key);
  if (hit) return new Response(hit.body, { headers: { ...corsHeaders(req, env), 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Cache': 'hit' } });
  if (settings.daily_picture_cap <= 0 || !(await bump(env, 'pictures', settings.daily_picture_cap))) {
    return json(req, env, { error: 'used_up' }, 429, { 'Retry-After': '3600' });
  }
  let out;
  try {
    out = await env.AI.run(model, { prompt: `${STYLE} ${prompt}`.slice(0, 2048), steps: 4 });
  } catch (e) {
    return json(req, env, { error: 'service' }, 502);
  }
  const b64 = out && (out.image || out.images?.[0]);
  if (!b64) return json(req, env, { error: 'service' }, 502);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  ctx.waitUntil(caches.default.put(key, new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000' } })));
  return new Response(bytes, { headers: { ...corsHeaders(req, env), 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Cache': 'miss' } });
}

// Returns a Response for this module's routes, or null for anything else.
export async function handlePictures(req, env, ctx, url) {
  if (url.pathname !== '/v1/picture' || req.method !== 'POST') return null;
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  if (env.LIMIT_PICTURES && !(await env.LIMIT_PICTURES.limit({ key: (await sha256(`flg|${ip}`)).slice(0, 32) })).success) {
    return json(req, env, { error: 'slow_down' }, 429, { 'Retry-After': '60' });
  }
  return postPicture(req, env, ctx);
}
