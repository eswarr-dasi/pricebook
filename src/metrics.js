// The three value metrics, plus the satiety estimate.
//
// Rules baked in here on purpose:
//   - no grades, no good or bad labels, no targets, no streaks
//   - every estimate carries its inputs so anyone can see how it was made
//   - a missing input returns null, never a guess dressed up as a number

export function num(v) {
  // Number('') and Number(' ') are 0, not NaN, so an empty input would arrive
  // here as a real price of zero. An untouched box is a missing input, and a
  // missing input is a dash, never a number.
  if (typeof v === 'string' && v.trim() === '') return null;
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

// Where this food's energy actually comes from. Atwater factors: 4 kcal per
// gram of protein and of carbohydrate, 9 per gram of fat.
//
// This is a composition, not a target. It says what the food is made of, and
// deliberately never compares that to a daily allowance, because the app has
// no idea what yours should be and is not in the business of deciding.
export const ATWATER = { protein: 4, carbs: 4, fat: 9 };

export function macroSplit(product) {
  const n = per100(product);
  if (n.protein == null && n.carbs == null && n.fat == null) return null;
  const g = {
    protein: n.protein || 0,
    carbs: n.carbs || 0,
    fat: n.fat || 0
  };
  const kcal = {
    protein: g.protein * ATWATER.protein,
    carbs: g.carbs * ATWATER.carbs,
    fat: g.fat * ATWATER.fat
  };
  const total = kcal.protein + kcal.carbs + kcal.fat;
  if (!total) return null;
  return {
    grams: g,
    kcal: kcal,
    totalKcal: total,
    pct: {
      protein: (kcal.protein / total) * 100,
      carbs: (kcal.carbs / total) * 100,
      fat: (kcal.fat / total) * 100
    },
    // A partial record makes a split that does not describe the whole food.
    partial: n.protein == null || n.carbs == null || n.fat == null
  };
}

// The published per-100g figures scaled to one serving. Returns null per field
// rather than guessing when either the figure or the serving size is missing.
export function perServing(product) {
  const n = per100(product);
  const srv = servingGrams(product);
  const out = { servingGrams: srv };
  Object.keys(n).forEach(function (k) {
    out[k] = n[k] == null || srv == null ? null : (n[k] * srv) / 100;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Product score, 0 to 100.
//
// Added 2026-09-07 by product decision; see the reversal note in
// docs/PRODUCT.md. The one condition attached to it there is enforced here in
// code rather than in the UI: every score carries the itemised reasons that
// produced it, so callers cannot render the number without being handed its
// justification in the same object.
//
// Composition: 60 nutrition, 30 additives, 10 organic label.
// An incomplete record scores null. A missing field is never treated as a zero.
// ---------------------------------------------------------------------------

// Status colours are reserved and fixed; they never re-theme. Each band always
// travels with its label, because a colour alone is not an accessible verdict.
export const GRADE_BANDS = [
  { min: 75, key: 'excellent', label: 'Excellent', color: '#0ca30c' },
  { min: 50, key: 'good',      label: 'Good',      color: '#fab219' },
  { min: 25, key: 'poor',      label: 'Poor',      color: '#ec835a' },
  { min: 0,  key: 'bad',       label: 'Bad',       color: '#d03b3b' }
];

export function gradeBand(score) {
  return GRADE_BANDS.find(function (b) { return score >= b.min; }) || GRADE_BANDS[GRADE_BANDS.length - 1];
}

// Linear ramp between a floor where the penalty is nothing and a ceiling where
// it is everything. Thresholds follow the Nutri-Score reference points.
function ramp(value, zeroAt, fullAt, points) {
  if (value <= zeroAt) return 0;
  if (value >= fullAt) return points;
  return ((value - zeroAt) / (fullAt - zeroAt)) * points;
}

const NEGATIVES = [
  { k: 'kcal',    label: 'Energy',        zero: 80,  full: 800, points: 10, unit: ' kcal/100 g' },
  { k: 'sugars',  label: 'Sugars',        zero: 4.5, full: 45,  points: 10, unit: ' g/100 g' },
  { k: 'satFat',  label: 'Saturated fat', zero: 1,   full: 10,  points: 10, unit: ' g/100 g' },
  { k: 'salt',    label: 'Salt',          zero: 0.3, full: 3,   points: 10, unit: ' g/100 g' }
];
const POSITIVES = [
  { k: 'protein', label: 'Protein', zero: 1.6, full: 16, points: 10, unit: ' g/100 g' },
  { k: 'fiber',   label: 'Fibre',   zero: 0.9, full: 9,  points: 10, unit: ' g/100 g' }
];

const ADDITIVE_POINTS = 30;
const ADDITIVE_COST = 6;      // per listed additive
const ORGANIC_POINTS = 10;

export function grade(product) {
  const n = per100(product);
  const missing = [];
  NEGATIVES.concat(POSITIVES).forEach(function (d) {
    if (n[d.k] == null) missing.push(d.label.toLowerCase());
  });
  const additivesN = product && product.additives_n != null
    ? Number(product.additives_n)
    : (product && product.additives_tags ? product.additives_tags.length : null);
  if (additivesN == null || !isFinite(additivesN)) missing.push('additives');
  if (missing.length) return { score: null, missing: missing };

  const reasons = [];
  let penalty = 0;
  NEGATIVES.forEach(function (d) {
    const pts = ramp(n[d.k], d.zero, d.full, d.points);
    penalty += pts;
    reasons.push({
      kind: pts >= d.points / 2 ? 'negative' : 'neutral',
      label: d.label,
      detail: round(n[d.k], 1) + d.unit,
      points: -round(pts, 1)
    });
  });
  let bonus = 0;
  POSITIVES.forEach(function (d) {
    const pts = ramp(n[d.k], d.zero, d.full, d.points);
    bonus += pts;
    reasons.push({
      kind: pts > 0 ? 'positive' : 'neutral',
      label: d.label,
      detail: round(n[d.k], 1) + d.unit,
      points: round(pts, 1)
    });
  });
  const nutrition = clamp(0, 60, 40 - penalty + bonus);

  const additives = Math.max(0, ADDITIVE_POINTS - additivesN * ADDITIVE_COST);
  reasons.push({
    kind: additivesN === 0 ? 'positive' : (additives === 0 ? 'negative' : 'neutral'),
    label: 'Additives',
    detail: additivesN === 0 ? 'none listed' : additivesN + ' listed',
    points: round(additives - ADDITIVE_POINTS, 1)
  });

  const labels = (product && product.labels_tags) || [];
  const organic = labels.some(function (t) { return /organic|bio$/i.test(String(t)); });
  reasons.push({
    kind: organic ? 'positive' : 'neutral',
    label: 'Organic label',
    detail: organic ? 'published' : 'none published',
    points: organic ? ORGANIC_POINTS : 0
  });

  const score = Math.round(clamp(0, 100, nutrition + additives + (organic ? ORGANIC_POINTS : 0)));
  return {
    score: score,
    band: gradeBand(score),
    parts: { nutrition: round(nutrition, 1), additives: additives, organic: organic ? ORGANIC_POINTS : 0 },
    reasons: reasons.sort(function (a, b) { return a.points - b.points; }),
    missing: []
  };
}

function clamp(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

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

// ---------------------------------------------------------------------------
// Additive reference.
//
// Levels follow the outcome of the EFSA re-evaluation programme, plus the two
// advisories that carry a legal consequence in the EU: the Southampton colours,
// which must be labelled as possibly affecting attention in children, and the
// nitrite/nitrate group covered by the IARC processed-meat classification.
//
// Two rules keep this honest:
//   - an additive not in this table reads "not classified here", never "safe"
//   - the level describes a published assessment, not this app's opinion, and
//     every row is one tap from the source
// ---------------------------------------------------------------------------

export const ADDITIVE_LEVELS = {
  none:     { label: 'No known concern', rank: 0 },
  low:      { label: 'Limited concern',  rank: 1 },
  moderate: { label: 'Moderate concern', rank: 2 },
  high:     { label: 'High concern',     rank: 3 },
  unknown:  { label: 'Not classified here', rank: -1 }
};

const SOUTHAMPTON = 'Must be labelled in the EU as possibly affecting activity and attention in children.';

export const ADDITIVES = {
  E100: ['none', 'Curcumin, the colour in turmeric.'],
  E101: ['none', 'Riboflavin, vitamin B2.'],
  E102: ['moderate', 'Tartrazine. ' + SOUTHAMPTON],
  E104: ['moderate', 'Quinoline yellow. ' + SOUTHAMPTON],
  E110: ['moderate', 'Sunset yellow. ' + SOUTHAMPTON],
  E120: ['low', 'Cochineal. A recognised allergen for a small number of people.'],
  E122: ['moderate', 'Azorubine. ' + SOUTHAMPTON],
  E124: ['moderate', 'Ponceau 4R. ' + SOUTHAMPTON],
  E129: ['moderate', 'Allura red. ' + SOUTHAMPTON],
  E131: ['low', 'Patent blue V. Rare allergic reactions reported.'],
  E132: ['low', 'Indigotine.'],
  E133: ['low', 'Brilliant blue.'],
  E150A: ['none', 'Plain caramel, made without ammonia or sulphite.'],
  E150C: ['low', 'Ammonia caramel. Can carry 4-methylimidazole.'],
  E150D: ['low', 'Sulphite ammonia caramel. Can carry 4-methylimidazole.'],
  E160A: ['none', 'Carotenes, the colour in carrots.'],
  E162: ['none', 'Beetroot red.'],
  E163: ['none', 'Anthocyanins, the colour in berries.'],
  E170: ['none', 'Calcium carbonate, chalk.'],
  E171: ['high', 'Titanium dioxide. EFSA concluded in 2021 it can no longer be considered safe as a food additive; banned in EU food since 2022.'],
  E200: ['none', 'Sorbic acid.'],
  E202: ['low', 'Potassium sorbate.'],
  E210: ['moderate', 'Benzoic acid. Can form benzene with vitamin C in drinks.'],
  E211: ['moderate', 'Sodium benzoate. Can form benzene with vitamin C in drinks.'],
  E212: ['moderate', 'Potassium benzoate.'],
  E220: ['moderate', 'Sulphur dioxide. Must be declared as an allergen above 10 mg/kg.'],
  E221: ['moderate', 'Sodium sulphite. Allergen labelling applies.'],
  E223: ['moderate', 'Sodium metabisulphite. Allergen labelling applies.'],
  E224: ['moderate', 'Potassium metabisulphite. Allergen labelling applies.'],
  E249: ['high', 'Potassium nitrite. Nitrites in processed meat fall under the IARC group 1 classification for processed meat.'],
  E250: ['high', 'Sodium nitrite. Nitrites in processed meat fall under the IARC group 1 classification for processed meat.'],
  E251: ['high', 'Sodium nitrate. Same nitrosamine pathway as the nitrites.'],
  E252: ['high', 'Potassium nitrate. Same nitrosamine pathway as the nitrites.'],
  E270: ['none', 'Lactic acid.'],
  E280: ['low', 'Propionic acid.'],
  E296: ['none', 'Malic acid, the acid in apples.'],
  E300: ['none', 'Ascorbic acid, vitamin C.'],
  E306: ['none', 'Tocopherol extract, vitamin E.'],
  E307: ['none', 'Alpha-tocopherol, vitamin E.'],
  E320: ['moderate', 'BHA. Classified by IARC as possibly carcinogenic to humans, group 2B.'],
  E321: ['moderate', 'BHT. Under review; evidence is mixed.'],
  E322: ['none', 'Lecithins, usually from soy or sunflower.'],
  E330: ['none', 'Citric acid.'],
  E331: ['none', 'Sodium citrates.'],
  E338: ['low', 'Phosphoric acid. Part of total phosphate intake, which EFSA flagged in 2019.'],
  E407: ['low', 'Carrageenan. EFSA could not exclude concerns for infants in 2018.'],
  E410: ['none', 'Locust bean gum.'],
  E412: ['none', 'Guar gum.'],
  E414: ['none', 'Acacia gum.'],
  E415: ['none', 'Xanthan gum.'],
  E420: ['low', 'Sorbitol. Laxative effect above about 20 g.'],
  E422: ['none', 'Glycerol.'],
  E440: ['none', 'Pectin, from fruit.'],
  E450: ['low', 'Diphosphates. Part of total phosphate intake, flagged by EFSA in 2019.'],
  E451: ['low', 'Triphosphates. Part of total phosphate intake.'],
  E452: ['low', 'Polyphosphates. Part of total phosphate intake.'],
  E466: ['low', 'Carboxymethylcellulose. Emulsifier; gut-microbiome work is ongoing.'],
  E471: ['low', 'Mono- and diglycerides of fatty acids.'],
  E476: ['low', 'PGPR, a cocoa-butter replacer in chocolate.'],
  E500: ['none', 'Sodium carbonates, baking soda.'],
  E501: ['none', 'Potassium carbonates.'],
  E503: ['none', 'Ammonium carbonates.'],
  E508: ['none', 'Potassium chloride, a salt substitute.'],
  E551: ['low', 'Silicon dioxide, an anti-caking agent.'],
  E621: ['low', 'Monosodium glutamate. EFSA set a group intake limit in 2017.'],
  E627: ['low', 'Disodium guanylate.'],
  E631: ['low', 'Disodium inosinate.'],
  E635: ['low', 'Disodium ribonucleotides.'],
  E900: ['low', 'Dimethylpolysiloxane, an anti-foaming agent.'],
  E901: ['none', 'Beeswax.'],
  E903: ['none', 'Carnauba wax.'],
  E950: ['low', 'Acesulfame K.'],
  E951: ['moderate', 'Aspartame. Classified by IARC in 2023 as possibly carcinogenic to humans, group 2B.'],
  E952: ['moderate', 'Cyclamate. Banned in the United States since 1970; permitted in the EU.'],
  E954: ['low', 'Saccharin.'],
  E955: ['low', 'Sucralose.'],
  E960: ['none', 'Steviol glycosides, from the stevia leaf.'],
  E965: ['low', 'Maltitol. Laxative effect in quantity.'],
  E967: ['low', 'Xylitol. Laxative effect in quantity.'],
  E968: ['low', 'Erythritol.']
};

export const ADDITIVE_SOURCE = 'https://world.openfoodfacts.org/additives';

// "en:e330" and "en:e150d" both arrive from Open Food Facts; normalise to E330.
export function additiveCode(tag) {
  const t = String(tag).replace(/^[a-z]{2}:/, '').trim().toUpperCase();
  return /^E\d+[A-Z]*$/.test(t) ? t : null;
}

export function additiveInfo(tag) {
  const code = additiveCode(tag);
  // Open Food Facts emits sub-forms like E322i for lecithins. Where the exact
  // form is not listed, fall back to the base number, which is the same
  // substance. E150a to E150d stay distinct because they are listed separately.
  let row = code ? ADDITIVES[code] : null;
  if (!row && code) row = ADDITIVES[code.replace(/[A-Z]+$/, '')] || null;
  const level = row ? row[0] : 'unknown';
  return {
    code: code || String(tag),
    level: level,
    label: ADDITIVE_LEVELS[level].label,
    rank: ADDITIVE_LEVELS[level].rank,
    note: row ? row[1] : 'Not in this app\'s reference table. That means it has not been looked up here, not that it is safe.'
  };
}

// Worst level present, for the summary line. Unknowns never raise the summary,
// because an unassessed additive is an absence of information, not a finding.
export function additiveSummary(tags) {
  const rows = (tags || []).map(additiveInfo);
  let worst = 'none';
  rows.forEach(function (r) {
    if (r.rank > ADDITIVE_LEVELS[worst].rank) worst = r.level;
  });
  return {
    rows: rows.sort(function (a, b) { return b.rank - a.rank; }),
    worst: rows.length ? worst : null,
    unknowns: rows.filter(function (r) { return r.level === 'unknown'; }).length
  };
}

// ---------------------------------------------------------------------------
// Dietary preferences. Declared by the user, matched against published tags.
// A tag that is absent yields "unknown", never "fine".
// ---------------------------------------------------------------------------

export const DIETS = [
  { key: 'vegan',      label: 'Vegan' },
  { key: 'vegetarian', label: 'Vegetarian' },
  { key: 'gluten',     label: 'Gluten free' },
  { key: 'dairy',      label: 'Dairy free' },
  { key: 'nuts',       label: 'Nut free' }
];

function has(list, value) {
  return (list || []).some(function (t) { return String(t) === value; });
}

export function dietCheck(product, prefs) {
  const active = DIETS.filter(function (d) { return prefs && prefs[d.key]; });
  if (!active.length) return [];
  const an = (product && product.ingredients_analysis_tags) || [];
  const al = (product && product.allergens_tags) || [];
  const tr = (product && product.traces_tags) || [];
  const lb = (product && product.labels_tags) || [];

  return active.map(function (d) {
    let state = 'unknown';
    let why = 'Not published for this item.';
    if (d.key === 'vegan') {
      if (has(an, 'en:non-vegan')) { state = 'conflict'; why = 'Tagged non-vegan.'; }
      else if (has(an, 'en:vegan')) { state = 'ok'; why = 'Tagged vegan.'; }
    } else if (d.key === 'vegetarian') {
      if (has(an, 'en:non-vegetarian')) { state = 'conflict'; why = 'Tagged non-vegetarian.'; }
      else if (has(an, 'en:vegetarian')) { state = 'ok'; why = 'Tagged vegetarian.'; }
    } else if (d.key === 'gluten') {
      if (has(al, 'en:gluten')) { state = 'conflict'; why = 'Gluten listed as an allergen.'; }
      else if (has(tr, 'en:gluten')) { state = 'trace'; why = 'Listed under traces.'; }
      else if (has(lb, 'en:no-gluten') || has(lb, 'en:gluten-free')) { state = 'ok'; why = 'Carries a gluten free label.'; }
    } else if (d.key === 'dairy') {
      if (has(al, 'en:milk')) { state = 'conflict'; why = 'Milk listed as an allergen.'; }
      else if (has(tr, 'en:milk')) { state = 'trace'; why = 'Listed under traces.'; }
      else if (has(an, 'en:vegan')) { state = 'ok'; why = 'Tagged vegan.'; }
    } else if (d.key === 'nuts') {
      if (has(al, 'en:nuts') || has(al, 'en:peanuts')) { state = 'conflict'; why = 'Nuts listed as an allergen.'; }
      else if (has(tr, 'en:nuts') || has(tr, 'en:peanuts')) { state = 'trace'; why = 'Listed under traces.'; }
    }
    return { key: d.key, label: d.label, state: state, why: why };
  });
}

// ---------------------------------------------------------------------------
// Trends. Buckets a log into calendar days, oldest first, gaps included as
// zero-logged days so a run of blanks is visible rather than compressed away.
// ---------------------------------------------------------------------------

export function dailySeries(rows, days, todayKey) {
  const bucket = {};
  rows.forEach(function (r) {
    const t = logTotals([r]);
    if (!bucket[r.day]) bucket[r.day] = { kcal: 0, protein: 0, items: 0 };
    bucket[r.day].kcal += t.kcal || 0;
    bucket[r.day].protein += t.protein || 0;
    bucket[r.day].items += 1;
  });
  const parts = String(todayKey).split('-');
  const cursor = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(cursor.getTime());
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
    const b = bucket[key] || { kcal: 0, protein: 0, items: 0 };
    out.push({ day: key, date: d, kcal: b.kcal, protein: b.protein, items: b.items });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aggregate score, for a day of food or a basket of shopping.
//
// The weighted mean of the individual product scores. Two rules decide whether
// this is honest or not:
//
//   - an item with no published score is EXCLUDED, never counted as zero. A gap
//     in Open Food Facts is not evidence about the food.
//   - the count of excluded items comes back with the answer, so the caller can
//     say how much of the basket the number actually describes. A score over
//     two of nine items is not a verdict on the shop.
//
// Weight is servings for a day of food and money for a basket, because those
// are what each is actually made of.
// ---------------------------------------------------------------------------

export const MIN_COVERAGE = 0.5;

export function aggregateScore(rows) {
  let sum = 0;
  let weight = 0;
  let counted = 0;
  let uncounted = 0;

  (rows || []).forEach(function (r) {
    const sc = num(r && r.score);
    if (sc == null) { uncounted++; return; }
    let w = num(r.weight);
    if (w == null || w <= 0) w = 1;
    sum += sc * w;
    weight += w;
    counted++;
  });

  if (!counted || weight <= 0) {
    return { score: null, band: null, counted: 0, uncounted: uncounted, coverage: 0, thin: true };
  }
  const score = sum / weight;
  const coverage = counted / (counted + uncounted);
  return {
    score: score,
    band: gradeBand(Math.round(score)),
    counted: counted,
    uncounted: uncounted,
    coverage: coverage,
    // Flagged rather than hidden: the caller shows the number and the caveat
    // together, instead of quietly presenting a third of a basket as the whole.
    thin: coverage < MIN_COVERAGE
  };
}

// ---------------------------------------------------------------------------
// Daily targets and streak.
//
// Targets are whatever the user typed. The app never derives one from height,
// weight, age or sex, and never suggests a number, which is the mitigation
// recorded against this feature in docs/PRODUCT.md.
// ---------------------------------------------------------------------------

export const DEFAULT_GOALS = { kcal: null, protein: null, carbs: null, fat: null };

// Below this the standing advice is medical supervision, so the UI flags it.
// It is a note, never a block: it is the user's number.
export const LOW_KCAL_TARGET = 1200;

export function logTotals(rows) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, items: rows.length };
  const known = { kcal: false, protein: false, carbs: false, fat: false };
  rows.forEach(function (r) {
    const mult = num(r.servings) == null ? 1 : num(r.servings);
    ['kcal', 'protein', 'carbs', 'fat'].forEach(function (k) {
      const v = num(r[k]);
      if (v == null) return;
      t[k] += v * mult;
      known[k] = true;
    });
  });
  ['kcal', 'protein', 'carbs', 'fat'].forEach(function (k) {
    if (!known[k]) t[k] = null;
  });
  return t;
}

// Consecutive calendar days ending today, or ending yesterday when nothing has
// been logged yet today - so the streak does not appear broken at breakfast.
export function streak(days, todayKey) {
  if (!days || !days.length) return 0;
  const set = {};
  days.forEach(function (d) { set[d] = true; });
  const parse = function (k) {
    const p = String(k).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  };
  const shift = function (d, n) {
    const c = new Date(d.getTime());
    c.setDate(c.getDate() + n);
    return c;
  };
  const fmt = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  };
  const today = parse(todayKey);
  let cursor = set[todayKey] ? today : shift(today, -1);
  if (!set[fmt(cursor)]) return 0;
  let n = 0;
  while (set[fmt(cursor)]) {
    n++;
    cursor = shift(cursor, -1);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Budget.
//
// The design constraint is clicks. Saving a shelf price is already the core
// action of the app, so the budget is computed from prices you were going to
// record anyway. The only new input is one tap when you walk into the store,
// not one tap per item.
//
// Nothing here congratulates or scolds. Over the line is a number, the same way
// under it is a number.
// ---------------------------------------------------------------------------

export const BUDGET_PERIODS = [
  { key: 'week',  label: 'Weekly' },
  { key: 'month', label: 'Monthly' }
];

// Weeks start Monday, months on the 1st. Local time throughout, because a
// grocery week is a calendar question, not a UTC one.
export function periodBounds(period, now) {
  const d = now == null ? new Date() : new Date(now);
  if (period === 'month') {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { start: start.getTime(), end: end.getTime(), label: 'this month' };
  }
  const dow = (d.getDay() + 6) % 7;         // Monday = 0
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 7);
  return { start: start.getTime(), end: end.getTime(), label: 'this week' };
}

export function budgetStatus(spent, budget, bounds, now) {
  const at = now == null ? Date.now() : now;
  const day = 86400000;
  const daysLeft = Math.max(0, Math.ceil((bounds.end - at) / day));
  const totalDays = Math.round((bounds.end - bounds.start) / day);
  const elapsed = Math.max(0, Math.min(totalDays, (at - bounds.start) / day));
  if (budget == null || !(budget > 0)) {
    return { spent: spent, budget: null, left: null, pct: null,
             daysLeft: daysLeft, perDay: null, expected: null, label: bounds.label };
  }
  const left = budget - spent;
  return {
    spent: spent,
    budget: budget,
    left: left,
    pct: Math.max(0, Math.min(100, (spent / budget) * 100)),
    over: left < 0,
    daysLeft: daysLeft,
    // What is left, spread over the days that remain. Null on the last day so
    // the app does not print a per-day figure for zero days.
    perDay: daysLeft > 0 ? left / daysLeft : null,
    // Where a flat spend rate would have put you by now. Shown as a reference
    // point, not as a pass or fail.
    expected: (budget / totalDays) * elapsed,
    label: bounds.label
  };
}

// ---------------------------------------------------------------------------
// Visible uncertainty.
//
// PRODUCT.md section 9 promises a range on every estimate, and until now only
// the satiety score carried one. Cost per serving is shown in 54px type and is
// no more certain: it inherits a serving size a stranger typed into a community
// database. Where that number was parsed out of free text rather than published
// as a figure, the cost per serving gets a band and says why.
// ---------------------------------------------------------------------------

export const PARSED_SERVING_TOLERANCE = 0.15;

export function servingBasis(product) {
  const declared = num(product && product.serving_quantity);
  if (declared && declared > 0) {
    return { basis: 'declared', grams: declared,
             note: 'Serving size published as a figure.' };
  }
  const parsed = parseQuantity(product && product.serving_size);
  if (parsed) {
    return { basis: 'parsed', grams: parsed,
             note: 'Serving size read from the text "' + String(product.serving_size).trim() +
                   '", so treat it as approximate.' };
  }
  return { basis: 'none', grams: null, note: 'No serving size published.' };
}

// Returns null when there is nothing to be uncertain about, so callers can show
// a plain figure rather than a fake band.
export function costPerServingRange(product, price) {
  const p = num(price);
  const servings = servingsPerPackage(product);
  const b = servingBasis(product);
  if (p == null || !servings || b.basis !== 'parsed') return null;
  const mid = p / servings;
  return {
    low: mid / (1 + PARSED_SERVING_TOLERANCE),
    high: mid / (1 - PARSED_SERVING_TOLERANCE),
    note: b.note
  };
}

// ---------------------------------------------------------------------------
// Eating out delta. PRODUCT.md section 6.
//
// One number the user sets for what a comparable meal out costs them. The app
// never guesses it, because it varies by city, and a guessed baseline would
// make the comparison flattering rather than true.
// ---------------------------------------------------------------------------

export function eatingOutDelta(costPerServing, takeoutCost, household) {
  const cost = num(costPerServing);
  const out = num(takeoutCost);
  if (cost == null || out == null || out <= 0) return null;
  const people = Math.max(1, Number(household || 1));
  const home = cost * people;
  const away = out * people;
  return {
    people: people,
    home: home,
    away: away,
    saved: away - home,
    ratio: home > 0 ? away / home : null
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
