// Local storage layer. IndexedDB only, no account, no server.
//
// Phase 1 of the architecture is deliberately backendless, so this file is the
// whole system of record. Personal best price is always a query over entries,
// never a stored field, so it cannot drift out of date.

const DB_NAME = 'pricebook';
const DB_VERSION = 1;

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function (resolve, reject) {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (event) {
      const db = req.result;
      if (!db.objectStoreNames.contains('products')) {
        db.createObjectStore('products', { keyPath: 'code' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        s.createIndex('code', 'code', { unique: false });
        s.createIndex('observedAt', 'observedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('misses')) {
        db.createObjectStore('misses', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      void event;
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
  return dbPromise;
}

function tx(store, mode) {
  return open().then(function (db) {
    return db.transaction(store, mode).objectStore(store);
  });
}

function wrap(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

// ---------- product cache ----------
// Cached so the aisle works offline and so we do not hammer a free community
// API that rate limits anonymous callers.

export async function putProduct(product) {
  const s = await tx('products', 'readwrite');
  const record = Object.assign({}, product, { cachedAt: Date.now() });
  await wrap(s.put(record));
  return record;
}

export async function getProduct(code) {
  const s = await tx('products', 'readonly');
  return wrap(s.get(String(code)));
}

// ---------- price entries ----------

export async function addEntry(entry) {
  const s = await tx('entries', 'readwrite');
  const record = Object.assign(
    {
      code: null,
      name: '',
      brand: '',
      store: '',
      price: null,
      packageGrams: null,
      servingGrams: null,
      unitPer100g: null,
      source: 'manual',
      observedAt: Date.now()
    },
    entry
  );
  if (record.unitPer100g == null && record.price != null && record.packageGrams) {
    record.unitPer100g = (record.price / record.packageGrams) * 100;
  }
  const id = await wrap(s.add(record));
  record.id = id;
  return record;
}

export async function entriesFor(code) {
  const s = await tx('entries', 'readonly');
  const list = await wrap(s.index('code').getAll(String(code)));
  return list.sort(function (a, b) { return b.observedAt - a.observedAt; });
}

export async function allEntries() {
  const s = await tx('entries', 'readonly');
  const list = await wrap(s.getAll());
  return list.sort(function (a, b) { return b.observedAt - a.observedAt; });
}

export async function deleteEntry(id) {
  const s = await tx('entries', 'readwrite');
  return wrap(s.delete(id));
}

// Cheapest comparable observation for one item. Compares on price per 100g when
// sizes are known, because the same item in two sizes is not the same deal.
export async function bestPrice(code) {
  const list = await entriesFor(code);
  if (!list.length) return null;
  const comparable = list.filter(function (e) { return e.unitPer100g != null; });
  const pool = comparable.length ? comparable : list.filter(function (e) { return e.price != null; });
  if (!pool.length) return null;
  const key = comparable.length ? 'unitPer100g' : 'price';
  return pool.reduce(function (best, e) { return e[key] < best[key] ? e : best; });
}

// One row per item for the price book view.
export async function priceBook() {
  const list = await allEntries();
  const byCode = new Map();
  list.forEach(function (e) {
    const k = e.code || e.name;
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k).push(e);
  });
  const rows = [];
  byCode.forEach(function (entries, k) {
    const comparable = entries.filter(function (e) { return e.unitPer100g != null; });
    const useUnit = comparable.length > 0;
    const pool = useUnit ? comparable : entries.filter(function (e) { return e.price != null; });
    if (!pool.length) return;
    const field = useUnit ? 'unitPer100g' : 'price';
    const best = pool.reduce(function (a, b) { return b[field] < a[field] ? b : a; });
    rows.push({
      key: k,
      code: entries[0].code,
      name: entries[0].name || k,
      brand: entries[0].brand || '',
      latest: entries[0],
      best: best,
      comparesOnUnit: useUnit,
      count: entries.length
    });
  });
  return rows.sort(function (a, b) { return b.latest.observedAt - a.latest.observedAt; });
}

// ---------- failed scans ----------
// Logged with the raw value so the barcode fixture grows from real failures.

export async function logMiss(raw, reason) {
  const s = await tx('misses', 'readwrite');
  return wrap(s.add({ raw: String(raw), reason: reason || 'unknown', at: Date.now() }));
}

export async function misses() {
  const s = await tx('misses', 'readonly');
  return wrap(s.getAll());
}

// ---------- settings ----------

export async function getSetting(key, fallback) {
  const s = await tx('settings', 'readonly');
  const row = await wrap(s.get(key));
  return row === undefined ? fallback : row.value;
}

export async function setSetting(key, value) {
  const s = await tx('settings', 'readwrite');
  return wrap(s.put({ key: key, value: value }));
}

// ---------- export and wipe ----------
// Export is a promise made on the landing page, so it ships in phase 1.

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function exportCsv() {
  const list = await allEntries();
  const header = [
    'observed_at', 'code', 'name', 'brand', 'store',
    'price_usd', 'package_grams', 'serving_grams', 'price_per_100g', 'source'
  ];
  const lines = [header.join(',')];
  list.forEach(function (e) {
    lines.push([
      new Date(e.observedAt).toISOString(),
      e.code, e.name, e.brand, e.store,
      e.price == null ? '' : e.price.toFixed(2),
      e.packageGrams == null ? '' : Math.round(e.packageGrams),
      e.servingGrams == null ? '' : Math.round(e.servingGrams),
      e.unitPer100g == null ? '' : e.unitPer100g.toFixed(4),
      e.source
    ].map(csvCell).join(','));
  });
  return lines.join('\n');
}

export async function wipe() {
  const db = await open();
  const names = ['products', 'entries', 'misses', 'settings'];
  await Promise.all(
    names.map(function (n) {
      return wrap(db.transaction(n, 'readwrite').objectStore(n).clear());
    })
  );
}
