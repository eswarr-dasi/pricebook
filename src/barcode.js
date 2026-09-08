// Barcode normalization and in-browser scanning.
//
// Canonical internal form is EAN-13. UPC-A is left padded with a zero so that
// one product has exactly one key in the price book and in the product cache.
// Retailer specific transforms live here too, never in the UI.

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

const WANTED_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const FRAME_INTERVAL_MS = 140;

// Wraps a video element. Native BarcodeDetector where available.
// Where it is not available the caller falls back to manual entry, which is a
// deliberate choice: no scanner library is bundled, so the app stays tiny and
// fully offline with no third party code.
export function createScanner(videoEl) {
  let stream = null;
  let detector = null;
  let timer = 0;
  let running = false;
  let lastCode = null;

  async function start(onResult, onError) {
    if (running) return true;
    if (!supportsNativeScan()) {
      if (onError) onError(new Error('NO_DETECTOR'));
      return false;
    }
    try {
      const Detector = window.BarcodeDetector;
      let formats = WANTED_FORMATS;
      if (Detector.getSupportedFormats) {
        const available = await Detector.getSupportedFormats();
        formats = WANTED_FORMATS.filter(function (f) { return available.indexOf(f) >= 0; });
      }
      if (!formats.length) {
        if (onError) onError(new Error('NO_FORMATS'));
        return false;
      }
      detector = new Detector({ formats: formats });
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

  async function tick(onResult) {
    if (!running) return;
    try {
      const found = await detector.detect(videoEl);
      if (found && found.length) {
        const raw = found[0].rawValue;
        const code = normalize(raw);
        if (code && code !== lastCode) {
          lastCode = code;
          if (navigator.vibrate) navigator.vibrate(30);
          onResult({ code: code, raw: raw, format: found[0].format });
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
    reset: function () { lastCode = null; }
  };
}
