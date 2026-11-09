// Passwords autofill: fills one login (username, password, 2-step code) into
// the sign-in form of the site it belongs to. Shared by the browser extension
// (background.js injects it) and the Windows admin app's login window
// (desktop-admin/src-tauri/src/autofill.rs includes this file).
//
// Safety: it fills only when the page's address is on the login's own site
// (same registrable domain, so dash.cloudflare.com is Cloudflare), only before
// the login's time runs out, each field once per page, and never presses
// Sign in. Nothing is read back or sent anywhere.
(() => {
  if (globalThis.__flgFill) return;
  const SECOND = /^(co|com|net|org|gov|ac|edu|ne|or)$/;
  const base = (h) => {
    const p = String(h || '').toLowerCase().replace(/^www\./, '').split('.');
    return p.length > 2 && SECOND.test(p[p.length - 2]) ? p.slice(-3).join('.') : p.slice(-2).join('.');
  };

  // RFC 6238 codes, so a code is fresh when the code page appears.
  function parseTotp(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    let secret = s; let digits = 6; let period = 30; let algo = 'SHA-1';
    if (/^otpauth:/i.test(s)) {
      try {
        const u = new URL(s);
        secret = u.searchParams.get('secret') || '';
        digits = Number(u.searchParams.get('digits')) || 6;
        period = Number(u.searchParams.get('period')) || 30;
        algo = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[String(u.searchParams.get('algorithm') || 'SHA1').toUpperCase()] || 'SHA-1';
      } catch { return null; }
    }
    const clean = secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
    return /^[A-Z2-7]{8,}$/.test(clean) ? { secret: clean, digits, period, algo } : null;
  }
  async function totp(t) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0; let val = 0; const key = [];
    for (const c of t.secret) { val = (val << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { key.push((val >>> (bits - 8)) & 255); bits -= 8; } }
    let c = Math.floor(Date.now() / 1000 / t.period);
    const msg = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
    const k = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: t.algo }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
    const o = mac[mac.length - 1] & 15;
    const bin = ((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
    return String(bin % 10 ** t.digits).padStart(t.digits, '0');
  }

  const visible = (el) => {
    if (!el || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) !== 0;
  };
  const inputs = (root = document) => [...root.querySelectorAll('input')].filter(visible);
  const words = (el) => [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.placeholder, el.className].join(' ').toLowerCase();
  function setValue(el, value) {
    el.focus();
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }
  const isOtp = (el) => {
    const w = words(el);
    if (el.type === 'password' && !/one-time|otp|totp|mfa|2fa|two-?factor|verification|auth.?code/.test(w)) return false;
    if (/one-time-code/.test(w)) return true;
    if (!/otp|totp|mfa|2fa|two-?factor|verif|security.?code|auth.?code|\bcode\b|token|pin/.test(w)) return false;
    return !/user|email|login|search|phone|zip|post|promo|coupon|captcha/.test(w);
  };
  const findPassword = () => inputs().find((el) => el.type === 'password' && !isOtp(el) && !/new-password|confirm|repeat/.test(words(el)));
  function findUser(pass) {
    const list = inputs().filter((el) => ['text', 'email', 'tel', ''].includes(el.type) && !isOtp(el));
    const named = list.find((el) => /username|email|e-mail|login|user|account|identifier|signin|sign-in/.test(words(el)) && !/search/.test(words(el)));
    if (named) return named;
    if (pass) { // the text box just before the password box
      const all = inputs();
      const i = all.indexOf(pass);
      for (let j = i - 1; j >= 0; j--) if (list.includes(all[j])) return all[j];
    }
    return list.length === 1 ? list[0] : null;
  }
  function findOtp() {
    const all = inputs();
    // Six (or so) one-character boxes in a row.
    const singles = all.filter((el) => el.maxLength === 1 && /^(text|tel|number|password)$/.test(el.type));
    if (singles.length >= 4 && singles.length <= 8) return { boxes: singles };
    const one = all.find(isOtp) || all.find((el) => /^(text|tel|number)$/.test(el.type) && el.inputMode === 'numeric' && el.maxLength >= 6 && el.maxLength <= 8 && !findPassword());
    return one ? { one } : null;
  }

  function note(text) {
    try {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'closed' });
      const box = document.createElement('div');
      box.textContent = text;
      box.setAttribute('role', 'status');
      box.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#1f1a3d;color:#fff;font:600 14px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      root.append(box);
      document.documentElement.append(host);
      setTimeout(() => host.remove(), 4000);
    } catch { /* page forbids it */ }
  }

  globalThis.__flgFill = function fill(login) {
    if (!login || Date.now() > Number(login.expires || 0)) return;
    const here = base(location.hostname);
    if (!(login.hosts || []).some((h) => h && base(h) === here)) return; // not this login's site
    if (globalThis.__flgFilling) return; // already filling this page
    globalThis.__flgFilling = true;
    const done = { user: false, pass: false, otp: false };
    const t = parseTotp(login.totp);
    let busy = false;
    async function tryFill() {
      if (busy || Date.now() > login.expires) return;
      busy = true;
      try {
        const filled = [];
        const pass = findPassword();
        if (!done.user && login.username) {
          const u = findUser(pass);
          if (u && !u.value) { setValue(u, login.username); done.user = true; filled.push('username'); }
          else if (u && u.value) done.user = true;
        }
        if (!done.pass && login.password && pass) { setValue(pass, login.password); done.pass = true; filled.push('password'); }
        if (!done.otp && t && !pass) {
          const o = findOtp();
          if (o) {
            const code = await totp(t);
            if (o.boxes) o.boxes.forEach((el, i) => setValue(el, code[i] || '')); else setValue(o.one, code);
            done.otp = true; filled.push('2-step code');
          }
        }
        if (filled.length) note(`Passwords filled in your ${filled.join(' and ')}.${done.otp || !t ? '' : ' The 2-step code fills when its box appears.'}`);
        if ((done.pass || !login.password) && (done.otp || !t) && (done.user || !login.username)) stop();
      } finally { busy = false; }
    }
    const obs = new MutationObserver(() => tryFill());
    const timer = setInterval(tryFill, 700);
    function stop() { obs.disconnect(); clearInterval(timer); }
    const start = () => { obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'style', 'class', 'hidden'] }); tryFill(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
    setTimeout(stop, Math.max(0, login.expires - Date.now()));
  };
})();
