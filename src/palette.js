// Colour derived from the product, not assigned to it.
//
// Two independent sources:
//   1. the product photograph, sampled for its dominant colour
//   2. the food category, mapped to a fixed hue
//
// Everything that can be computed without a DOM lives above the fold here so
// it can be tested directly; only loadImageColor touches canvas.

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r, g, b) {
  const c = function (v) {
    const n = Math.max(0, Math.min(255, Math.round(v)));
    return (n < 16 ? '0' : '') + n.toString(16);
  };
  return '#' + c(r) + c(g) + c(b);
}

export function rgbToHsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = function (t) {
    let T = t;
    if (T < 0) T += 1;
    if (T > 1) T -= 1;
    if (T < 1 / 6) return p + (q - p) * 6 * T;
    if (T < 1 / 2) return q;
    if (T < 2 / 3) return p + (q - p) * (2 / 3 - T) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Walks a colour's lightness until it clears a contrast target against the
// surface, keeping its hue. A colour taken from a photograph has no obligation
// to be legible, so it is made legible rather than trusted.
export function ensureContrast(hex, bg, target, maxSteps) {
  const steps = maxSteps || 40;
  const [r, g, b] = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  const darken = luminance(bg) > 0.5;
  for (let i = 0; i < steps; i++) {
    const rgb = hslToRgb(h, s, l);
    const candidate = rgbToHex(rgb[0], rgb[1], rgb[2]);
    if (contrast(candidate, bg) >= target) return candidate;
    l = darken ? l - 0.025 : l + 0.025;
    if (l <= 0) return '#000000';
    if (l >= 1) return '#ffffff';
  }
  const rgb = hslToRgb(h, s, l);
  return rgbToHex(rgb[0], rgb[1], rgb[2]);
}

// ---------------------------------------------------------------------------
// Dominant colour of a photograph
// ---------------------------------------------------------------------------

// Open Food Facts photos are overwhelmingly shot on white worktops, so the
// background is the majority of most images. Discarding the washed out, the
// near-black and the grey is what makes the remainder mean anything.
export const SAT_FLOOR = 0.22;
export const LIGHT_CEIL = 0.92;
export const LIGHT_FLOOR = 0.12;
const HUE_BUCKETS = 16;

// pixels is a flat RGBA array. Returns a hex, or null when nothing in the
// picture is colourful enough to speak for it.
export function dominantFromPixels(pixels) {
  const buckets = [];
  for (let i = 0; i < HUE_BUCKETS; i++) buckets.push({ n: 0, r: 0, g: 0, b: 0 });
  let kept = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;                 // transparent
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const hsl = rgbToHsl(r, g, b);
    if (hsl[1] < SAT_FLOOR) continue;                  // grey
    if (hsl[2] > LIGHT_CEIL || hsl[2] < LIGHT_FLOOR) continue;  // paper or shadow
    const slot = Math.min(HUE_BUCKETS - 1, Math.floor(hsl[0] * HUE_BUCKETS));
    const k = buckets[slot];
    k.n++; k.r += r; k.g += g; k.b += b;
    kept++;
  }
  if (kept < 12) return null;                          // not enough to judge

  let best = buckets[0];
  for (let i = 1; i < buckets.length; i++) if (buckets[i].n > best.n) best = buckets[i];
  if (!best.n) return null;
  return rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n);
}

// A full theme from one seed colour: a mark that clears 3:1, ink that clears
// 4.5:1, and a wash light enough to carry body text.
export function themeFrom(hex, dark) {
  const surface = dark ? '#151a22' : '#ffffff';
  const [r, g, b] = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  const washL = dark ? 0.16 : 0.94;
  const wash = hslToRgb(hsl[0], Math.min(hsl[1], 0.55), washL);
  return {
    seed: hex,
    mark: ensureContrast(hex, surface, 3),
    ink: ensureContrast(hex, surface, 4.5),
    wash: rgbToHex(wash[0], wash[1], wash[2])
  };
}

// Reads the photo and hands back a theme. Resolves null on any failure, so a
// blocked image or a grey packet simply falls back to the category colour.
export function loadImageColor(url) {
  return new Promise(function (resolve) {
    if (!url || typeof document === 'undefined') { resolve(null); return; }
    const img = new Image();
    // Open Food Facts serves access-control-allow-origin: *, so the canvas
    // stays untainted and the pixels are readable.
    img.crossOrigin = 'anonymous';
    img.onerror = function () { resolve(null); };
    img.onload = function () {
      try {
        const n = 40;
        const c = document.createElement('canvas');
        c.width = n; c.height = n;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, n, n);
        resolve(dominantFromPixels(ctx.getImageData(0, 0, n, n).data));
      } catch (err) {
        resolve(null);                                  // tainted or decode failure
      }
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Food categories
//
// Order is precedence: the first entry whose pattern matches any tag wins, so
// the specific sits above the general. Nutella carries both en:breakfasts and
// en:sweet-spreads, and it is a sweet spread.
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  { key: 'produce', label: 'Produce',     color: '#178c2e', icon: 'i-leaf',
    match: /fruits|vegetables|legumes|salads|herbs|mushrooms/ },
  { key: 'meat',    label: 'Meat & fish', color: '#c93d76', icon: 'i-meat',
    match: /meats|fishes|seafood|poultry|charcuterie|sausages/ },
  { key: 'dairy',   label: 'Dairy',       color: '#1f6fd0', icon: 'i-milk',
    match: /dairies|milks|cheeses|yogurts|creams|butters/ },
  { key: 'sweet',   label: 'Sweet',       color: '#d6437f', icon: 'i-candy',
    match: /sweet-spreads|chocolates|confectioneries|desserts|candies|sugars|ice-cream/ },
  { key: 'snacks',  label: 'Snacks',      color: '#d9541f', icon: 'i-snack',
    match: /snacks|crisps|chips|biscuits|crackers|nuts|popcorn/ },
  { key: 'drinks',  label: 'Drinks',      color: '#0d8f68', icon: 'i-drink',
    match: /beverages|waters|juices|sodas|coffees|teas|drinks/ },
  { key: 'grains',  label: 'Grains',      color: '#a97400', icon: 'i-grain',
    match: /cereals|breads|pastas|rices|flours|grains|breakfasts/ },
  { key: 'frozen',  label: 'Frozen',      color: '#2a78d6', icon: 'i-frozen',
    match: /frozen/ },
  { key: 'pantry',  label: 'Pantry',      color: '#6438c9', icon: 'i-jar',
    match: /sauces|condiments|oils|spices|canned|preserves|soups|vinegars/ },
  { key: 'baby',    label: 'Baby',        color: '#b0468f', icon: 'i-baby',
    match: /baby/ },
  { key: 'other',   label: 'Other',       color: '#5b6472', icon: 'i-book',
    match: null }
];

export function categoryOf(product) {
  const tags = (product && product.categories_tags) || [];
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    if (!c.match) continue;
    for (let j = 0; j < tags.length; j++) {
      if (c.match.test(String(tags[j]))) return c;
    }
  }
  return CATEGORIES[CATEGORIES.length - 1];
}
