// Social links: the admin sets each network's page; only real links to that
// network are accepted, and only the ones set reach the footers.
// Run with `npm test` in server/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, checkSetting } from '../src/settings.js';
import { socialLinks, socialHtml, DEFAULT_LINKS, NETWORKS, ICONS } from '../../web/js/social.js';

test('each network has a setting; Facebook starts with the launch page', () => {
  assert.equal(SETTINGS.social_facebook.default, DEFAULT_LINKS.facebook);
  assert.equal(SETTINGS.social_youtube.default, '');
  assert.equal(SETTINGS.social_youtube.group, 'Social links');
});

test('only that network\'s https links are accepted, and empty hides it', () => {
  assert.equal(checkSetting('social_youtube', 'https://www.youtube.com/@thelogicgrid').value, 'https://www.youtube.com/@thelogicgrid');
  assert.equal(checkSetting('social_youtube', '').value, '');
  assert.match(checkSetting('social_youtube', 'https://example.com/youtube').error, /not on YouTube/);
  assert.ok(checkSetting('social_instagram', 'http://instagram.com/x').error, 'https only');
});

test('the footers show only networks with a link, in a fixed order', () => {
  const list = socialLinks({ youtube: 'https://youtube.com/@a', facebook: 'https://www.facebook.com/flg', x: '', tiktok: 'https://evil.example/tiktok' });
  assert.deepEqual(list.map((s) => s.id), ['facebook', 'youtube']);
  const html = socialHtml(list);
  assert.match(html, /rel="me noopener" target="_blank"/);
  assert.doesNotMatch(html, /<img/, 'icons are drawn inline, no extra files');
  assert.match(html, /<svg [^>]*aria-hidden="true"/);
  assert.match(html, /<span class="sr-only">Facebook \(opens in a new tab\)<\/span>/);
  assert.equal(socialHtml([]), '');
});

test('every network has an inline icon', () => {
  for (const n of NETWORKS) assert.match(ICONS[n.id] || '', /^M/, n.id);
});
