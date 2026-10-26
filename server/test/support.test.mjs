// The optional "Support the game" link: admin checks on the link, and when
// GET /v1/config passes it to the game. Uses a small stand-in database so the
// admin per-minute limit in admin.test.mjs is left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSetting, publicConfig, clearSettingsCache } from '../src/settings.js';

const envWith = (rows) => ({
  DB: {
    prepare: (sql) => ({
      all: async () => ({ results: sql.startsWith('SELECT key') ? Object.entries(rows).map(([key, v]) => ({ key, value: JSON.stringify(v) })) : [] }),
      bind() { return this; },
    }),
  },
});
async function supportUrl(rows) {
  clearSettingsCache();
  const res = await publicConfig(new Request('https://api.example/v1/config'), envWith(rows));
  return (await res.json()).game.supportUrl;
}

test('the support link must be an https link or empty', () => {
  assert.deepEqual(checkSetting('support_url', ''), { value: '' });
  assert.deepEqual(checkSetting('support_url', '  https://github.com/sponsors/someone '), { value: 'https://github.com/sponsors/someone' });
  for (const bad of ['http://example.com/tip', 'javascript:alert(1)', 'https://user:pw@example.com/', 'not a link', 42, `https://example.com/${'x'.repeat(300)}`]) {
    assert.ok(checkSetting('support_url', bad).error, `refused ${String(bad).slice(0, 30)}`);
  }
  assert.equal(checkSetting('support_link_enabled', true).value, true);
});

test('the game gets the support link only when it is switched on and set', async () => {
  assert.equal(await supportUrl({}), '', 'off by default');
  assert.equal(await supportUrl({ support_url: 'https://ko-fi.com/someone' }), '', 'set but switched off');
  assert.equal(await supportUrl({ support_link_enabled: true }), '', 'switched on with no link');
  assert.equal(await supportUrl({ support_link_enabled: true, support_url: 'https://ko-fi.com/someone' }), 'https://ko-fi.com/someone');
});
