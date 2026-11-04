// Gets a picture ready to upload: opens any image file the browser can read
// (JPG, PNG, GIF, WebP, AVIF, BMP, SVG, ICO, and HEIC or TIFF where the browser
// supports them), shrinks it and saves it as WebP (or JPEG on browsers that
// cannot write WebP). Only the result is sent, never the original file, so
// the server stores small, safe pictures (server/src/story-images.js).
//
// Used by the Suggest a storyline page (storyline-page.js) and the admin
// dashboard's Story beat pictures. admin/image-prep.js is a copy
// (server/test/story-images.test.mjs checks they match).

// For <input type="file" accept="...">: every image type, plus the extensions
// some phones and computers do not label as images.
export const ACCEPT = 'image/*,.heic,.heif,.avif,.jxl,.tif,.tiff,.bmp,.ico,.svg,.jfif,.webp';

const CANNOT_OPEN = 'This browser cannot open that kind of picture. Save it as a JPG or PNG and try again.';

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch (e) { /* try an <img> below (SVG, some HEIC) */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    // An SVG with no size of its own gets a sensible one.
    if (!img.naturalWidth || !img.naturalHeight) { img.width = 1200; img.height = 900; }
    return img;
  } catch (e) {
    throw new Error(CANNOT_OPEN);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const bytesOf = (dataUrl) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

// Returns { dataUrl, width, height, name, bytes }. Throws an Error with a
// message to show the person when the picture cannot be used.
export async function prepareImage(file, { maxSide = 1600, maxBytes = 850_000 } = {}) {
  if (!file) throw new Error('Choose a picture.');
  if (file.size > 60 * 1024 * 1024) throw new Error('That picture is over 60 MB. Try a smaller one.');
  const src = await decode(file);
  const w0 = src.naturalWidth || src.width;
  const h0 = src.naturalHeight || src.height;
  if (!w0 || !h0) throw new Error(CANNOT_OPEN);
  let side = maxSide;
  for (let round = 0; round < 6; round++) {
    const scale = Math.min(1, side / Math.max(w0, h0));
    const width = Math.max(1, Math.round(w0 * scale));
    const height = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const cx = canvas.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, 0, 0, width, height);
    for (const q of [0.85, 0.72, 0.6]) {
      let dataUrl = canvas.toDataURL('image/webp', q);
      if (!dataUrl.startsWith('data:image/webp')) {
        // No WebP writer (older Safari): JPEG on white, since JPEG has no see-through parts.
        const flat = document.createElement('canvas');
        flat.width = width;
        flat.height = height;
        const fx = flat.getContext('2d');
        fx.fillStyle = '#fff';
        fx.fillRect(0, 0, width, height);
        fx.drawImage(canvas, 0, 0);
        dataUrl = flat.toDataURL('image/jpeg', q);
      }
      const bytes = bytesOf(dataUrl);
      if (bytes <= maxBytes) {
        if (typeof src.close === 'function') src.close();
        return { dataUrl, width, height, bytes, name: String(file.name || 'picture').slice(0, 80) };
      }
    }
    side = Math.round(side * 0.75);
  }
  throw new Error('That picture is too detailed to send. Try a smaller one.');
}
