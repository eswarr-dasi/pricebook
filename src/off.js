// Open Food Facts client. Cache first, network second, always attributed.
//
// Open Food Facts is free, needs no key, and rate limits anonymous callers, so
// every lookup is cached locally and the cache is served in the aisle. Data is
// ODbL licensed and community maintained, which means it can be wrong. The UI
// says so rather than pretending otherwise.

import * as db from './store.js';

const BASE = 'https://world.openfoodfacts.org/api/v2/product/';

// Only the fields the app actually uses. Smaller payload, faster on bad signal.
export const FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'quantity',
  'product_quantity',
  'serving_size',
  'serving_quantity',
  'ingredients_text',
  'allergens_tags',
  'nutriments',
  'nutriscore_grade',
  'nova_group',
  'categories_tags',
  'image_front_small_url'
].join(',');

const TIMEOUT_MS = 8000;
const FRESH_FOR_MS = 1000 * 60 * 60 * 24 * 30;

export class NotFoundError extends Error {}

function pick(raw) {
  return {
    code: String(raw.code || ''),
    product_name: raw.product_name || raw.generic_name || '',
    brands: raw.brands || '',
    quantity: raw.quantity || '',
    product_quantity: raw.product_quantity == null ? null : Number(raw.product_quantity),
    serving_size: raw.serving_size || '',
    serving_quantity: raw.serving_quantity == null ? null : Number(raw.serving_quantity),
    ingredients_text: raw.ingredients_text || '',
    allergens_tags: raw.allergens_tags || [],
    nutriments: raw.nutriments || {},
    nutriscore_grade: raw.nutriscore_grade || null,
    nova_group: raw.nova_group == null ? null : Number(raw.nova_group),
    categories_tags: raw.categories_tags || [],
    image: raw.image_front_small_url || null,
    attribution: 'Open Food Facts, ODbL'
  };
}

async function fetchProduct(code) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  try {
    const url =
      BASE + encodeURIComponent(code) + '.json?fields=' + encodeURIComponent(FIELDS);
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) throw new NotFoundError(code);
    if (!res.ok) throw new Error('OFF_HTTP_' + res.status);
    const body = await res.json();
    if (!body || body.status !== 1 || !body.product) throw new NotFoundError(code);
    return pick(body.product);
  } finally {
    clearTimeout(timer);
  }
}

// Returns { product, source, cachedAt, ageMs, stale }.
// source is cache or network. The UI must show the age when it is a cache hit,
// because a stale number shown without its age is the one thing we never do.
export async function lookup(code, opts) {
  const options = opts || {};
  const key = String(code);
  let cached = null;
  try {
    cached = await db.getProduct(key);
  } catch (err) {
    cached = null;
  }

  const now = Date.now();
  const fresh = cached && now - cached.cachedAt < FRESH_FOR_MS;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (cached && (fresh || offline) && !options.forceNetwork) {
    return {
      product: cached,
      source: 'cache',
      cachedAt: cached.cachedAt,
      ageMs: now - cached.cachedAt,
      stale: !fresh
    };
  }

  try {
    const product = await fetchProduct(key);
    const saved = await db.putProduct(product);
    return { product: saved, source: 'network', cachedAt: saved.cachedAt, ageMs: 0, stale: false };
  } catch (err) {
    if (cached) {
      return {
        product: cached,
        source: 'cache',
        cachedAt: cached.cachedAt,
        ageMs: now - cached.cachedAt,
        stale: true
      };
    }
    throw err;
  }
}

export function ageLabel(ms) {
  if (ms == null) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + ' h ago';
  const days = Math.round(hours / 24);
  return days + ' d ago';
}

// Nutri-Score and NOVA are third party classifications. We show them as
// published, with a link to the method, and never as our own verdict.
export const CLASSIFIER_LINKS = {
  nutriscore: 'https://world.openfoodfacts.org/nutriscore',
  nova: 'https://world.openfoodfacts.org/nova'
};
