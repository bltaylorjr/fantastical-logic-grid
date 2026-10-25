// End-to-end check that saves survive the browser closing the database
// connection ("The database connection is closing"), and that another tab or
// an app update can upgrade or delete the database without being blocked.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const assert = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok  ${m}`); };

(async () => {
  const server = spawn('node', [path.join(__dirname, 'serve.mjs'), path.join(__dirname, '..', 'dist', 'web'), '8126'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  try {
    // Lets the test close the app's open connection the way the browser does
    // when a phone suspends the page: the next transaction on it throws.
    await page.addInitScript(() => {
      localStorage.setItem('flg.settings', JSON.stringify({ introOffered: true, sound: false }));
      const real = IDBDatabase.prototype.transaction;
      window.__closeNext = 0;
      IDBDatabase.prototype.transaction = function (...a) {
        if (window.__closeNext > 0) { window.__closeNext--; this.close(); }
        return real.apply(this, a);
      };
    });
    await page.goto('http://localhost:8126/');
    await page.waitForSelector('#tier-choices input');

    const r = await page.evaluate(async () => {
      const st = await import('./js/store.js');
      await st.setMeta('probe', 1);
      window.__closeNext = 1;
      await st.setMeta('probe', 2);
      window.__closeNext = 1;
      const after = await st.getMeta('probe');
      window.__closeNext = 1;
      await st.putSave({ id: 'closing-test', name: 'x' });
      window.__closeNext = 1;
      const save = await st.getSave('closing-test');
      return { after, save: save && save.id, ls: localStorage.getItem('flg.meta:probe') };
    });
    assert(r.after === 2, 'a write after the connection closed reopens the database and is kept');
    assert(r.save === 'closing-test', 'saves and loads work after the connection closed');
    assert(r.ls === null, 'it reopened IndexedDB rather than falling back to localStorage');

    const del = await page.evaluate(async () => {
      const st = await import('./js/store.js');
      await st.getMeta('probe');
      const blocked = await new Promise((res) => {
        const q = indexedDB.deleteDatabase('fantastical-logic-grid');
        q.onblocked = () => res(true);
        q.onsuccess = () => res(false);
        q.onerror = () => res('error');
      });
      await st.setMeta('probe', 3);
      return { blocked, v: await st.getMeta('probe') };
    });
    assert(del.blocked === false, 'another tab or an update can replace the database without being blocked');
    assert(del.v === 3, 'the app reopens the database afterwards');
    assert(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    console.log('\nStorage reconnect check passed.');
  } catch (e) {
    console.error(e.message || e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.kill();
  }
})();
