// The three value metrics, plus the satiety estimate.
//
// Rules baked in here on purpose:
//   - no grades, no good or bad labels, no targets, no streaks
//   - every estimate carries its inputs so anyone can see how it was made
//   - a missing input returns null, never a guess dressed up as a number

export function num(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function round(v, d) {
  if (v == null) return null;
  const f = Math.pow(10, d || 0);
  return Math.round(v * f) / f;
}

const UNIT_TO_G = {
  mg: 0.001, g: 1, kg: 1000,
  oz: 28.349523125, lb: 453.59237,
  ml: 1, cl: 10, l: 1000, floz: 29.5735295625
};

// Open Food Facts free text sizes: 5.2 oz, 500 g, 1.5 l, 12 fl oz.
export function parseQuantity(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(',', '.');
  const m = s.match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|mg|g|lbs|lb|fl\s?oz|oz|ml|cl|l)\b/);
  if (!m) return null;
  let unit = m[2].replace(/\s/g, '');
  if (unit === 'lbs') unit = 'lb';
  const factor = UNIT_TO_G[unit];
  return factor ? Number(m[1]) * factor : null;
}

// Field names verified live against the Open Food Facts v2 product endpoint.
export function per100(product) {
  const n = (product && product.nutriments) || {};
  return {
    kcal: num(n['energy-kcal_100g']),
    protein: num(n.proteins_100g),
    fiber: num(n.fiber_100g),
    fat: num(n.fat_100g),
    carbs: num(n.carbohydrates_100g),
    sugars: num(n.sugars_100g),
    salt: num(n.salt_100g),
    satFat: num(n['saturated-fat_100g'])
  };
}

export function packageGrams(product) {
  const pq = num(product && product.product_quantity);
  if (pq && pq > 0) return pq;
  return parseQuantity(product && product.quantity);
}

export function servingGrams(product) {
  const sq = num(product && product.serving_quantity);
  if (sq && sq > 0) return sq;
  return parseQuantity(product && product.serving_size);
}

export function servingsPerPackage(product) {
  const pkg = packageGrams(product);
  const srv = servingGrams(product);
  if (pkg && srv && srv > 0) return pkg / srv;
  return null;
}

// Satiety estimate. Inputs are energy density, protein, fiber and water, which
// are the established drivers of fullness per serving. Weights are a heuristic
// and are exported so they can be shown in the UI and argued with.
export const SATIETY_WEIGHTS = { energyDensity: 0.4, protein: 0.3, fiber: 0.2, water: 0.1 };

export function satiety(product) {
  const n = per100(product);
  if (n.kcal == null || n.protein == null) return null;

  let water = null;
  if (n.carbs != null && n.fat != null) {
    const solids = n.carbs + n.fat + n.protein + (n.fiber || 0) + (n.salt || 0);
    water = Math.max(0, Math.min(100, 100 - solids - 1));
  }

  const energyDensity = n.kcal / 100;
  const edScore = clamp01((4 - energyDensity) / 3.5);
  const proteinScore = clamp01(n.protein / 20);
  const fiberScore = clamp01((n.fiber || 0) / 10);
  const waterScore = water == null ? 0.5 : clamp01(water / 80);

  const score =
    100 *
    (SATIETY_WEIGHTS.energyDensity * edScore +
      SATIETY_WEIGHTS.protein * proteinScore +
      SATIETY_WEIGHTS.fiber * fiberScore +
      SATIETY_WEIGHTS.water * waterScore);

  return {
    isEstimate: true,
    score: Math.round(score),
    low: Math.max(0, Math.round(score - 10)),
    high: Math.min(100, Math.round(score + 10)),
    inputs: {
      energyDensity: round(energyDensity, 2),
      protein: n.protein,
      fiber: n.fiber,
      waterEstimate: water == null ? null : Math.round(water)
    },
    weights: SATIETY_WEIGHTS,
    waterWasEstimated: true
  };
}

// price is what the user paid or saw, for the whole package, in dollars.
export function compute(product, price, opts) {
  const options = opts || {};
  const household = Math.max(1, Number(options.household || 1));
  const p = num(price);
  const n = per100(product);
  const pkg = packageGrams(product);
  const srv = servingGrams(product);
  const servings = servingsPerPackage(product);
  const sat = satiety(product);

  const totalKcal = pkg != null && n.kcal != null ? (n.kcal * pkg) / 100 : null;
  const totalProtein = pkg != null && n.protein != null ? (n.protein * pkg) / 100 : null;

  const costPerServing = p != null && servings ? p / servings : null;
  const costPer100g = p != null && pkg ? (p / pkg) * 100 : null;
  const costPerGramProtein = p != null && totalProtein ? p / totalProtein : null;
  const kcalPerDollar = p != null && p > 0 && totalKcal ? totalKcal / p : null;
  const fullnessPerDollar =
    sat && costPerServing && costPerServing > 0 ? sat.score / costPerServing : null;

  const missing = [];
  if (p == null) missing.push('price');
  if (pkg == null) missing.push('package size');
  if (srv == null) missing.push('serving size');
  if (n.kcal == null) missing.push('calories');
  if (n.protein == null) missing.push('protein');

  return {
    price: p,
    packageGrams: pkg,
    servingGrams: srv,
    servings: servings,
    per100: n,
    totalKcal: totalKcal,
    totalProtein: totalProtein,
    costPerServing: costPerServing,
    costPer100g: costPer100g,
    costPerGramProtein: costPerGramProtein,
    kcalPerDollar: kcalPerDollar,
    fullnessPerDollar: fullnessPerDollar,
    costForHousehold: costPerServing != null ? costPerServing * household : null,
    household: household,
    satiety: sat,
    missing: missing
  };
}

// Formatting. A dash means we do not know, and we say so rather than print a zero.
export const DASH = '--';

export function money(v, digits) {
  if (v == null || !isFinite(v)) return DASH;
  const d = digits == null ? 2 : digits;
  return '$' + v.toFixed(d);
}

export function fmt(v, digits) {
  if (v == null || !isFinite(v)) return DASH;
  return String(round(v, digits == null ? 1 : digits));
}

export function centsPerGramProtein(v) {
  if (v == null || !isFinite(v)) return DASH;
  return (v * 100).toFixed(1) + ' cents';
}
