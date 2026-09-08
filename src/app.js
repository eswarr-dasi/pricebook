// UI wiring. Everything user facing lives here.
//
// House rules enforced in this file:
//   - no grade, no verdict, no good or bad label anywhere
//   - no calorie target, no weight goal, no streak
//   - a cached number is never shown without its age

import * as db from './store.js';
import * as off from './off.js';
import * as M from './metrics.js';
import { createScanner, normalize, canScan, scanMode } from './barcode.js';

const $ = function (sel) { return document.querySelector(sel); };

const el = {
  net: $('#net-pill'),
  cam: $('#cam'),
  hint: $('#scan-hint'),
  scan: $('#btn-scan'),
  stopScan: $('#btn-stop'),
  manualForm: $('#manual-form'),
  manualCode: $('#manual-code'),
  status: $('#status'),
  result: $('#result'),
  bookList: $('#book-list'),
  bookSearch: $('#book-search'),
  exportBtn: $('#btn-export'),
  setStore: $('#set-store'),
  setHousehold: $('#set-household'),
  buildLine: $('#build-line'),
  wipe: $('#btn-wipe')
};

let scanner = null;
let current = null;   // { product, meta }
let settings = { store: '', household: 1 };

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function say(msg, isError) {
  el.status.textContent = msg || '';
  el.status.classList.toggle('err', !!isError);
}

function dateLabel(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString();
}

// ---------- tabs ----------

function showView(name) {
  ['scan', 'book', 'about'].forEach(function (v) {
    const node = document.getElementById('view-' + v);
    if (node) node.hidden = v !== name;
  });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.classList.toggle('is-active', t.dataset.view === name);
  });
  if (name === 'book') renderBook();
  if (name !== 'scan' && scanner && scanner.isRunning()) stopScanning();
}

// ---------- scanning ----------

async function startScanning() {
  if (!canScan()) {
    el.hint.textContent =
      'This browser will not give the page a camera. Type the digits under the barcode instead.';
    el.manualCode.focus();
    return;
  }
  say('Point the camera at the barcode.');
  el.scan.hidden = true;
  el.stopScan.hidden = false;
  const ok = await scanner.start(onScan, function (err) {
    el.scan.hidden = false;
    el.stopScan.hidden = true;
    if (err && err.name === 'NotAllowedError') {
      say('Camera permission was declined. You can still type the barcode digits.', true);
    } else if (err && err.message === 'NO_CAMERA_API') {
      say('This browser will not give the page a camera. Type the digits instead.', true);
    } else {
      say('Camera unavailable. Type the digits instead.', true);
    }
    el.manualCode.focus();
  });
  if (!ok) {
    el.scan.hidden = false;
    el.stopScan.hidden = true;
  }
}

function stopScanning() {
  scanner.stop();
  el.scan.hidden = false;
  el.stopScan.hidden = true;
}

function onScan(hit) {
  stopScanning();
  lookup(hit.code, hit.raw);
}

// ---------- lookup and render ----------

async function lookup(rawCode, rawScan) {
  const code = normalize(rawCode);
  if (!code) {
    say('That does not look like a product barcode.', true);
    db.logMiss(rawScan || rawCode, 'unparseable').catch(function () {});
    return;
  }
  say('Looking up ' + code + ' ...');
  try {
    const res = await off.lookup(code);
    current = { product: res.product, meta: res };
    await renderResult();
    say('');
  } catch (err) {
    current = null;
    el.result.innerHTML = '';
    db.logMiss(rawScan || code, err instanceof off.NotFoundError ? 'not_in_off' : 'lookup_failed')
      .catch(function () {});
    if (err instanceof off.NotFoundError) {
      say('Not in Open Food Facts yet. You can still add it to your price book by hand.', true);
      renderUnknown(code);
    } else {
      say('Lookup failed and nothing is cached for this item. Try again on signal.', true);
    }
  }
}

function metricBlock(id, label) {
  return (
    '<div class="metric"><span class="v" id="' + id + '">--</span>' +
    '<span class="k">' + label + '</span></div>'
  );
}

async function renderResult() {
  const p = current.product;
  const meta = current.meta;
  const best = await db.bestPrice(p.code);
  const lastEntry = (await db.entriesFor(p.code))[0];

  const sizeBits = [];
  if (p.brands) sizeBits.push(esc(p.brands));
  if (p.quantity) sizeBits.push(esc(p.quantity));
  sizeBits.push(esc(p.code));

  el.result.innerHTML =
    '<div class="card">' +
      '<h3>' + esc(p.product_name || 'Unnamed product') + '</h3>' +
      '<p class="brand">' + sizeBits.join(' &middot; ') + '</p>' +
      '<div class="row">' +
        '<input id="price-input" inputmode="decimal" placeholder="Price for the package" ' +
          'aria-label="Price for the package" value="' +
          (lastEntry && lastEntry.price != null ? String(lastEntry.price) : '') + '" />' +
        '<input id="store-input" placeholder="Store" aria-label="Store" value="' +
          esc(settings.store || (lastEntry ? lastEntry.store : '')) + '" />' +
      '</div>' +
      '<div class="metrics">' +
        metricBlock('m-serving', 'cost per serving') +
        metricBlock('m-protein', 'cents per g protein') +
        metricBlock('m-full', 'fullness per dollar') +
      '</div>' +
      '<div id="best-line" class="small muted"></div>' +
      '<dl class="kv" id="kv"></dl>' +
      '<details id="sat-details"><summary>How the fullness estimate is built</summary>' +
        '<div id="sat-body" class="small"></div></details>' +
      (p.ingredients_text
        ? '<details><summary>Ingredients</summary><p class="ingredients">' +
            esc(p.ingredients_text) + '</p></details>'
        : '') +
      '<details><summary>Third party classifications</summary><div class="small muted">' +
        'Shown as published by Open Food Facts, not as our verdict.<br />' +
        'Nutri-Score: ' + (p.nutriscore_grade ? esc(String(p.nutriscore_grade).toUpperCase()) : 'not published') +
        ' &middot; <a href="' + off.CLASSIFIER_LINKS.nutriscore + '" target="_blank" rel="noopener">method</a><br />' +
        'NOVA group: ' + (p.nova_group == null ? 'not published' : esc(p.nova_group)) +
        ' &middot; <a href="' + off.CLASSIFIER_LINKS.nova + '" target="_blank" rel="noopener">method</a>' +
      '</div></details>' +
      '<div class="row"><button id="btn-save" class="primary" type="button">Save to my price book</button></div>' +
      '<p class="muted small">Nutrition from Open Food Facts (ODbL), ' +
        (meta.source === 'cache'
          ? 'from your device, saved ' + off.ageLabel(meta.ageMs)
          : 'fetched just now') +
        '. Community data, so it can be wrong.</p>' +
    '</div>';

  const priceInput = $('#price-input');
  priceInput.addEventListener('input', paint);
  $('#store-input').addEventListener('input', function (e) { settings.store = e.target.value; });
  $('#btn-save').addEventListener('click', savePrice);
  paintBest(best);
  paint();
}

function renderUnknown(code) {
  el.result.innerHTML =
    '<div class="card">' +
      '<h3>Unknown item</h3>' +
      '<p class="brand">' + esc(code) + '</p>' +
      '<div class="row">' +
        '<input id="u-name" placeholder="Item name" aria-label="Item name" />' +
        '<input id="u-price" inputmode="decimal" placeholder="Price" aria-label="Price" />' +
      '</div>' +
      '<div class="row">' +
        '<input id="u-grams" inputmode="decimal" placeholder="Package grams (optional)" aria-label="Package grams" />' +
        '<input id="u-store" placeholder="Store" aria-label="Store" value="' + esc(settings.store) + '" />' +
      '</div>' +
      '<div class="row"><button id="u-save" class="primary" type="button">Add to price book</button></div>' +
      '<p class="muted small">Manual entry is what makes this work at Costco, Aldi, Trader Joes and WinCo.</p>' +
    '</div>';
  $('#u-save').addEventListener('click', async function () {
    const price = M.num($('#u-price').value);
    if (price == null) { say('Enter a price first.', true); return; }
    await db.addEntry({
      code: code,
      name: $('#u-name').value || code,
      store: $('#u-store').value || settings.store,
      price: price,
      packageGrams: M.num($('#u-grams').value),
      source: 'manual'
    });
    say('Added to your price book.');
    renderBook();
  });
}

function paint() {
  if (!current) return;
  const price = M.num($('#price-input') ? $('#price-input').value : null);
  const c = M.compute(current.product, price, { household: settings.household });

  $('#m-serving').textContent = M.money(c.costPerServing);
  $('#m-protein').textContent =
    c.costPerGramProtein == null ? M.DASH : (c.costPerGramProtein * 100).toFixed(1);
  $('#m-full').textContent = c.fullnessPerDollar == null ? M.DASH : String(Math.round(c.fullnessPerDollar));

  const rows = [];
  function row(k, v) { rows.push('<dt>' + k + '</dt><dd>' + v + '</dd>'); }

  row('Serving', c.servingGrams == null ? 'not published' : Math.round(c.servingGrams) + ' g');
  row('Servings in package', c.servings == null ? 'unknown' : M.fmt(c.servings, 1));
  row('Cost per 100 g', M.money(c.costPer100g));
  row('Protein in package', c.totalProtein == null ? 'unknown' : M.fmt(c.totalProtein, 0) + ' g');
  row('Calories per serving',
    c.per100.kcal == null || c.servingGrams == null
      ? 'unknown'
      : Math.round((c.per100.kcal * c.servingGrams) / 100) + ' kcal');
  row('Calories per dollar', c.kcalPerDollar == null ? M.DASH : Math.round(c.kcalPerDollar) + ' kcal');
  if (settings.household > 1) {
    row('One serving each for ' + settings.household, M.money(c.costForHousehold));
  }
  if (c.missing.length) {
    row('Missing inputs', esc(c.missing.join(', ')));
  }
  $('#kv').innerHTML = rows.join('');

  const sat = c.satiety;
  const body = $('#sat-body');
  if (!sat) {
    body.textContent = 'Not enough published nutrition to estimate fullness for this item.';
  } else {
    body.innerHTML =
      '<p>Estimate ' + sat.score + ' out of 100, range ' + sat.low + ' to ' + sat.high +
      '. It is an estimate, not advice, and not a judgement about this food.</p>' +
      '<dl class="kv">' +
        '<dt>Energy density</dt><dd>' + sat.inputs.energyDensity + ' kcal per g (weight ' + sat.weights.energyDensity + ')</dd>' +
        '<dt>Protein</dt><dd>' + sat.inputs.protein + ' g per 100 g (weight ' + sat.weights.protein + ')</dd>' +
        '<dt>Fiber</dt><dd>' + (sat.inputs.fiber == null ? 'not published' : sat.inputs.fiber + ' g per 100 g') +
          ' (weight ' + sat.weights.fiber + ')</dd>' +
        '<dt>Water</dt><dd>' + (sat.inputs.waterEstimate == null ? 'unknown' : sat.inputs.waterEstimate + ' g per 100 g, inferred from macros') +
          ' (weight ' + sat.weights.water + ')</dd>' +
      '</dl>';
  }
}

function paintBest(best) {
  const line = $('#best-line');
  if (!line) return;
  if (!best) {
    line.textContent = 'No price history for this item yet. Save one and the app starts comparing.';
    return;
  }
  const what = best.unitPer100g != null
    ? M.money(best.unitPer100g) + ' per 100 g'
    : M.money(best.price);
  line.innerHTML = 'Your lowest so far: <strong>' + what + '</strong>' +
    (best.store ? ' at ' + esc(best.store) : '') + ' on ' + dateLabel(best.observedAt) + '.';
}

async function savePrice() {
  if (!current) return;
  const price = M.num($('#price-input').value);
  if (price == null) { say('Enter the price you see on the shelf.', true); return; }
  const p = current.product;
  await db.addEntry({
    code: p.code,
    name: p.product_name || p.code,
    brand: p.brands || '',
    store: $('#store-input').value || settings.store,
    price: price,
    packageGrams: M.packageGrams(p),
    servingGrams: M.servingGrams(p),
    source: 'scan'
  });
  await db.setSetting('store', $('#store-input').value || settings.store);
  const best = await db.bestPrice(p.code);
  paintBest(best);
  say('Saved. Your price book now has this item.');
  renderBook();
}

// ---------- price book ----------

async function renderBook() {
  const q = (el.bookSearch.value || '').toLowerCase().trim();
  const rows = await db.priceBook();
  const filtered = q
    ? rows.filter(function (r) {
        return (r.name + ' ' + r.brand + ' ' + (r.code || '')).toLowerCase().indexOf(q) >= 0;
      })
    : rows;

  if (!filtered.length) {
    el.bookList.innerHTML =
      '<p class="empty">Nothing here yet. Scan something and save the price you see.</p>';
    return;
  }

  el.bookList.innerHTML = filtered.map(function (r) {
    const bestLabel = r.comparesOnUnit
      ? M.money(r.best.unitPer100g) + ' / 100 g'
      : M.money(r.best.price);
    return '<div class="book-row">' +
      '<div><div class="n">' + esc(r.name) + '</div>' +
      '<div class="m">' + esc(r.brand || '') + (r.brand ? ' &middot; ' : '') +
        r.count + (r.count === 1 ? ' entry' : ' entries') +
        ' &middot; last ' + dateLabel(r.latest.observedAt) + '</div></div>' +
      '<div class="p"><div class="n">' + bestLabel + '</div>' +
      '<div class="m">' + (r.best.store ? esc(r.best.store) : 'your low') + '</div></div>' +
      '</div>';
  }).join('');
}

async function doExport() {
  const csv = await db.exportCsv();
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pricebook-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

// ---------- boot ----------

function paintNet() {
  const offline = navigator.onLine === false;
  el.net.hidden = !offline;
  if (offline) {
    el.hint.textContent =
      'Offline. Your price book and anything you scanned before still work.';
  }
}

async function boot() {
  scanner = createScanner(el.cam);

  settings.store = await db.getSetting('store', '');
  settings.household = Number(await db.getSetting('household', 1)) || 1;
  el.setStore.value = settings.store;
  el.setHousehold.value = settings.household;

  el.scan.addEventListener('click', startScanning);
  el.stopScan.addEventListener('click', stopScanning);
  el.manualForm.addEventListener('submit', function (e) {
    e.preventDefault();
    lookup(el.manualCode.value);
  });
  el.bookSearch.addEventListener('input', renderBook);
  el.exportBtn.addEventListener('click', doExport);
  el.setStore.addEventListener('change', function (e) {
    settings.store = e.target.value;
    db.setSetting('store', settings.store);
  });
  el.setHousehold.addEventListener('change', function (e) {
    settings.household = Math.max(1, Number(e.target.value) || 1);
    db.setSetting('household', settings.household);
    paint();
  });
  el.wipe.addEventListener('click', async function () {
    if (!confirm('Delete every price you have saved on this device? This cannot be undone.')) return;
    await db.wipe();
    settings = { store: '', household: 1 };
    el.setStore.value = '';
    el.setHousehold.value = 1;
    el.result.innerHTML = '';
    renderBook();
    say('Local data deleted.');
  });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.dataset.view); });
  });

  window.addEventListener('online', paintNet);
  window.addEventListener('offline', paintNet);
  paintNet();

  if (!canScan()) {
    el.hint.textContent =
      'This browser will not give the page a camera. Typing the digits works everywhere.';
  } else if (scanMode() === 'builtin') {
    el.hint.textContent =
      'Scan a barcode, or type it in. This browser has no barcode support, so the app decodes frames itself.';
  }
  el.buildLine.textContent =
    'Phase 1 build. No account, no server, no analytics. Scanner: ' +
    (scanMode() === 'native' ? 'platform decoder.' : 'built in decoder.');

  renderBook();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      // Offline support is a bonus here, never a hard requirement to run.
    }
  }
}

boot();
