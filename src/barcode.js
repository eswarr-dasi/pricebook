// Barcode normalization and in-browser scanning.
//
// Canonical internal form is EAN-13. UPC-A is left padded with a zero so that
// one product has exactly one key in the price book and in the product cache.
// Retailer specific transforms live here too, never in the UI.

import { decodeFrame } from './ean.js';

export function digitsOnly(raw) {
  return String(raw == null ? '' : raw).replace(/[^0-9]/g, '');
}

export function normalize(raw) {
  const d = digitsOnly(raw);
  if (d.length === 13) return d;
  if (d.length === 12) return '0' + d;      // UPC-A -> EAN-13
  if (d.length === 8) return d;             // EAN-8 stays as is
  if (d.length === 14) return d.slice(1);   // GTIN-14 case code, drop indicator
  return null;
}

export function checkDigit(body) {
  const d = digitsOnly(body);
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code) {
  const d = digitsOnly(code);
  if (d.length !== 13) return false;
  return checkDigit(d.slice(0, 12)) === Number(d[12]);
}

// Kroger public Products API expects a 13 digit productId with the barcode
// check digit omitted. Kept here so phase 2 does not have to rediscover it.
export function toKrogerProductId(code) {
  const d = digitsOnly(code);
  if (!d) return null;
  return d.slice(0, -1).padStart(13, '0');
}

export function supportsNativeScan() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

// Whether the camera path is available at all. This is the check the UI should
// use. Safari has no BarcodeDetector, so it takes the built in decoder path.
export function canScan() {
  return !!(typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia);
}

export function scanMode() {
  return supportsNativeScan() ? 'native' : 'builtin';
}

const WANTED_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const FRAME_INTERVAL_MS = 140;
const MAX_FRAME_WIDTH = 800;

// Wraps a video element. Uses the platform BarcodeDetector when it exists,
// otherwise decodes frames with src/ean.js. Either way the caller gets the same
// callback, and manual digit entry remains available as a first class path.
export function createScanner(videoEl) {
  let stream = null;
  let detector = null;
  let canvas = null;
  let ctx = null;
  let timer = 0;
  let running = false;
  let lastCode = null;

  async function start(onResult, onError) {
    if (running) return true;
    if (!canScan()) {
      if (onError) onError(new Error('NO_CAMERA_API'));
      return false;
    }
    try {
      if (supportsNativeScan()) {
        const Detector = window.BarcodeDetector;
        let formats = WANTED_FORMATS;
        if (Detector.getSupportedFormats) {
          const available = await Detector.getSupportedFormats();
          formats = WANTED_FORMATS.filter(function (f) { return available.indexOf(f) >= 0; });
        }
        if (formats.length) detector = new Detector({ formats: formats });
      }
      if (!detector) {
        canvas = document.createElement('canvas');
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      videoEl.srcObject = stream;
      videoEl.hidden = false;
      videoEl.setAttribute('playsinline', '');
      await videoEl.play();
      running = true;
      tick(onResult);
      return true;
    } catch (err) {
      if (onError) onError(err);
      stop();
      return false;
    }
  }

  async function readNative() {
    const found = await detector.detect(videoEl);
    if (!found || !found.length) return null;
    return { raw: found[0].rawValue, format: found[0].format };
  }

  function readBuiltin() {
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return null;
    const scale = Math.min(1, MAX_FRAME_WIDTH / vw);
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(videoEl, 0, 0, w, h);
    const hit = decodeFrame(ctx.getImageData(0, 0, w, h), { rows: 9, budgetMs: 60 });
    return hit ? { raw: hit.code, format: hit.format } : null;
  }

  async function tick(onResult) {
    if (!running) return;
    try {
      const hit = detector ? await readNative() : readBuiltin();
      if (hit) {
        const code = normalize(hit.raw);
        if (code && code !== lastCode) {
          lastCode = code;
          if (navigator.vibrate) navigator.vibrate(30);
          onResult({ code: code, raw: hit.raw, format: hit.format, mode: scanMode() });
        }
      }
    } catch (err) {
      // Decode failures on individual frames are normal. Keep scanning.
    }
    timer = setTimeout(function () { tick(onResult); }, FRAME_INTERVAL_MS);
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = 0;
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl.hidden = true;
    }
    lastCode = null;
  }

  return {
    start: start,
    stop: stop,
    isRunning: function () { return running; },
    reset: function () { lastCode = null; },
    mode: scanMode
  };
}
