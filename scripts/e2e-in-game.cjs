// Loaded with node --require by the app tests (package.json, ci.yml). The
// Logic Grid opens on its game cards the first time; these tests are about
// The Fantastical Logic Grid, so every page they open starts there, as for a
// player who last played it. e2e-games.cjs checks the cards themselves.
if (!/e2e-games\.cjs$/.test(process.argv[1] || '')) {
  let pw = null;
  try { pw = require('playwright'); } catch (e) { /* not a browser test */ }
  const inGame = () => { try { if (!localStorage.getItem('flg.game')) localStorage.setItem('flg.game', 'logic-grid'); } catch (e) { /* no storage */ } };
  const patch = (browser) => {
    const newContext = browser.newContext.bind(browser);
    const newPage = browser.newPage.bind(browser);
    browser.newContext = async (...a) => { const c = await newContext(...a); await c.addInitScript(inGame); return c; };
    browser.newPage = async (...a) => { const p = await newPage(...a); await p.addInitScript(inGame); return p; };
    return browser;
  };
  if (pw) {
    const launch = pw.chromium.launch.bind(pw.chromium);
    pw.chromium.launch = async (...a) => patch(await launch(...a));
  }
}
