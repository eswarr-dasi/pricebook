// Local storage layer. IndexedDB only, no account, no server.
//
// Phase 1 of the architecture is deliberately backendless, so this file is the
// whole system of record. Personal best price is always a query over entries,
// never a stored field, so it cannot drift out of date.

// Deliberately still 'pricebook'. The app was renamed to Tare, but the
// IndexedDB name is the address of everyone's existing data - every price,
// every scan, every log. Renaming it would silently open a new empty
// database and orphan all of it with no way back.
const DB_NAME = 'pricebook';
const DB_VERSION = 4;

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
      // v2. History is every scan, whether or not a price was ever entered.
      // Entries only ever held items you priced, so a scan you looked at and
      // walked away from used to leave no trace at all.
      if (!db.objectStoreNames.contains('history')) {
        const h = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        h.createIndex('code', 'code', { unique: false });
        h.createIndex('at', 'at', { unique: false });
      }
      if (!db.objectStoreNames.contains('favorites')) {
        db.createObjectStore('favorites', { keyPath: 'code' });
      }
      // v3. Daily log and weight log. Both are keyed by a local calendar day
      // string rather than a timestamp, because "today" is a calendar question
      // and a UTC boundary would roll the log over at the wrong hour.
      if (!db.objectStoreNames.contains('log')) {
        const l = db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
        l.createIndex('day', 'day', { unique: false });
        l.createIndex('at', 'at', { unique: false });
      }
      if (!db.objectStoreNames.contains('weights')) {
        db.createObjectStore('weights', { keyPath: 'day' });
      }
      // v4. Water is one row per day. Custom foods are items with no barcode:
      // a bulk bin, a home recipe, anything the world database will never hold.
      if (!db.objectStoreNames.contains('water')) {
        db.createObjectStore('water', { keyPath: 'day' });
      }
      if (!db.objectStoreNames.contains('foods')) {
        db.createObjectStore('foods', { keyPath: 'id', autoIncrement: true });
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

export async function allProducts() {
  const s = await tx('products', 'readonly');
  return wrap(s.getAll());
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
      // A saved price is an observation. It only counts as money spent when it
      // was recorded during a shopping trip, which is what bought marks.
      bought: false,
      tripId: null,
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

// A price is typed by a human standing in an aisle, so it will sometimes be
// wrong. Without this a typo is permanent, and because bestPrice takes the
// minimum, a typo that is too low becomes the personal record for good.
export async function updateEntry(id, patch) {
  const s = await tx('entries', 'readwrite');
  const row = await wrap(s.get(id));
  if (!row) return null;
  const next = Object.assign({}, row, patch, { id: row.id });
  // Unit price is derived, so it is recomputed rather than carried over.
  next.unitPer100g = next.price != null && next.packageGrams
    ? (next.price / next.packageGrams) * 100
    : null;
  await wrap(s.put(next));
  return next;
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

// ---------- local search ----------
//
// Everything you have ever scanned, priced or typed in is already on this
// device. Searching that first is instant, works with no signal, and is almost
// always what someone typing "yogurt" actually meant. The world catalogue is
// the fallback, not the first stop.

// Ranked so an exact name wins, then a word beginning with the term, then a
// match anywhere. Items you have actually priced outrank ones you only looked
// at, because a price book is what this app is for.
export function matchScore(name, brand, q) {
  const n = String(name || '').toLowerCase();
  const b = String(brand || '').toLowerCase();
  const t = String(q || '').toLowerCase().trim();
  if (!t || !n) return 0;
  if (n === t) return 100;
  if (n.indexOf(t) === 0) return 80;
  // \b would miss "5%" and hyphenated names, so word starts are found directly.
  const words = n.split(/[^a-z0-9]+/);
  for (let i = 0; i < words.length; i++) {
    if (words[i] && words[i].indexOf(t) === 0) return 60;
  }
  if (n.indexOf(t) >= 0) return 40;
  if (b && b.indexOf(t) >= 0) return 25;
  return 0;
}

export async function searchLocal(query, limit) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const [products, entries, hist, custom] = await Promise.all([
    allProducts(), allEntries(), history(), foods()
  ]);

  const found = new Map();
  const add = function (key, row, rank) {
    if (!key) return;
    const prev = found.get(key);
    if (!prev || rank > prev.rank) {
      found.set(key, Object.assign({}, prev || {}, row, { rank: Math.max(rank, prev ? prev.rank : 0) }));
    } else if (prev) {
      Object.keys(row).forEach(function (k) { if (prev[k] == null) prev[k] = row[k]; });
    }
  };

  (products || []).forEach(function (p) {
    const sc = matchScore(p.product_name, p.brands, q);
    if (sc) add(p.code, { code: p.code, name: p.product_name || p.code, brand: p.brands || '',
                          image: p.image || null, source: 'scanned' }, sc);
  });
  hist.forEach(function (h) {
    const sc = matchScore(h.name, h.brand, q);
    if (sc) add(h.code, { code: h.code, name: h.name, brand: h.brand || '',
                          image: h.image || null, source: 'scanned' }, sc);
  });
  entries.forEach(function (e) {
    const sc = matchScore(e.name, e.brand, q);
    if (!sc) return;
    const key = e.code || ('name:' + e.name);
    add(key, { code: e.code || null, name: e.name, brand: e.brand || '',
               source: 'priced', price: e.price, unitPer100g: e.unitPer100g,
               store: e.store || '' }, sc + 15);
  });
  custom.forEach(function (f) {
    const sc = matchScore(f.name, '', q);
    if (sc) add('food:' + f.id, { code: null, foodId: f.id, name: f.name,
                                  brand: '', source: 'custom' }, sc);
  });

  const out = Array.from(found.values());
  out.sort(function (a, b) {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return String(a.name).length - String(b.name).length;
  });
  return limit ? out.slice(0, limit) : out;
}

// ---------- spending ----------

export async function spendBetween(startTs, endTs) {
  const list = await allEntries();
  let total = 0;
  let items = 0;
  list.forEach(function (e) {
    if (!e.bought || e.price == null) return;
    if (e.observedAt < startTs || e.observedAt >= endTs) return;
    total += e.price;
    items++;
  });
  return { total: total, items: items };
}

export async function tripEntries(tripId) {
  const list = await allEntries();
  return list.filter(function (e) { return e.tripId === tripId; });
}

// Bought entries grouped into the trips they were recorded on, newest first.
export async function trips(limit) {
  const list = await allEntries();
  const byTrip = new Map();
  list.forEach(function (e) {
    if (!e.bought || !e.tripId) return;
    if (!byTrip.has(e.tripId)) byTrip.set(e.tripId, []);
    byTrip.get(e.tripId).push(e);
  });
  const out = [];
  byTrip.forEach(function (rows, id) {
    const total = rows.reduce(function (a, e) { return a + (e.price || 0); }, 0);
    out.push({
      id: id,
      at: Math.max.apply(null, rows.map(function (e) { return e.observedAt; })),
      store: (rows.find(function (e) { return e.store; }) || {}).store || '',
      items: rows.length,
      total: total
    });
  });
  out.sort(function (a, b) { return b.at - a.at; });
  return limit ? out.slice(0, limit) : out;
}

// ---------- store comparison ----------
//
// Total spend per store says what you bought there, not what it costs. The
// honest comparison is per item: for every item seen at more than one store,
// how does this store's best unit price compare with the best anywhere. An
// index of 1.00 means this store was cheapest every time it was comparable.
// Items seen at only one store cannot rank it and are excluded, and the count
// of comparable items is returned so a thin verdict shows as thin.
export async function storeStats() {
  const list = await allEntries();
  const stores = new Map();
  const byItem = new Map();

  list.forEach(function (e) {
    const store = (e.store || '').trim();
    if (!store) return;
    if (!stores.has(store)) {
      stores.set(store, { store: store, entries: 0, spend: 0, trips: new Set() });
    }
    const s = stores.get(store);
    s.entries++;
    if (e.bought && e.price != null) s.spend += e.price;
    if (e.tripId) s.trips.add(e.tripId);

    if (e.unitPer100g == null) return;
    const key = e.code || e.name;
    if (!key) return;
    if (!byItem.has(key)) byItem.set(key, new Map());
    const perStore = byItem.get(key);
    if (!perStore.has(store) || e.unitPer100g < perStore.get(store)) {
      perStore.set(store, e.unitPer100g);
    }
  });

  const ratios = new Map();
  const wins = new Map();
  byItem.forEach(function (perStore) {
    if (perStore.size < 2) return;              // one store cannot be compared
    let best = Infinity;
    perStore.forEach(function (v) { if (v < best) best = v; });
    if (!isFinite(best) || best <= 0) return;
    perStore.forEach(function (v, store) {
      if (!ratios.has(store)) ratios.set(store, []);
      ratios.get(store).push(v / best);
      if (v === best) wins.set(store, (wins.get(store) || 0) + 1);
    });
  });

  const out = [];
  stores.forEach(function (s, store) {
    const r = ratios.get(store) || [];
    const index = r.length
      ? r.reduce(function (a, b) { return a + b; }, 0) / r.length
      : null;
    out.push({
      store: store, entries: s.entries, spend: s.spend, trips: s.trips.size,
      comparable: r.length, cheapest: wins.get(store) || 0, index: index
    });
  });
  // Ranked by index where one exists, then by how much you have recorded there.
  out.sort(function (a, b) {
    if (a.index == null && b.index == null) return b.entries - a.entries;
    if (a.index == null) return 1;
    if (b.index == null) return -1;
    return a.index - b.index;
  });
  return out;
}

// ---------- what your price book is worth ----------
//
// The headline number is the gap between your own best and worst price for the
// items you have priced more than once, converted to money per package. It is
// not a claim about what you saved - it is what the spread is worth if you buy
// at your low instead of your high, which is the thing the price book is for.
// Items priced once have no spread and are excluded.
export async function savingsStats() {
  const list = await allEntries();
  const byItem = new Map();
  list.forEach(function (e) {
    if (e.unitPer100g == null) return;
    const key = e.code || e.name;
    if (!key) return;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key).push(e);
  });

  let spread = 0;
  let comparable = 0;
  byItem.forEach(function (rows) {
    if (rows.length < 2) return;
    let lo = Infinity, hi = -Infinity, grams = null;
    rows.forEach(function (e) {
      if (e.unitPer100g < lo) lo = e.unitPer100g;
      if (e.unitPer100g > hi) hi = e.unitPer100g;
      if (grams == null && e.packageGrams) grams = e.packageGrams;
    });
    if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return;
    comparable++;
    // Without a package size the spread has no dollar value, so it is counted
    // as comparable but contributes nothing rather than a made-up figure.
    if (grams) spread += ((hi - lo) / 100) * grams;
  });

  const stores = new Set();
  let priced = 0;
  list.forEach(function (e) {
    if (e.store) stores.add(e.store);
    if (e.price != null) priced++;
  });

  return {
    items: byItem.size,
    comparable: comparable,
    spread: spread,
    prices: priced,
    stores: stores.size
  };
}

// ---------- undo ----------
//
// Clearing is one tap, so undoing it has to be one tap too. The snapshot is
// held in memory by the caller and never written anywhere, so it dies with the
// page rather than becoming a second copy of data the user asked to delete.
const SNAPSHOT_STORES = ['products', 'entries', 'misses', 'settings',
                         'history', 'favorites', 'log', 'weights', 'water', 'foods'];

export async function snapshot(names) {
  const want = names || SNAPSHOT_STORES;
  const out = {};
  for (let i = 0; i < want.length; i++) {
    const s = await tx(want[i], 'readonly');
    out[want[i]] = await wrap(s.getAll());
  }
  return out;
}

export async function restore(snap) {
  const names = Object.keys(snap || {});
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const s = await tx(name, 'readwrite');
    await wrap(s.clear());
    const rows = snap[name] || [];
    for (let j = 0; j < rows.length; j++) {
      const st = await tx(name, 'readwrite');
      await wrap(st.put(rows[j]));
    }
  }
  return true;
}

// ---------- scan history ----------
// Enough of the product is copied in so the list still renders offline and
// still renders after the product cache is evicted. It is a log of what you
// looked at, so it stores what you saw, not a pointer to it.

const HISTORY_DEDUPE_MS = 1000 * 60 * 5;

function summarize(product) {
  return {
    code: String(product.code || ''),
    name: product.product_name || String(product.code || ''),
    brand: product.brands || '',
    quantity: product.quantity || '',
    image: product.image || null
  };
}

// Re-scanning the same item while you stand there is one visit, not five rows.
export async function addHistory(product, source) {
  const row = Object.assign(summarize(product), {
    at: Date.now(),
    source: source || 'scan'
  });
  const db = await open();
  return new Promise(function (resolve, reject) {
    const t = db.transaction('history', 'readwrite');
    const s = t.objectStore('history');
    const req = s.index('code').getAll(row.code);
    req.onsuccess = function () {
      const prior = (req.result || []).sort(function (a, b) { return b.at - a.at; })[0];
      if (prior && row.at - prior.at < HISTORY_DEDUPE_MS) {
        const merged = Object.assign(prior, row, { id: prior.id });
        s.put(merged);
        resolve(merged);
        return;
      }
      const add = s.add(row);
      add.onsuccess = function () { row.id = add.result; resolve(row); };
      add.onerror = function () { reject(add.error); };
    };
    req.onerror = function () { reject(req.error); };
  });
}

export async function history(limit) {
  const s = await tx('history', 'readonly');
  const list = await wrap(s.getAll());
  list.sort(function (a, b) { return b.at - a.at; });
  return limit ? list.slice(0, limit) : list;
}

export async function deleteHistory(id) {
  const s = await tx('history', 'readwrite');
  return wrap(s.delete(id));
}

export async function clearHistory() {
  const s = await tx('history', 'readwrite');
  return wrap(s.clear());
}

// ---------- favorites ----------

export async function isFavorite(code) {
  const s = await tx('favorites', 'readonly');
  const row = await wrap(s.get(String(code)));
  return !!row;
}

export async function toggleFavorite(product) {
  const code = String(product.code || '');
  const on = await isFavorite(code);
  const s = await tx('favorites', 'readwrite');
  if (on) {
    await wrap(s.delete(code));
    return false;
  }
  await wrap(s.put(Object.assign(summarize(product), { at: Date.now() })));
  return true;
}

export async function favorites() {
  const s = await tx('favorites', 'readonly');
  const list = await wrap(s.getAll());
  return list.sort(function (a, b) { return b.at - a.at; });
}

// ---------- daily log ----------

export function dayKey(ts) {
  const d = ts == null ? new Date() : new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

export async function addLog(row) {
  const at = row.at == null ? Date.now() : row.at;
  const record = Object.assign({
    code: null, name: '', brand: '', image: null,
    servings: 1, servingGrams: null,
    kcal: null, protein: null, carbs: null, fat: null
  }, row, { at: at, day: dayKey(at) });
  const s = await tx('log', 'readwrite');
  const id = await wrap(s.add(record));
  record.id = id;
  return record;
}

// One query for a whole range. renderTrend used to open fourteen transactions
// to draw fourteen bars, which is the difference between instant and not.
export async function logSince(dayKey) {
  const s = await tx('log', 'readonly');
  const list = await wrap(s.getAll());
  return list.filter(function (r) { return r.day >= String(dayKey); });
}

export async function logForDay(day) {
  const s = await tx('log', 'readonly');
  const list = await wrap(s.index('day').getAll(String(day)));
  return list.sort(function (a, b) { return b.at - a.at; });
}

export async function deleteLog(id) {
  const s = await tx('log', 'readwrite');
  return wrap(s.delete(id));
}

// Distinct calendar days that have at least one logged item, newest first.
export async function logDays() {
  const s = await tx('log', 'readonly');
  const list = await wrap(s.getAll());
  const seen = {};
  list.forEach(function (r) { seen[r.day] = true; });
  return Object.keys(seen).sort().reverse();
}

// ---------- water ----------

export async function getWater(day) {
  const s = await tx('water', 'readonly');
  const row = await wrap(s.get(String(day)));
  return row ? row.ml : 0;
}

export async function addWater(day, ml) {
  const current = await getWater(day);
  const next = Math.max(0, current + ml);
  const s = await tx('water', 'readwrite');
  await wrap(s.put({ day: String(day), ml: next, at: Date.now() }));
  return next;
}

// ---------- custom foods ----------

export async function addFood(food) {
  const record = Object.assign({
    name: '', servingGrams: null,
    kcal: null, protein: null, carbs: null, fat: null,
    at: Date.now()
  }, food);
  const s = await tx('foods', 'readwrite');
  const id = await wrap(s.add(record));
  record.id = id;
  return record;
}

export async function foods() {
  const s = await tx('foods', 'readonly');
  const list = await wrap(s.getAll());
  return list.sort(function (a, b) { return b.at - a.at; });
}

export async function deleteFood(id) {
  const s = await tx('foods', 'readwrite');
  return wrap(s.delete(id));
}

// ---------- weight log ----------

export async function setWeight(day, kg) {
  const s = await tx('weights', 'readwrite');
  if (kg == null) return wrap(s.delete(String(day)));
  return wrap(s.put({ day: String(day), kg: Number(kg), at: Date.now() }));
}

export async function weights() {
  const s = await tx('weights', 'readonly');
  const list = await wrap(s.getAll());
  return list.sort(function (a, b) { return a.day < b.day ? -1 : 1; });
}

// ---------- failed scans ----------
// Logged with the raw value so the barcode fixture grows from real failures.

export async function logMiss(raw, reason) {
  const s = await tx('misses', 'readwrite');
  return wrap(s.add({ raw: String(raw), reason: reason || 'unknown', at: Date.now() }));
}

export async function misses() {
  const s = await tx('misses', 'readonly');
  const list = await wrap(s.getAll());
  return list.sort(function (a, b) { return b.at - a.at; });
}

export async function clearMisses() {
  const s = await tx('misses', 'readwrite');
  return wrap(s.clear());
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

// Reads back what exportCsv wrote. Quoted fields with commas and escaped
// quotes are handled, because our own export produces them.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const push = function () { row.push(field); field = ''; };
  const endRow = function () { push(); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') push();
    else if (c === '\n') endRow();
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

// Returns { added, skipped }. Rows already present at the same code, store and
// timestamp are skipped, so importing the same file twice is not destructive.
export async function importCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { added: 0, skipped: 0 };
  const header = rows[0].map(function (h) { return h.trim(); });
  const idx = function (name) { return header.indexOf(name); };
  const cAt = idx('observed_at'), cCode = idx('code'), cName = idx('name');
  if (cAt < 0 || cName < 0) throw new Error('CSV_HEADER_UNRECOGNISED');
  const cBrand = idx('brand'), cStore = idx('store'), cPrice = idx('price_usd');
  const cPkg = idx('package_grams'), cSrv = idx('serving_grams'), cUnit = idx('price_per_100g');

  const existing = await allEntries();
  const seen = {};
  existing.forEach(function (e) { seen[[e.code, e.store, e.observedAt].join('|')] = true; });

  let added = 0, skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length || (r.length === 1 && !r[0])) continue;
    const at = Date.parse(r[cAt]);
    const code = cCode >= 0 ? (r[cCode] || null) : null;
    const store = cStore >= 0 ? (r[cStore] || '') : '';
    if (!isFinite(at)) { skipped++; continue; }
    if (seen[[code, store, at].join('|')]) { skipped++; continue; }
    const numOrNull = function (v) {
      if (v == null || String(v).trim() === '') return null;
      const n = Number(v);
      return isFinite(n) ? n : null;
    };
    await addEntry({
      code: code, name: r[cName] || code || '', brand: cBrand >= 0 ? r[cBrand] || '' : '',
      store: store, price: cPrice >= 0 ? numOrNull(r[cPrice]) : null,
      packageGrams: cPkg >= 0 ? numOrNull(r[cPkg]) : null,
      servingGrams: cSrv >= 0 ? numOrNull(r[cSrv]) : null,
      unitPer100g: cUnit >= 0 ? numOrNull(r[cUnit]) : null,
      source: 'import', observedAt: at
    });
    seen[[code, store, at].join('|')] = true;
    added++;
  }
  return { added: added, skipped: skipped };
}

// The scan log as a file. Separate from exportCsv because it answers a
// different question: that one is what things cost, this one is what you looked
// at. Whether an item was ever priced is included, since a scan with no price
// is the interesting case when you go back through it.
export async function exportHistoryCsv() {
  const [rows, favs, entries] = await Promise.all([history(), favorites(), allEntries()]);
  const isFav = {};
  favs.forEach(function (f) { isFav[f.code] = true; });
  const priced = {};
  entries.forEach(function (e) { if (e.code) priced[e.code] = true; });

  const header = ['scanned_at', 'code', 'name', 'brand', 'quantity',
                  'favorite', 'priced', 'lookup_source'];
  const lines = [header.join(',')];
  rows.forEach(function (h) {
    lines.push([
      new Date(h.at).toISOString(),
      h.code,
      h.name,
      h.brand,
      h.quantity,
      isFav[h.code] ? 'yes' : 'no',
      priced[h.code] ? 'yes' : 'no',
      h.source
    ].map(csvCell).join(','));
  });
  return lines.join('\n');
}

export async function wipe() {
  const db = await open();
  const names = ['products', 'entries', 'misses', 'settings',
                 'history', 'favorites', 'log', 'weights', 'water', 'foods'];
  await Promise.all(
    names.map(function (n) {
      return wrap(db.transaction(n, 'readwrite').objectStore(n).clear());
    })
  );
}
