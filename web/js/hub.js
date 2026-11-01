// The website's front page (The Logic Grid) and the NINETIMESNINE page
// (scripts/hub.mjs). A plain script in <head>, so it runs before first paint:
// - applies the player's color theme (the game's own setting, flg.settings),
// - on the front page only (data-hub): old game links and the installed app
//   go on to the game at fantastical/, since the game used to be at the site root,
// - wires the front page's Look menu to the same setting.
(function () {
  var root = document.documentElement;
  var me = document.currentScript;
  var KEY = 'flg.settings';
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function apply(t) { if (t && t !== 'system') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme'); }
  apply(read().colorTheme);
  // Never run inside another site's frame, where clicks could be tricked
  // (GitHub Pages cannot send X-Frame-Options), the same as the game page.
  // The admin dashboard's Website page shows these pages in its preview frame;
  // there the page takes no clicks at all (js/design-preview.js).
  var preview = /[?&]design-preview(=|&|$)/.test(location.search);
  if (window.top !== window.self && !preview) { root.hidden = true; try { window.top.location = window.location.href; } catch (e) { /* blocked */ } return; }

  if (!me || !me.hasAttribute('data-hub')) return;

  // Anything but campaign tags (utm_*) in the address was meant for the game:
  // ?play=now, ?challenge=CODE, ?race=CODE, ?learn, ?preview=..., #...
  var forGame = false;
  try { new URLSearchParams(location.search).forEach(function (v, k) { if (!/^utm_/.test(k) && k !== 'design-preview') forGame = true; }); } catch (e) { /* old browser */ }
  if (location.hash.length > 1 && location.hash !== '#games') forGame = true;
  // The installed app used to start at the site root. A player who came here
  // from one of the games (The Logic Grid home in the menu) stays.
  var fromHere = false;
  try { fromHere = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) { /* none */ }
  var installed = !fromHere && navigator.standalone === true;
  try {
    ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].forEach(function (m) { if (!fromHere && matchMedia('(display-mode: ' + m + ')').matches) installed = true; });
  } catch (e) { /* no matchMedia */ }
  if (!preview && (forGame || installed)) {
    root.hidden = true;
    location.replace('fantastical/' + location.search + location.hash);
    return;
  }

  // The same offline helper as the game (sw.js, scope /): a first visit here
  // makes the games playable offline, and app stores that read this page
  // (PWABuilder for the Microsoft Store) find the manifest and offline support.
  if ('serviceWorker' in navigator) addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ }); });

  document.addEventListener('DOMContentLoaded', function () {
    // The spotlight and 3D tilt card effects follow the pointer (the Website
    // page in the admin dashboard picks them; CSS does nothing when they are off).
    Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        card.style.setProperty('--mx', Math.round(x * 100) + '%');
        card.style.setProperty('--my', Math.round(y * 100) + '%');
        card.style.setProperty('--ry', ((x - 0.5) * 10).toFixed(1) + 'deg');
        card.style.setProperty('--rx', ((0.5 - y) * 10).toFixed(1) + 'deg');
      });
      card.addEventListener('pointerleave', function () { card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
    });
    var pick = document.getElementById('theme-pick');
    if (!pick) return;
    pick.value = read().colorTheme || 'system';
    pick.addEventListener('change', function () {
      var s = read();
      s.colorTheme = pick.value;
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode: this visit only */ }
      apply(pick.value);
    });
  });
})();
