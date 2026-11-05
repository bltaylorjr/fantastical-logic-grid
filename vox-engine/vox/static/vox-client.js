// Vox voice engine client for browser / HTML5 games. Free to use in any project.
// No build step: <script type="module"> import { VoxClient } from "./vox-client.js"; </script>
//
//   const vox = new VoxClient("http://127.0.0.1:5150");
//   const line = await vox.speak("Halt! Who goes there?", { voice: "guard", emotion: "angry" });
//   line.play();                                  // or use line.buffer with your own audio graph
//   const fixed = await vox.edit(line.take, [{ op: "replace", old: "Halt", new: "Stop" }]);
//   await vox.stream("A long speech...", { voice: "narrator" });   // plays while generating
//   const baked = await vox.loadBaked("audio/vox/gob_01.wav");     // shipped files, no server

export class VoxClient {
  constructor(serverUrl = "http://127.0.0.1:5150", audioContext = null) {
    this.url = serverUrl.replace(/\/$/, "");
    this.ctx = audioContext;
  }

  get audio() {
    // Browsers only allow audio after a user gesture; create lazily.
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  async health() {
    return (await fetch(`${this.url}/v1/health`)).json();
  }

  async voices() {
    return (await fetch(`${this.url}/v1/voices`)).json();
  }

  async emotions() {
    return (await fetch(`${this.url}/v1/emotions`)).json();
  }

  /** options: voice, emotion, intensity, rate, pitch, pitch_range, energy, style_prompt, seed,
   *  translate_to ("es", "fr", ...), enunciate (0..1), autotune */
  async speak(text, options = {}) {
    return this._audioPost("/v1/speak", { text, voice: "narrator", ...options, format: "wav" });
  }

  /** ops: [{op:"replace",old,new}, {op:"restyle",phrase,style:{emotion:"sad"}}, {op:"undo"}, ...] */
  async edit(take, ops) {
    return this._audioPost("/v1/edit", { take, ops });
  }

  async translate(text, to, from = 'en') {
    return (await this._json('/v1/translate', { text, to, from })).text;
  }

  async languages() {
    return (await fetch(`${this.url}/v1/languages`)).json();
  }

  async lookUp(word) {
    return (await fetch(`${this.url}/v1/dictionary/${encodeURIComponent(word)}`)).json();
  }

  async designVoice(description, { name, seed } = {}) {
    return this._json("/v1/voices/design", { description, name, seed });
  }

  async _json(path, body) {
    const r = await fetch(this.url + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async _audioPost(path, body) {
    const r = await fetch(this.url + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = await r.text();
      try { msg = JSON.parse(msg).detail || msg; } catch (_) { /* plain text */ }
      throw new Error(msg);
    }
    const bytes = await r.arrayBuffer();
    const blob = new Blob([bytes], { type: "audio/wav" });
    const buffer = await this.audio.decodeAudioData(bytes.slice(0));
    return this._line(buffer, blob, {
      take: r.headers.get("X-Vox-Take"),
      seed: Number(r.headers.get("X-Vox-Seed")),
      duration: Number(r.headers.get("X-Vox-Duration")),
      segments: JSON.parse(r.headers.get("X-Vox-Segments") || "[]"),
    });
  }

  _line(buffer, blob, info) {
    const ctx = this.audio;
    return {
      ...info, buffer, blob,
      url: blob ? URL.createObjectURL(blob) : null,
      play(destination = ctx.destination) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(destination);
        src.start();
        return src;
      },
    };
  }

  /** Streams and plays audio as it is generated. Resolves when playback is scheduled fully. */
  stream(text, options = {}, destination = null) {
    const ctx = this.audio;
    destination = destination || ctx.destination;
    const ws = new WebSocket(this.url.replace(/^http/, "ws") + "/v1/stream");
    ws.binaryType = "arraybuffer";
    let rate = 24000;
    let playAt = 0;
    return new Promise((resolve, reject) => {
      ws.onopen = () => ws.send(JSON.stringify({ text, voice: "narrator", ...options }));
      ws.onerror = () => reject(new Error("Vox stream connection failed"));
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          const msg = JSON.parse(ev.data);
          if (msg.event === "start") rate = msg.sample_rate;
          if (msg.event === "end") { ws.close(); resolve(playAt); }
          if (msg.event === "error") { ws.close(); reject(new Error(msg.message)); }
          return;
        }
        const pcm = new Int16Array(ev.data);
        const buf = ctx.createBuffer(1, pcm.length, rate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(destination);
        playAt = Math.max(playAt, ctx.currentTime + 0.05);
        src.start(playAt);
        playAt += buf.duration;
      };
    });
  }

  /** Load a line pre-generated with `vox bake` and shipped with your game. */
  async loadBaked(url) {
    const bytes = await (await fetch(url)).arrayBuffer();
    const buffer = await this.audio.decodeAudioData(bytes);
    return this._line(buffer, null, { take: null, duration: buffer.duration, segments: [] });
  }
}
