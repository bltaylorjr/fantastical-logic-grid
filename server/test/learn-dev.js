// Test-only Worker entry for the learning routes (see learn.wrangler.toml).
import { handleLearn } from '../src/learn.js';

export default {
  async fetch(req, env, ctx) {
    return (await handleLearn(req, env, ctx)) || new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  },
};
