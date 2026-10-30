// Finds the face in a character's picture (MediaPipe Face Landmarker,
// Apache-2.0), off the main thread, so the talking face (js/talking-face.js)
// knows where the eyes, lips and chin are. The engine and its model ship with
// the app (vendor/mediapipe, about 13 MB, loaded only when a face first
// talks), so nothing is sent anywhere.
//
// A classic worker: the library's loader uses importScripts, which module
// workers do not have.
/* global importScripts */
self.exports = {};
self.module = { exports: self.exports };
importScripts('./vendor/mediapipe/vision_bundle.js');
// Kept in its own scope: the library's names share this worker's global one.
(() => {
  const { FaceLandmarker, FilesetResolver } = self.module.exports;

  // The points the talking face needs (MediaPipe's face mesh numbering).
  const POINTS = {
    mouthL: 61, mouthR: 291, lipTop: 0, lipUpIn: 13, lipLowIn: 14, lipBottom: 17, chin: 152,
    noseTip: 1, browMid: 9,
    eyeLOut: 33, eyeLIn: 133, eyeLTop: 159, eyeLBot: 145,
    eyeROut: 263, eyeRIn: 362, eyeRTop: 386, eyeRBot: 374,
    jawL: 172, jawR: 397,
  };

  let ready = null;
  function load() {
    ready ||= (async () => {
      const base = new URL('./vendor/mediapipe/', self.location.href).href;
      const files = await FilesetResolver.forVisionTasks(base.replace(/\/$/, ''));
      return FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
      });
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }

  self.onmessage = async (e) => {
    const { id, bitmap } = e.data || {};
    try {
      const marker = await load();
      const out = marker.detect(bitmap);
      const lm = out.faceLandmarks && out.faceLandmarks[0];
      if (!lm) { self.postMessage({ id, face: null }); return; }
      const face = {};
      for (const [k, i] of Object.entries(POINTS)) face[k] = [lm[i].x, lm[i].y];
      self.postMessage({ id, face });
    } catch (err) {
      self.postMessage({ id, error: String((err && err.message) || err) });
    } finally {
      if (bitmap && bitmap.close) bitmap.close();
    }
  };
})();
