// Waits until something answers on a local port: the tests' little web
// servers start in well under a second on GitHub's machines but can take
// longer on the Arm build server, so a fixed pause is not enough.
const net = require('net');

module.exports = async function waitPort(port, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const up = await new Promise((r) => {
      const s = net.connect(Number(port), '127.0.0.1');
      s.on('connect', () => { s.end(); r(true); });
      s.on('error', () => r(false));
    });
    if (up) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Nothing answered on port ${port} within ${ms / 1000} s`);
};
