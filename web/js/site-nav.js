// Back on the website's pages (scripts/seo.mjs). In the installed app there is
// no browser back button, so every page has its own: it goes to the previous
// page when that was on this site, and otherwise to the game.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[data-back]');
  if (!a) return;
  let fromHere = false;
  try { fromHere = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (err) { fromHere = false; }
  if (fromHere && history.length > 1) {
    e.preventDefault();
    history.back();
  }
});

// Contact us (scripts/hub.mjs contactLink): the support address is only put
// together when the link is clicked, so it is never written in the page.
document.addEventListener('click', (e) => {
  if (!(e.target.closest && e.target.closest('a.contact-link'))) return;
  e.preventDefault();
  // The two halves, reversed, so the address never appears whole in a file.
  const [user, host] = ['troppus', 'moc.dirgcigoleht'].map((s) => [...s].reverse().join(''));
  window.location.href = `mailto:${user}@${host}`;
});
