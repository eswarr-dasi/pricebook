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
import * as Mo from './motion.js';
import * as P from './palette.js';

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
  wipe: $('#btn-wipe'),
  recentWrap: $('#recent-wrap'),
  recent: $('#recent'),
  historyList: $('#history-list'),
  historyTitle: $('#history-title'),
  clearHistory: $('#btn-clear-history'),
  todayDate: $('#today-date'),
  todayList: $('#today-list'),
  todayNote: $('#today-note'),
  kcalRing: $('#kcal-ring'),
  kcalNow: $('#kcal-now'),
  kcalGoal: $('#kcal-goal'),
  macroGoals: $('#macro-goals'),
  streakChip: $('#streak-chip'),
  streakN: $('#streak-n'),
  weightInput: $('#weight-input'),
  weightUnit: $('#weight-unit'),
  weightTrend: $('#weight-trend'),
  goalNote: $('#goal-note'),
  dayPrev: $('#day-prev'),
  dayNext: $('#day-next'),
  dayToday: $('#day-today'),
  waterV: $('#water-v'),
  waterFill: $('#water-fill'),
  trend: $('#trend'),
  searchWrap: $('#search-results'),
  searchList: $('#search-list'),
  searchTitle: $('#search-title'),
  sheet: $('#sheet'),
  sheetTitle: $('#sheet-title'),
  sheetBody: $('#sheet-body'),
  onboard: $('#onboard'),
  importFile: $('#import-file'),
  installBtn: $('#btn-install'),
  dietGroup: $('#diet-group'),
  foodsCount: $('#foods-count'),
  budget: $('#budget'),
  tripCard: $('#trip-card'),
  tripTitle: $('#trip-title'),
  tripSub: $('#trip-sub'),
  tripBtn: $('#trip-btn'),
  stores: $('#stores'),
  trips: $('#trips'),
  missesCount: $('#misses-count'),
  appbar: document.querySelector('.appbar'),
  ptr: $('#ptr'),
  helloK: $('#hello-k'),
  helloT: $('#hello-t'),
  homeStreak: $('#home-streak'),
  homeStreakN: $('#home-streak-n'),
  statRail: $('#stat-rail'),
  wins: $('#wins'),
  stories: $('#stories'),
  story: $('#story'),
  storyBars: $('#story-bars'),
  storyWho: $('#story-who'),
  storyStage: $('#story-stage'),
  storyFoot: $('#story-foot'),
  weekDots: $('#week-dots'),
  spend: $('#spend'),
  podium: $('#podium'),
  cheer: $('#cheer'),
  cheerBanner: $('#cheer-banner'),
  cheerTitle: $('#cheer-title'),
  cheerV: $('#cheer-v'),
  cheerSub: $('#cheer-sub'),
  cheerStats: $('#cheer-stats'),
  cheerUnit: $('#cheer-unit'),
  healthDay: $('#health-day'),
  healthShop: $('#health-shop')
};

const STORY_MS = 5000;

// Tab order is the swipe order, so left and right mean something consistent.
const VIEWS = ['scan', 'today', 'history', 'book', 'about'];

const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch',     label: 'Lunch' },
  { key: 'dinner',    label: 'Dinner' },
  { key: 'snack',     label: 'Snack' }
];

const GOAL_KEYS = ['kcal', 'protein', 'carbs', 'fat'];
const LB_PER_KG = 2.2046226218;

let scanner = null;
let current = null;   // { product, meta }
let settings = { store: '', household: 1 };
let historyFilter = 'all';      // all | fav
let nutritionBasis = 'serving'; // serving | 100g
let goals = { kcal: null, protein: null, carbs: null, fat: null };
let showStreak = true;
let weightUnit = 'kg';
let waterGoal = 2000;
let diet = {};
let viewDay = null;      // null means today
let installPrompt = null;
let lastLogMeal = 'snack';
let takeoutCost = null;
let editingEntry = null;
let storyItems = [];
let storyAt = 0;
let storyTimer = 0;
let budget = { amount: null, period: 'week' };
let trip = null;                  // { id, startedAt }
const TRIP_MAX_MS = 1000 * 60 * 60 * 6;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let sayTimer = 0;
let sayToken = 0;

// An action on the toast is how undo stays a single tap. Destructive things get
// a longer window, because reading the message is part of deciding.
function say(msg, isError, action) {
  clearTimeout(sayTimer);
  const token = ++sayToken;
  el.status.classList.toggle('err', !!isError);
  el.status.textContent = '';
  if (!msg) return;

  const text = document.createElement('span');
  text.textContent = msg;
  el.status.appendChild(text);

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-do';
    btn.textContent = action.label;
    btn.addEventListener('click', function () {
      say('');
      action.fn();
    });
    el.status.appendChild(btn);
  }
  if (!isError) {
    sayTimer = setTimeout(function () {
      if (sayToken === token) say('');
    }, action ? 9000 : 3400);
  }
}

// The scanner already buzzes on a hit; a confirmed write should too, so the
// phone confirms the same way whether it is in your hand or your pocket.
function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms || 12);
}

function dateLabel(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString();
}

function timeLabel(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Calendar days, not elapsed hours, so something scanned at 11pm last night is
// Yesterday at 8am rather than "9 hours ago".
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function dayLabel(ts) {
  const then = new Date(ts);
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString([], { weekday: 'long' });
  return then.toLocaleDateString([], { month: 'short', day: 'numeric', year:
    then.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

// ---------- tabs ----------

let activeView = 'scan';

function showView(name, direction) {
  const from = VIEWS.indexOf(activeView);
  const to = VIEWS.indexOf(name);
  const dir = direction || (to > from ? 'left' : to < from ? 'right' : null);
  activeView = name;
  document.body.dataset.view = name;

  VIEWS.forEach(function (v) {
    const node = document.getElementById('view-' + v);
    if (!node) return;
    node.hidden = v !== name;
    if (v !== name) return;
    // Re-trigger the entrance animation on a node that was already in the DOM.
    node.classList.remove('from-left', 'from-right');
    void node.offsetWidth;
    if (dir === 'left') node.classList.add('from-left');
    else if (dir === 'right') node.classList.add('from-right');
  });
  document.querySelectorAll('.tab').forEach(function (t) {
    t.classList.toggle('is-active', t.dataset.view === name);
  });
  if (name === 'scan') renderHome({ animate: true });
  if (name === 'book') {
    renderBook(); renderBudget(); renderStores(); renderTrips(); renderSpend(); renderHealthShop();
  }
  if (name === 'history') renderHistory();
  if (name === 'today') renderToday();
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

// ---------- search by name ----------

// Digits are a barcode, words are a search. One field, because in the aisle you
// do not want to decide which box you are standing in front of.
let searchTimer = 0;
let searchSeq = 0;

function searchRow(r) {
  const bits = [];
  if (r.brand) bits.push(esc(r.brand));
  if (r.source === 'priced') {
    bits.push(r.unitPer100g != null ? M.money(r.unitPer100g) + ' / 100 g' : M.money(r.price));
    if (r.store) bits.push(esc(r.store));
  } else if (r.quantity) {
    bits.push(esc(r.quantity));
  }
  if (r.code) bits.push(esc(r.code));
  const tag = r.code ? 'button' : 'div';
  return '<' + tag + ' class="row-item"' +
      (r.code ? ' type="button" data-code="' + esc(r.code) + '"' : ' style="cursor:default"') + '>' +
    leadArt({ code: r.code, name: r.name, image: r.image }) +
    '<span class="row-main"><span class="n">' + esc(r.name) + '</span>' +
    '<span class="m">' + bits.join(' &middot; ') + '</span></span>' +
    (r.code ? '<svg class="ic ic-sm row-go" aria-hidden="true"><use href="#i-right" /></svg>' : '') +
  '</' + tag + '>';
}

function searchSection(title, rows, note) {
  if (!rows.length) return '';
  return '<div class="day">' + esc(title) + '</div>' +
    (note ? '<p class="swap-why">' + esc(note) + '</p>' : '') +
    rows.map(searchRow).join('');
}

// Local first, always. Your own data is on the device, so it answers in a few
// milliseconds and answers offline; the world catalogue is a slower second
// section that arrives underneath when it lands.
async function findByText(text) {
  const raw = String(text || '').trim();
  if (!raw) { closeSearch(); return; }
  if (/^[0-9\s-]+$/.test(raw)) { closeSearch(); lookup(raw); return; }
  if (raw.length < 2) { closeSearch(); return; }

  const seq = ++searchSeq;
  el.searchWrap.hidden = false;

  // A failure reading the device must not take search down with it: the
  // catalogue half can still answer.
  let mine = [];
  try {
    mine = await db.searchLocal(raw, 12);
  } catch (err) {
    mine = [];
  }
  if (seq !== searchSeq) return;                 // a newer keystroke won

  const priced = mine.filter(function (r) { return r.source === 'priced'; });
  const seen = mine.filter(function (r) { return r.source !== 'priced'; });
  const localHtml =
    searchSection('In your price book', priced) +
    searchSection('You scanned before', seen);

  el.searchTitle.textContent = mine.length
    ? mine.length + (mine.length === 1 ? ' match' : ' matches') + ' on this device'
    : 'Nothing of yours matches "' + raw + '"';
  el.searchList.innerHTML = localHtml +
    '<div class="day">Open Food Facts</div>' +
    '<div class="searching" id="search-remote">Searching the catalogue...</div>';

  if (navigator.onLine === false) {
    const off1 = $('#search-remote');
    if (off1) off1.textContent = 'Offline, so only your own items are searchable right now.';
    return;
  }

  try {
    const hits = await off.searchByName(raw, { limit: 20 });
    if (seq !== searchSeq) return;
    const known = {};
    mine.forEach(function (r) { if (r.code) known[r.code] = true; });
    // Anything already above is not repeated underneath.
    const fresh = hits.filter(function (h) { return !known[h.code]; });
    const remote = $('#search-remote');
    if (!remote) return;
    remote.outerHTML = fresh.length
      ? fresh.map(searchRow).join('')
      : '<p class="swap-why">Nothing new in the catalogue for "' + esc(raw) + '".</p>';
  } catch (err) {
    if (seq !== searchSeq) return;
    const remote = $('#search-remote');
    if (remote) remote.textContent = 'The catalogue did not answer. Your own items are above.';
  }
}

// Typing searches; the debounce is short because the local half costs nothing.
function searchAsYouType(value) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () { findByText(value); }, 160);
}

function closeSearch() {
  if (!el.searchWrap) return;
  searchSeq++;                                   // any flight in progress is stale
  clearTimeout(searchTimer);
  el.searchWrap.hidden = true;
  el.searchList.innerHTML = '';
}

// ---------- sheet ----------

function openSheet(title, html) {
  if (!el.sheet) return;
  el.sheetTitle.textContent = title;
  el.sheetBody.innerHTML = html;
  el.sheet.hidden = false;
}
function closeSheet() { if (el.sheet) el.sheet.hidden = true; }

function customFoodSheet() {
  openSheet('Custom food',
    '<p class="panel-note">For anything with no barcode: a bulk bin, a bakery item, ' +
      'something you cooked. Per serving, and only what you actually know.</p>' +
    '<div class="field-row"><input id="cf-name" placeholder="Name" aria-label="Name" /></div>' +
    '<div class="field-row">' +
      '<input id="cf-kcal" inputmode="decimal" placeholder="kcal" aria-label="Energy in kcal" />' +
      '<input id="cf-protein" inputmode="decimal" placeholder="protein g" aria-label="Protein in grams" />' +
    '</div>' +
    '<div class="field-row">' +
      '<input id="cf-carbs" inputmode="decimal" placeholder="carbs g" aria-label="Carbohydrate in grams" />' +
      '<input id="cf-fat" inputmode="decimal" placeholder="fat g" aria-label="Fat in grams" />' +
    '</div>' +
    '<button id="cf-save" class="btn btn-primary btn-block" type="button" ' +
      'style="margin-top:14px">Save and log it</button>');
  $('#cf-save').addEventListener('click', async function () {
    const name = $('#cf-name').value.trim();
    if (!name) { say('Give it a name first.', true); return; }
    const food = {
      name: name,
      kcal: M.num($('#cf-kcal').value), protein: M.num($('#cf-protein').value),
      carbs: M.num($('#cf-carbs').value), fat: M.num($('#cf-fat').value)
    };
    await db.addFood(food);
    await db.addLog(Object.assign({}, food, { servings: 1, meal: lastLogMeal }));
    buzz();
    closeSheet();
    say('Saved and logged.');
    renderToday();
    renderFoodsCount();
  });
}

async function foodsSheet() {
  const list = await db.foods();
  openSheet('Custom foods', list.length
    ? '<div class="list">' + list.map(function (f) {
        const bits = [];
        if (f.kcal != null) bits.push(Math.round(f.kcal) + ' kcal');
        if (f.protein != null) bits.push(M.fmt(f.protein, 1) + ' g protein');
        return '<div class="row-item"><span class="row-main">' +
          '<span class="n">' + esc(f.name) + '</span>' +
          '<span class="m">' + (bits.join(' &middot; ') || 'no nutrition recorded') + '</span></span>' +
          '<button class="step-btn" type="button" data-logfood="' + f.id + '" aria-label="Log it">' +
            '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-plus" /></svg></button>' +
          '<button class="step-btn" type="button" data-delfood="' + f.id + '" aria-label="Delete">' +
            '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-trash" /></svg></button>' +
        '</div>';
      }).join('') + '</div>'
    : '<p class="panel-note">Nothing yet. Add one from the scan tab when an item has no barcode.</p>');
  el.sheetBody.addEventListener('click', async function (e) {
    const logBtn = e.target.closest('[data-logfood]');
    const delBtn = e.target.closest('[data-delfood]');
    if (logBtn) {
      const f = (await db.foods()).filter(function (x) { return x.id === Number(logBtn.dataset.logfood); })[0];
      if (!f) return;
      await db.addLog({ name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs,
        fat: f.fat, servings: 1, meal: lastLogMeal });
      buzz();
      closeSheet();
      say('Logged.');
      renderToday();
    } else if (delBtn) {
      await db.deleteFood(Number(delBtn.dataset.delfood));
      foodsSheet();
      renderFoodsCount();
    }
  });
}

async function renderFoodsCount() {
  if (!el.foodsCount) return;
  const n = (await db.foods()).length;
  el.foodsCount.textContent = n ? String(n) : 'none yet';
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
  el.result.innerHTML = skeletonCard();
  try {
    const res = await off.lookup(code);
    current = { product: res.product, meta: res };
    await renderResult();
    say('');
    // Logged whether or not a price is ever entered, so the history is a record
    // of what you actually looked at rather than only what you bought.
    db.addHistory(res.product, res.source).then(renderHistory).catch(function () {});
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

function skeletonCard() {
  return '<div class="card" aria-hidden="true">' +
    '<div class="product-head"><div class="sk sk-thumb"></div>' +
      '<div class="product-id">' +
        '<div class="sk sk-line" style="width:72%"></div>' +
        '<div class="sk sk-line" style="width:44%;margin-bottom:0"></div>' +
      '</div></div>' +
    '<div class="sk sk-hero"></div>' +
    '<div class="tiles"><div class="sk sk-tile"></div><div class="sk sk-tile"></div></div>' +
  '</div>';
}

// Open Food Facts tags look like "en:milk" or "en:e330". Strip the language
// prefix and tidy the spacing; never translate or reword, because these are
// published values and the app shows them as published.
function tagLabel(tag) {
  const t = String(tag).replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function additiveLabel(tag) {
  const t = String(tag).replace(/^[a-z]{2}:/, '').trim();
  return /^e\d+[a-z]*$/i.test(t) ? t.toUpperCase() : tagLabel(tag);
}
function factChip(text, icon) {
  return '<span class="fact">' +
    (icon ? '<svg class="ic ic-sm" aria-hidden="true"><use href="#' + icon + '" /></svg>' : '') +
    esc(text) + '</span>';
}

// The score, with the reasons that produced it. metrics.grade hands both back
// in one object precisely so this cannot render the number on its own.
function gradeHtml(product) {
  const g = M.grade(product);
  if (g.score == null) {
    return '<p class="panel-note">Not enough published data to score this item. ' +
      'Missing: ' + esc(g.missing.join(', ')) + '. A missing field is not a zero, so ' +
      'the app shows no score rather than a flattering one.</p>';
  }
  const ring = ringOffset(g.score / 100, 16);
  const reasons = g.reasons.map(function (r) {
    return '<div class="reason ' + r.kind + '"><span class="rk"></span>' +
      '<span class="rl">' + esc(r.label) +
        '<span class="rd"> &middot; ' + esc(r.detail) + '</span></span>' +
      '<span class="rp">' + (r.points > 0 ? '+' : '') + r.points + '</span></div>';
  }).join('');
  return '<div class="score">' +
    '<div class="score-dial">' +
      '<svg viewBox="0 0 40 40">' +
        '<circle class="t" cx="20" cy="20" r="16"></circle>' +
        '<circle cx="20" cy="20" r="16" stroke="' + g.band.color + '" ' +
          'stroke-dasharray="' + ring.c.toFixed(2) + '" ' +
          'stroke-dashoffset="' + ring.offset.toFixed(2) + '"></circle>' +
      '</svg>' +
      '<div class="score-mid"><b>' + g.score + '</b><span>/ 100</span></div>' +
    '</div>' +
    '<div>' +
      '<div class="score-band"><span class="rk" style="background:' + g.band.color + '"></span>' +
        esc(g.band.label) + '</div>' +
      '<p class="score-sub">' + g.parts.nutrition + ' nutrition &middot; ' +
        g.parts.additives + ' additives &middot; ' + g.parts.organic + ' organic</p>' +
    '</div>' +
  '</div>' +
  '<details><summary>Why this score</summary><div>' + reasons +
    '<p class="panel-note">Points shown against a baseline of 70. Thresholds follow ' +
    'the Nutri-Score reference points; additives are counted, not ranked by risk.</p>' +
  '</div></details>';
}

// Composition of this food's energy. Not a target, and not compared to one.
function macroHtml(product) {
  const m = M.macroSplit(product);
  if (!m) return '';
  const seg = function (k) {
    return m.pct[k] > 0
      ? '<span class="macro-seg ' + k + '" style="width:' + m.pct[k].toFixed(2) + '%"></span>'
      : '';
  };
  const key = function (k, label) {
    return '<li><span class="dot ' + k + '"></span>' + label +
      ' <b>' + Math.round(m.pct[k]) + '%</b></li>';
  };
  return '<div class="macro">' +
    '<div class="panel-head">Where the energy comes from</div>' +
    '<div class="macro-bar">' + seg('protein') + seg('carbs') + seg('fat') + '</div>' +
    '<ul class="macro-key">' +
      key('protein', 'Protein') + key('carbs', 'Carbs') + key('fat', 'Fat') +
    '</ul>' +
    (m.partial
      ? '<p class="panel-note">Some macros are not published for this item, so the split ' +
        'covers only the ones that are.</p>'
      : '') +
  '</div>';
}

// Allergens and additives exactly as Open Food Facts publishes them. No count
// is called high, and nothing here is scored.
// Declared preferences, matched against published tags. A conflict is stated
// plainly; an absent tag says unknown and never implies the item is fine.
function dietHtml(product) {
  const rows = M.dietCheck(product, diet);
  if (!rows.length) return '';
  const word = { conflict: 'Contains', trace: 'May contain', ok: 'Free from', unknown: 'Unknown' };
  return '<div class="diet">' + rows.map(function (r) {
    return '<span class="diet-flag ' + r.state + '" title="' + esc(r.why) + '">' +
      '<span class="d"></span>' + esc(word[r.state]) + ' &middot; ' + esc(r.label) + '</span>';
  }).join('') + '</div>';
}

function factsHtml(product) {
  const allergens = (product.allergens_tags || []).map(tagLabel);
  const additives = (product.additives_tags || []).map(additiveLabel);
  let out = '';
  if (allergens.length) {
    out += '<div class="panel-head">' +
      '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-alert" /></svg>Allergens as published</div>' +
      '<div class="chips">' + allergens.map(function (a) { return factChip(a); }).join('') + '</div>';
  }
  const raw = product.additives_tags || [];
  if (raw.length) {
    const sum = M.additiveSummary(raw);
    out += '<div class="panel-head">' +
      '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-flask" /></svg>Additives ' +
      '(' + raw.length + ')</div>' +
      sum.rows.map(function (a) {
        return '<div class="add-row"><span class="add-dot ' + a.level + '"></span>' +
          '<span class="add-main"><span class="add-code">' + esc(a.code) + '</span>' +
          '<span class="add-lvl">' + esc(a.label) + '</span>' +
          '<div class="add-note">' + esc(a.note) + '</div></span></div>';
      }).join('') +
      '<p class="panel-note">Levels reflect published assessments, chiefly the EFSA ' +
      're-evaluation programme, not this app\'s opinion. ' +
      (sum.unknowns
        ? sum.unknowns + (sum.unknowns === 1 ? ' additive is' : ' additives are') +
          ' not in the reference table, which means it was not looked up here rather than that it is safe. '
        : '') +
      '<a href="' + M.ADDITIVE_SOURCE + '" target="_blank" rel="noopener">Open Food Facts additive pages</a>.</p>';
  }
  if (!out) {
    return '<p class="panel-note">Open Food Facts lists no allergens or additives for this ' +
      'item. That is a gap in the record, not proof there are none.</p>';
  }
  return out + '<p class="panel-note">Listed as published by Open Food Facts. ' +
    'A missing entry means nobody has filled it in, not that there is nothing to list.</p>';
}

const NUTRIENTS = [
  { k: 'kcal',    label: 'Energy',             unit: ' kcal', digits: 0 },
  { k: 'protein', label: 'Protein',            unit: ' g',    digits: 1 },
  { k: 'carbs',   label: 'Carbohydrate',       unit: ' g',    digits: 1 },
  { k: 'sugars',  label: 'of which sugars',    unit: ' g',    digits: 1 },
  { k: 'fat',     label: 'Fat',                unit: ' g',    digits: 1 },
  { k: 'satFat',  label: 'of which saturates', unit: ' g',    digits: 1 },
  { k: 'fiber',   label: 'Fibre',              unit: ' g',    digits: 1 },
  { k: 'salt',    label: 'Salt',               unit: ' g',    digits: 2 }
];

function paintNutrition() {
  const host = $('#nutrition');
  if (!host || !current) return;
  const p = current.product;
  const srv = M.servingGrams(p);

  if (nutritionBasis === 'serving' && srv == null) {
    host.innerHTML = '<dt>Serving size</dt><dd>not published</dd>';
    return;
  }
  const vals = nutritionBasis === 'serving' ? M.perServing(p) : M.per100(p);
  host.innerHTML = NUTRIENTS.map(function (n) {
    const v = vals[n.k];
    return '<dt>' + n.label + '</dt><dd>' +
      (v == null ? 'not published' : M.fmt(v, n.digits) + n.unit) + '</dd>';
  }).join('');
}

// Candidates are drawn from the user's own price book, so a swap can only ever
// be something they have already scanned. The UI says so, because the honest
// limitation is that the cheaper thing one shelf over is invisible until then.
async function renderSwaps(product, price) {
  const host = $('#swaps');
  if (!host) return;
  const p = M.num(price);
  const mine = M.compute(product, p, {});
  if (mine.costPerGramProtein == null) {
    host.innerHTML = '<p class="swap-why">Enter a price to compare this against ' +
      'what you have already scanned.</p>';
    return;
  }
  const cats = product.categories_tags || [];
  const rows = await db.priceBook();
  const found = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.code || r.code === product.code || !r.comparesOnUnit) continue;
    let cached = null;
    try { cached = await db.getProduct(r.code); } catch (err) { cached = null; }
    if (!cached) continue;
    // Same aisle only. Suggesting oats instead of shampoo is not a swap.
    const theirs = cached.categories_tags || [];
    if (cats.length && theirs.length &&
        !cats.some(function (c) { return theirs.indexOf(c) >= 0; })) continue;
    const protein = M.per100(cached).protein;
    if (protein == null || protein <= 0) continue;
    const cpg = (r.best.unitPer100g / 100) / (protein / 100);
    if (!isFinite(cpg) || cpg >= mine.costPerGramProtein) continue;
    found.push({ row: r, cpg: cpg });
  }
  if (!found.length) {
    host.innerHTML = '<p class="swap-why">Nothing you have scanned beats this on ' +
      'cost per gram of protein. This only searches your own price book.</p>';
    return;
  }
  found.sort(function (a, b) { return a.cpg - b.cpg; });
  host.innerHTML =
    '<p class="swap-why">Cheaper per gram of protein, from items you have already ' +
      'scanned. It cannot see what you have never looked up.</p>' +
    found.slice(0, 3).map(function (f) {
      const cut = Math.round((1 - f.cpg / mine.costPerGramProtein) * 100);
      return '<button class="row-item" type="button" data-code="' + esc(f.row.code) + '">' +
        '<span class="row-main"><span class="n">' + esc(f.row.name) + '</span>' +
        '<span class="m">' + M.centsPerGramProtein(f.cpg) + ' per gram of protein</span></span>' +
        '<span class="row-delta"><span class="n">' + cut + '% less</span>' +
        '<span class="m">per g protein</span></span></button>';
    }).join('');
}

async function renderResult() {
  const p = current.product;
  const meta = current.meta;
  const best = await db.bestPrice(p.code);
  const lastEntry = (await db.entriesFor(p.code))[0];

  const sizeBits = [];
  if (p.brands) sizeBits.push(esc(p.brands));
  if (p.quantity) sizeBits.push(esc(p.quantity));

  // Open Food Facts ships a front photo and we were already caching it. Showing
  // it is how you know at a glance that the scan matched the box in your hand.
  const initial = esc(String(p.product_name || '?').trim().charAt(0).toUpperCase() || '?');

  el.result.innerHTML =
    '<div class="card">' +
      '<div class="product-head">' +
        '<div class="thumb" data-hue="' + hueOf(p.code) + '">' +
          (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy" />' : initial) +
        '</div>' +
        '<div class="product-id">' +
          '<h3>' + esc(p.product_name || 'Unnamed product') + '</h3>' +
          (sizeBits.length ? '<p class="brand">' + sizeBits.join(' &middot; ') + '</p>' : '') +
          '<p class="code">' + esc(p.code) + '</p>' +
          '<span class="cat-chip" style="background:' + P.categoryOf(p).color + '">' +
            '<svg class="ic" aria-hidden="true"><use href="#' + P.categoryOf(p).icon + '" /></svg>' +
            esc(P.categoryOf(p).label) + '</span>' +
        '</div>' +
        '<button id="btn-fav" class="star" type="button" aria-pressed="false" ' +
          'aria-label="Save to favorites" title="Save to favorites">' +
          '<svg class="ic" aria-hidden="true"><use href="#i-star" /></svg></button>' +
      '</div>' +
      '<div class="entry">' +
        '<div class="money">' +
          '<span class="cur" aria-hidden="true">$</span>' +
          '<input id="price-input" inputmode="decimal" placeholder="0.00" ' +
            'aria-label="Price for the package" value="' +
            (lastEntry && lastEntry.price != null ? String(lastEntry.price) : '') + '" />' +
        '</div>' +
        '<input id="store-input" class="store-in" placeholder="Store" aria-label="Store" value="' +
          esc(settings.store || (lastEntry ? lastEntry.store : '')) + '" />' +
      '</div>' +
      // The one number the aisle question actually asks. Exactly one hero per view.
      dietHtml(p) +
      gradeHtml(p) +
      '<div class="hero">' +
        '<span class="hero-v" id="m-serving">--</span>' +
        '<span class="hero-k">cost per serving</span>' +
        '<span class="hero-band" id="hero-band" hidden></span>' +
        '<p class="hero-why" id="hero-why" hidden></p>' +
      '</div>' +
      '<div class="tiles">' +
        '<div class="tile"><span class="tile-v" id="m-protein">--</span>' +
          '<span class="tile-k">cents per gram of protein</span></div>' +
        '<div class="tile"><span class="tile-v" id="m-full">--</span>' +
          '<span class="tile-k">fullness per dollar</span></div>' +
      '</div>' +
      '<div id="best-line" class="note"></div>' +
      '<div id="delta"></div>' +
      '<div class="meter-block">' +
        '<div class="meter-top">' +
          '<span class="meter-k">Fullness estimate</span>' +
          '<span class="meter-v" id="sat-v">not enough data</span>' +
        '</div>' +
        '<div class="meter" id="sat-meter" role="img" aria-label="Fullness estimate">' +
          '<div class="meter-fill" id="sat-fill"></div></div>' +
        '<div class="meter-scale"><span>0</span><span>100</span></div>' +
      '</div>' +
      '<dl class="kv" id="kv"></dl>' +
      macroHtml(p) +
      '<div class="panel-head">Nutrition</div>' +
      '<div class="seg" id="basis-seg">' +
        '<button class="seg-btn" data-basis="serving" type="button">Per serving</button>' +
        '<button class="seg-btn" data-basis="100g" type="button">Per 100 g</button>' +
      '</div>' +
      '<dl class="kv" id="nutrition"></dl>' +
      factsHtml(p) +
      '<div class="panel-head">Add to today</div>' +
      '<div class="seg" id="meal-seg">' +
        MEALS.map(function (m) {
          return '<button class="seg-btn" data-meal="' + m.key + '" type="button">' +
            m.label + '</button>';
        }).join('') +
      '</div>' +
      '<div class="stepper">' +
        '<button class="step-btn" id="srv-down" type="button" aria-label="Fewer servings">' +
          '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-minus" /></svg></button>' +
        '<span class="sv" id="srv-n">1 serving</span>' +
        '<button class="step-btn" id="srv-up" type="button" aria-label="More servings">' +
          '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-plus" /></svg></button>' +
      '</div>' +
      '<button id="btn-log" class="btn btn-soft btn-block" type="button" ' +
        'style="margin-top:10px">Log it</button>' +
      '<div class="panel-head"><svg class="ic ic-sm" aria-hidden="true">' +
        '<use href="#i-swap" /></svg>Cheaper on protein</div>' +
      '<div id="swaps" class="list"></div>' +
      '<div class="panel-head">Every price you have saved</div>' +
      '<div id="entries" class="list"></div>' +
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
      '<button id="btn-save" class="btn btn-primary btn-block" type="button">Save to my price book</button>' +
      (navigator.share
        ? '<button id="btn-share" class="btn btn-soft btn-block" type="button" style="margin-top:10px">' +
            '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-share" /></svg>Share this item</button>'
        : '') +
      '<p class="attribution">Nutrition from Open Food Facts (ODbL), ' +
        (meta.source === 'cache'
          ? 'from your device, saved ' + off.ageLabel(meta.ageMs)
          : 'fetched just now') +
        '. Community data, so it can be wrong.</p>' +
    '</div>';

  // The card paints itself from the product photograph, falling back to the
  // food category, and finally to the view accent. Every step is legible by
  // construction: themeFrom raises the colour until it clears its gate.
  const card = $('#result .card');
  const applyTheme = function (seed) {
    if (!card || !seed) return;
    const dark = typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches;
    const t = P.themeFrom(seed, dark);
    card.style.setProperty('--pc-mark', t.mark);
    card.style.setProperty('--pc-ink', t.ink);
    card.style.setProperty('--pc-wash', t.wash);
    card.classList.add('themed');
  };
  applyTheme(P.categoryOf(p).color);
  if (p.image) {
    P.loadImageColor(p.image).then(function (seed) { if (seed) applyTheme(seed); });
  }

  // Plenty of records publish no serving size. Opening on a basis the item
  // cannot express would show an empty panel by default.
  if (M.servingGrams(p) == null) nutritionBasis = '100g';

  const priceInput = $('#price-input');
  priceInput.addEventListener('input', paint);
  $('#store-input').addEventListener('input', function (e) { settings.store = e.target.value; });
  $('#btn-save').addEventListener('click', savePrice);

  const fav = $('#btn-fav');
  paintFav(fav, await db.isFavorite(p.code));

  // Double tap anywhere on the product art to favourite it, the way you would
  // expect to. The star still works, so the gesture is a shortcut, not the
  // only way in.
  const head = $('#result .product-head');
  if (head) {
    head.style.position = 'relative';
    Mo.onDoubleTap(head, async function (e) {
      const on = await db.toggleFavorite(p);
      paintFav(fav, on);
      if (on) {
        const box = head.getBoundingClientRect();
        Mo.burst(head, e.clientX - box.left, e.clientY - box.top);
        fav.classList.remove('just-on');
        void fav.offsetWidth;
        fav.classList.add('just-on');
      }
      buzz(on ? 14 : 8);
      say(on ? 'Added to favorites.' : 'Removed from favorites.');
      renderHistory();
    });
  }
  fav.addEventListener('click', async function () {
    const on = await db.toggleFavorite(p);
    paintFav(fav, on);
    say(on ? 'Added to favorites.' : 'Removed from favorites.');
    renderHistory();
  });

  document.querySelectorAll('#basis-seg .seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      nutritionBasis = b.dataset.basis;
      paintBasis();
      paintNutrition();
    });
  });

  let servings = 1;
  const srvN = $('#srv-n');
  const paintServings = function () {
    srvN.textContent = servings === 1 ? '1 serving' : M.fmt(servings, 2) + ' servings';
  };
  $('#srv-down').addEventListener('click', function () {
    servings = Math.max(0.25, Math.round((servings - 0.25) * 100) / 100);
    paintServings();
  });
  $('#srv-up').addEventListener('click', function () {
    servings = Math.round((servings + 0.25) * 100) / 100;
    paintServings();
  });
  paintServings();
  const paintMeal = function () {
    document.querySelectorAll('#meal-seg .seg-btn').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.meal === lastLogMeal);
    });
  };
  document.querySelectorAll('#meal-seg .seg-btn').forEach(function (b) {
    b.addEventListener('click', function () { lastLogMeal = b.dataset.meal; paintMeal(); });
  });
  paintMeal();

  const shareBtn = $('#btn-share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async function () {
      const g = M.grade(p);
      const bits = [p.product_name || p.code];
      if (p.brands) bits.push(p.brands);
      const line = bits.join(' - ') +
        (g.score == null ? '' : ' - scores ' + g.score + '/100 (' + g.band.label + ')') +
        ' - barcode ' + p.code;
      try {
        await navigator.share({ title: p.product_name || 'Tare', text: line });
      } catch (err) {
        // A dismissed share sheet is a normal outcome, not a failure to report.
      }
    });
  }

  $('#btn-log').addEventListener('click', async function () {
    const per = M.perServing(p);
    const basis = per.servingGrams == null ? M.per100(p) : per;
    await db.addLog({
      code: p.code, name: p.product_name || p.code, brand: p.brands || '',
      image: p.image || null, servings: servings,
      servingGrams: per.servingGrams,
      kcal: basis.kcal, protein: basis.protein, carbs: basis.carbs, fat: basis.fat,
      meal: lastLogMeal
    });
    buzz();
    say(per.servingGrams == null
      ? 'Logged, using the per 100 g figures since no serving size is published.'
      : 'Logged to today.');
    renderToday();
  });

  renderSwaps(p, lastEntry && lastEntry.price != null ? lastEntry.price : null);
  renderEntries(p.code);
  paintBasis();
  paintNutrition();

  paintBest(best);
  paint();
}

function paintFav(btn, on) {
  if (!btn) return;
  btn.classList.toggle('is-on', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const label = on ? 'Remove from favorites' : 'Save to favorites';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('title', label);
}

// A note, never a block. It is the user's number; the app just says the thing a
// responsible tool says once, quietly, and then gets out of the way.
function paintGoalNote() {
  if (!el.goalNote) return;
  const low = goals.kcal != null && goals.kcal < M.LOW_KCAL_TARGET;
  el.goalNote.hidden = !low;
  if (low) {
    el.goalNote.textContent = 'Targets under ' + M.LOW_KCAL_TARGET + ' kcal are usually ' +
      'advised only with medical supervision. The app will keep using your number.';
  }
}

// Re-reads the settings the app holds in memory. Restoring the database alone
// would leave the running page showing the values from before the wipe.
async function boot2() {
  settings.store = await db.getSetting('store', '');
  settings.household = Number(await db.getSetting('household', 1)) || 1;
  goals = Object.assign({}, M.DEFAULT_GOALS, await db.getSetting('goals', {}));
  showStreak = await db.getSetting('showStreak', true) !== false;
  weightUnit = (await db.getSetting('weightUnit', 'kg')) === 'lb' ? 'lb' : 'kg';
  waterGoal = Number(await db.getSetting('waterGoal', 2000)) || 0;
  diet = await db.getSetting('diet', {}) || {};
  budget = Object.assign({ amount: null, period: 'week' }, await db.getSetting('budget', {}));
  takeoutCost = await db.getSetting('takeout', null);
  trip = await db.getSetting('trip', null);

  el.setStore.value = settings.store;
  el.setHousehold.value = settings.household;
  GOAL_KEYS.forEach(function (k) {
    const i = $('#goal-' + k);
    if (i) i.value = goals[k] == null ? '' : goals[k];
  });
  const bi = $('#goal-budget'); if (bi) bi.value = budget.amount == null ? '' : budget.amount;
  const ti = $('#goal-takeout'); if (ti) ti.value = takeoutCost == null ? '' : takeoutCost;
  const wi = $('#goal-water'); if (wi) wi.value = waterGoal || '';
  document.querySelectorAll('[data-diet]').forEach(function (b) {
    b.checked = !!diet[b.dataset.diet];
  });
  paintGoalNote();
  renderBook(); renderRecent(); renderHistory(); renderToday();
  renderBudget(); renderStores(); renderTrips(); renderMissesCount();
  renderFoodsCount(); paintTrip();
}

async function dismissOnboard() {
  if (el.onboard) el.onboard.hidden = true;
  await db.setSetting('onboarded', true);
}

function paintBasis() {
  document.querySelectorAll('#basis-seg .seg-btn').forEach(function (b) {
    b.classList.toggle('is-on', b.dataset.basis === nutritionBasis);
  });
}

function renderUnknown(code) {
  el.result.innerHTML =
    '<div class="card">' +
      '<div class="product-head">' +
        '<div class="thumb">?</div>' +
        '<div class="product-id">' +
          '<h3>Not in Open Food Facts</h3>' +
          '<p class="brand">Add it by hand and it still counts.</p>' +
          '<p class="code">' + esc(code) + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="entry">' +
        '<input id="u-name" class="store-in" placeholder="Item name" aria-label="Item name" />' +
      '</div>' +
      '<div class="entry">' +
        '<div class="money">' +
          '<span class="cur" aria-hidden="true">$</span>' +
          '<input id="u-price" inputmode="decimal" placeholder="0.00" aria-label="Price" />' +
        '</div>' +
        '<input id="u-store" class="store-in" placeholder="Store" aria-label="Store" value="' +
          esc(settings.store) + '" />' +
      '</div>' +
      '<div class="entry">' +
        '<input id="u-grams" class="store-in" inputmode="decimal" ' +
          'placeholder="Package grams (optional)" aria-label="Package grams" />' +
      '</div>' +
      '<button id="u-save" class="btn btn-primary btn-block" type="button">Add to price book</button>' +
      '<p class="attribution">Manual entry is what makes this work at Costco, Aldi, Trader Joes and WinCo.</p>' +
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
    renderRecent();
  });
}

function paint() {
  // current can outlive its card: wiping local data empties #result while the
  // last scanned product is still held here.
  if (!current || !$('#m-serving')) return;
  const price = M.num($('#price-input') ? $('#price-input').value : null);
  const c = M.compute(current.product, price, { household: settings.household });

  const heroEl = $('#m-serving');
  if (c.costPerServing == null) {
    delete heroEl.dataset.v;
    heroEl.textContent = M.DASH;
  } else {
    Mo.countUp(heroEl, c.costPerServing, function (v) { return M.money(v); });
  }

  // PRODUCT.md section 9 promises a range on every estimate. The hero figure
  // inherits a community-entered serving size, so where that was read out of
  // free text rather than published as a number, it says so and shows a band.
  const band = M.costPerServingRange(current.product, price);
  const bandEl = $('#hero-band');
  const whyEl = $('#hero-why');
  if (bandEl) {
    bandEl.textContent = band ? M.money(band.low) + ' to ' + M.money(band.high) : '';
    bandEl.hidden = !band;
  }
  if (whyEl) {
    whyEl.textContent = band ? band.note : '';
    whyEl.hidden = !band;
  }
  paintDelta(c.costPerServing);
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

  // The bar is bounded 0 to 100 and carries magnitude only. It is one accent at
  // one weight at every value, because a bar that changes colour as it fills is
  // a grade, and this app does not grade food.
  const fill = $('#sat-fill');
  const satv = $('#sat-v');
  const meter = $('#sat-meter');
  const satLabel = sat
    ? sat.score + ' of 100, range ' + sat.low + ' to ' + sat.high
    : 'not enough data';
  if (fill) fill.style.width = (sat ? sat.score : 0) + '%';
  if (satv) satv.textContent = satLabel;
  if (meter) meter.setAttribute('aria-label', 'Fullness estimate: ' + satLabel);

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

// PRODUCT.md section 6. Only appears once the user has told the app what a meal
// out actually costs them, because a guessed baseline flatters the comparison.
function paintDelta(costPerServing) {
  const host = $('#delta');
  if (!host) return;
  const d = M.eatingOutDelta(costPerServing, takeoutCost, settings.household);
  if (!d) { host.innerHTML = ''; return; }
  const total = d.home + d.away;
  const homePct = total > 0 ? (d.home / total) * 100 : 0;
  host.innerHTML =
    '<div class="delta"><div class="delta-top">' +
      '<span class="delta-v">' + M.money(d.saved) + '</span>' +
      '<span class="delta-k">difference' + (d.people > 1 ? ' for ' + d.people : '') + '</span>' +
    '</div>' +
    '<div class="delta-bar">' +
      '<span class="delta-home" style="width:' + homePct.toFixed(1) + '%"></span>' +
      '<span class="delta-away" style="width:' + (100 - homePct).toFixed(1) + '%"></span>' +
    '</div>' +
    '<div class="delta-key"><span>' + M.money(d.home) + ' this' +
      (d.people > 1 ? ', for ' + d.people : '') + '</span>' +
      '<span>' + M.money(d.away) + ' eating out</span></div></div>';
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
  line.innerHTML = 'Your lowest so far <strong>' + what + '</strong>' +
    (best.store ? ' at ' + esc(best.store) : '') + ', ' + dateLabel(best.observedAt) + '.';
}

async function savePrice() {
  if (!current) return;
  const price = M.num($('#price-input').value);
  if (price == null) { say('Enter the price you see on the shelf.', true); return; }
  const p = current.product;
  // The record to beat has to be read before the new row lands, or the new row
  // is the record and every save looks like a personal best.
  const prior = await db.bestPrice(p.code);
  const priorCount = (await db.entriesFor(p.code)).length;

  const saved = await db.addEntry({
    code: p.code,
    name: p.product_name || p.code,
    brand: p.brands || '',
    store: $('#store-input').value || settings.store,
    price: price,
    packageGrams: M.packageGrams(p),
    servingGrams: M.servingGrams(p),
    source: 'scan',
    bought: !!trip,
    tripId: trip ? trip.id : null
  });
  await db.setSetting('store', $('#store-input').value || settings.store);
  paintBest(await db.bestPrice(p.code));
  buzz();
  // ROADMAP phase 3 wants the app to say when you hit your own low. It knew the
  // number already and never mentioned it.
  const beat = prior && prior.unitPer100g != null && saved.unitPer100g != null
    ? saved.unitPer100g < prior.unitPer100g
    : (prior && prior.price != null && saved.price != null ? saved.price < prior.price : false);
  const isFirst = priorCount === 0;
  if (beat && !isFirst) {
    buzz(26);
    const unit = saved.unitPer100g != null;
    const now = unit ? saved.unitPer100g : saved.price;
    const was = unit ? prior.unitPer100g : prior.price;
    const cut = was > 0 ? Math.round((1 - now / was) * 100) : null;
    const stats = [[M.money(was) + (unit ? '' : ''), 'your old low']];
    if (cut != null && cut > 0) stats.push([cut + '%', 'cheaper']);
    if (saved.store) stats.push([saved.store, 'where']);
    await showCheer({
      a: '#5b21b6', b: '#2145c7',
      banner: 'New low!',
      title: p.product_name || p.code,
      value: M.money(now),
      unit: unit ? 'per 100 g' : 'for the package',
      sub: 'The lowest you have ever recorded for this item.',
      stats: stats,
      colors: [P.categoryOf(p).color, '#ffd23f', '#a3e635', '#2a78d6', '#d6437f'],
      cta: 'Nice'
    });
  } else {
    say(isFirst
        ? (trip ? 'Saved, and counted toward this trip.' : 'Saved. Your price book now has this item.')
        : (trip ? 'Saved, and counted toward this trip.' : 'Saved to your price book.'));
  }
  paintTrip();
  renderBudget();
  renderStores();
  renderEntries(p.code);
  renderBook();
  renderRecent();
  renderSwaps(p, price);
}

// ---------- price book ----------

// One row shape, used by the price book and by the recent strip on the scan
// view, so the two can never drift apart. A row with a code is a button that
// pulls the item back up; one without stays inert rather than lying about it.
function bookRow(r) {
  const bestLabel = r.comparesOnUnit
    ? M.money(r.best.unitPer100g) + ' / 100 g'
    : M.money(r.best.price);
  const meta = (r.brand ? esc(r.brand) + ' &middot; ' : '') +
    r.count + (r.count === 1 ? ' entry' : ' entries') +
    ' &middot; last ' + dateLabel(r.latest.observedAt);
  const tag = r.code ? 'button' : 'div';
  return '<' + tag + ' class="row-item"' +
      (r.code ? ' type="button" data-code="' + esc(r.code) + '"' : '') + '>' +
    leadArt({ code: r.code, name: r.name }) +
    '<span class="row-main">' +
      '<span class="n">' + esc(r.name) + '</span>' +
      '<span class="m">' + meta + '</span>' +
    '</span>' +
    '<span class="row-price">' +
      '<span class="n">' + bestLabel + '</span>' +
      '<span class="m">' + (r.best.store ? esc(r.best.store) : 'your low') + '</span>' +
    '</span>' +
  '</' + tag + '>';
}

function emptyState(icon, text) {
  return '<div class="empty">' +
    '<svg class="ic" aria-hidden="true"><use href="#' + icon + '" /></svg>' +
    '<p>' + text + '</p></div>';
}

// ---------- aggregate meter ----------

// One renderer for both meters: a day of food weighted by servings, a basket
// weighted by money. Items with no published score are excluded and said so.
function healthCard(host, title, agg, weightNote) {
  if (!host) return;
  if (agg.score == null) {
    host.hidden = agg.uncounted === 0;
    if (!host.hidden) {
      host.innerHTML =
        '<div class="health-top"><span class="health-k">' + esc(title) + '</span></div>' +
        '<p class="health-note">None of these ' + agg.uncounted +
        (agg.uncounted === 1 ? ' item has' : ' items have') + ' enough published nutrition ' +
        'to be scored, so there is no number to give. That is a gap in the record, ' +
        'not a finding about the food.</p>';
    }
    return;
  }
  host.hidden = false;
  const rounded = Math.round(agg.score);
  host.innerHTML =
    '<div class="health-top"><span class="health-k">' + esc(title) + '</span>' +
      '<span class="health-band"><span class="d" style="background:' + agg.band.color + '"></span>' +
      esc(agg.band.label) + '</span></div>' +
    '<div class="health-v">' + rounded + '<small>/ 100</small></div>' +
    '<div class="health-bar"><div class="health-fill" style="width:' + rounded + '%;' +
      'background:' + agg.band.color + '"></div></div>' +
    '<div class="health-scale"><span>0</span><span>100</span></div>' +
    '<p class="health-note">Averaged over ' + agg.counted +
      (agg.counted === 1 ? ' item' : ' items') + ', ' + esc(weightNote) + '. ' +
      (agg.uncounted
        ? agg.uncounted + (agg.uncounted === 1 ? ' item has' : ' items have') +
          ' no published score and ' + (agg.uncounted === 1 ? 'is' : 'are') +
          ' left out rather than counted as zero.'
        : 'Everything here had a published score.') + '</p>' +
    (agg.thin
      ? '<p class="health-thin">This covers under half of what is here, so read it as ' +
        'a partial picture rather than a verdict on the whole.</p>'
      : '');
}

// Scores come from the cached product record, so this never hits the network.
async function scoreRows(rows, weightOf) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let cached = null;
    try { cached = r.code ? await db.getProduct(r.code) : null; } catch (err) { cached = null; }
    const g = cached ? M.grade(cached) : { score: null };
    out.push({ score: g.score, weight: weightOf(r) });
  }
  return out;
}

async function renderHealthDay(day) {
  if (!el.healthDay) return;
  const rows = await db.logForDay(day);
  if (!rows.length) { el.healthDay.hidden = true; return; }
  const agg = M.aggregateScore(await scoreRows(rows, function (r) { return r.servings || 1; }));
  healthCard(el.healthDay, 'Nutrition score of what you logged', agg, 'weighted by servings');
}

async function renderHealthShop() {
  if (!el.healthShop) return;
  const bounds = M.periodBounds(budget.period);
  const rows = (await db.allEntries()).filter(function (e) {
    return e.bought && e.observedAt >= bounds.start && e.observedAt < bounds.end;
  });
  if (!rows.length) { el.healthShop.hidden = true; return; }
  const agg = M.aggregateScore(await scoreRows(rows, function (e) { return e.price || 1; }));
  healthCard(el.healthShop, 'Nutrition score of what you bought ' + bounds.label,
    agg, 'weighted by what each cost');
}

// ---------- stories ----------
//
// The rail is the last things you looked at, newest first. Opening one is a
// full screen viewer that steps through them: tap right for the next, left to
// go back, swipe down to leave. The timing and the progress bars are the
// familiar mechanic; what is inside is your own price book.

function faceArt(item, cls) {
  return '<span class="' + cls + ' lead" data-hue="' + hueOf(item.code || item.name) + '">' +
    (item.image
      ? '<img src="' + esc(item.image) + '" alt="" loading="lazy" />'
      : initialOf(item.name, item.code)) +
  '</span>';
}

async function renderStories() {
  if (!el.stories) return;
  const rows = (await db.history(12)).filter(function (h) { return h.code; });
  el.stories.hidden = rows.length === 0;
  storyItems = rows;
  const seenBefore = await db.getSetting('storiesSeen', 0);
  el.stories.innerHTML = rows.map(function (h, i) {
    return '<button class="story-btn' + (h.at <= seenBefore ? ' is-seen' : '') +
        '" type="button" data-story="' + i + '">' +
      '<span class="story-ring"><span class="story-inner">' +
        faceArt(h, 'story-face') +
      '</span></span>' +
      '<span class="story-name">' + esc(h.name) + '</span>' +
    '</button>';
  }).join('');
}

function clearStoryTimer() {
  if (storyTimer) clearTimeout(storyTimer);
  storyTimer = 0;
}

async function openStory(index) {
  if (!el.story || !storyItems.length) return;
  storyAt = Math.max(0, Math.min(storyItems.length - 1, index));
  el.story.hidden = false;
  document.body.style.overflow = 'hidden';
  await db.setSetting('storiesSeen', Date.now());
  buzz(8);
  await paintStory();
}

function closeStory() {
  clearStoryTimer();
  if (el.story) el.story.hidden = true;
  document.body.style.overflow = '';
  renderStories();
}

function stepStory(by) {
  const next = storyAt + by;
  if (next < 0) { paintStory(); return; }
  if (next >= storyItems.length) { closeStory(); return; }
  storyAt = next;
  paintStory();
}

async function paintStory() {
  const item = storyItems[storyAt];
  if (!item) { closeStory(); return; }
  clearStoryTimer();

  el.storyBars.style.setProperty('--story-ms', STORY_MS + 'ms');
  el.storyBars.innerHTML = storyItems.map(function (x, i) {
    const cls = i < storyAt ? ' is-done' : (i === storyAt ? ' is-live' : '');
    return '<span class="story-bar' + cls + '"><i></i></span>';
  }).join('');
  el.storyWho.textContent = dayLabel(item.at) + ' at ' + timeLabel(item.at);

  // Everything shown here comes from the cache, so a story never waits on a
  // network round trip between taps.
  const product = await db.getProduct(item.code);
  const best = await db.bestPrice(item.code);
  const g = product ? M.grade(product) : { score: null };
  const stats = [];
  if (best && best.unitPer100g != null) {
    stats.push(['<b>' + M.money(best.unitPer100g) + '</b>', 'your low / 100 g']);
  } else if (best && best.price != null) {
    stats.push(['<b>' + M.money(best.price) + '</b>', 'your low']);
  }
  if (g.score != null) stats.push(['<b>' + g.score + '</b>', g.band.label.toLowerCase()]);
  if (product) {
    const n = M.per100(product);
    if (n.protein != null) stats.push(['<b>' + M.fmt(n.protein, 1) + '</b>', 'g protein / 100 g']);
  }

  el.storyStage.innerHTML =
    '<span class="story-art lead" data-hue="' + hueOf(item.code) + '">' +
      (item.image ? '<img src="' + esc(item.image) + '" alt="" />' : initialOf(item.name, item.code)) +
    '</span>' +
    '<div><h3 class="story-title">' + esc(item.name) + '</h3>' +
    '<p class="story-sub">' + esc([item.brand, item.quantity].filter(Boolean).join(' · ') || item.code) + '</p></div>' +
    (stats.length
      ? '<div class="story-stat">' + stats.map(function (r) {
          return '<div>' + r[0] + '<span>' + esc(r[1]) + '</span></div>';
        }).join('') + '</div>'
      : '');

  const fav = await db.isFavorite(item.code);
  el.storyFoot.innerHTML =
    '<button class="story-act' + (fav ? ' is-on' : '') + '" id="story-fav" type="button">' +
      '<svg class="ic" aria-hidden="true"><use href="#i-heart" /></svg>' +
      (fav ? 'Saved' : 'Save') + '</button>' +
    '<button class="story-act" id="story-open" type="button">' +
      '<svg class="ic" aria-hidden="true"><use href="#i-scan" /></svg>Open</button>';

  $('#story-fav').addEventListener('click', async function () {
    const p = product || { code: item.code, product_name: item.name, brands: item.brand, image: item.image };
    const on = await db.toggleFavorite(p);
    buzz(on ? 14 : 8);
    paintStory();
  });
  $('#story-open').addEventListener('click', function () {
    closeStory();
    showView('scan');
    lookup(item.code);
  });

  storyTimer = setTimeout(function () { stepStory(1); }, STORY_MS);
}

// ---------- home ----------

function greeting(d) {
  const h = (d || new Date()).getHours();
  if (h < 5) return 'Late one';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// The number is carried as a number, not as pre-formatted text, because a
// string cannot be counted up to.
function statCard(tone, icon, num, fmt, label, view) {
  const known = num != null && isFinite(num);
  return '<button class="stat" type="button" data-tone="' + tone + '"' +
      (view ? ' data-goto="' + view + '"' : '') +
      (known ? ' data-num="' + num + '" data-fmt="' + fmt + '"' : '') + '>' +
    '<svg class="ic" aria-hidden="true"><use href="#' + icon + '" /></svg>' +
    '<span class="stat-v">' + (known ? '' : M.DASH) + '</span>' +
    '<span class="stat-k">' + label + '</span>' +
  '</button>';
}

const STAT_FORMATS = {
  money0: function (v) { return M.money(v, 0); },
  int: function (v) { return String(Math.round(v)); }
};

// Runs after the rail is in the DOM: every stat that carries a number counts up
// to it from zero.
function animateStats(host) {
  host.querySelectorAll('.stat[data-num]').forEach(function (card) {
    const v = card.querySelector('.stat-v');
    const fmt = STAT_FORMATS[card.dataset.fmt] || STAT_FORMATS.int;
    v.dataset.v = 0;
    Mo.countUp(v, Number(card.dataset.num), fmt, 520);
  });
}

// The home screen is what you see when you open the app with nothing scanned,
// so it answers "is it worth opening between shops" with numbers you already
// own rather than with an invented reason to come back.
// animate is passed when the user arrives at the view. A background refresh
// after a save re-renders the same numbers and must not replay the entrance.
async function renderHome(opts) {
  const animate = !!(opts && opts.animate);
  if (!el.statRail) return;
  const today = db.dayKey();

  if (el.helloK) el.helloK.textContent = greeting();

  const days = await db.logDays();
  const n = M.streak(days, today);
  if (el.homeStreak) {
    el.homeStreak.hidden = !showStreak || n === 0;
    // Seven dots for the last seven days. A streak you can see beats a streak
    // you are told about, and a gap shows as a gap.
    if (el.weekDots) {
      const set = {};
      days.forEach(function (d) { set[d] = true; });
      let dots = '';
      for (let i = 6; i >= 0; i--) {
        const day = shiftDay(today, -i);
        dots += '<i class="' + (set[day] ? 'on' : '') + (i === 0 ? ' today' : '') + '"></i>';
      }
      el.weekDots.innerHTML = dots;
    }
    if (el.homeStreakN) {
      const before = el.homeStreak.dataset.n;
      el.homeStreakN.textContent = n;
      // Only on a real change, so it does not twitch on every re-render.
      if (before !== undefined && before !== String(n)) {
        el.homeStreak.classList.remove('bumped');
        void el.homeStreak.offsetWidth;
        el.homeStreak.classList.add('bumped');
      }
      el.homeStreak.dataset.n = String(n);
    }
  }

  const [logRows, stats, bounds] = [
    await db.logForDay(today),
    await db.savingsStats(),
    M.periodBounds(budget.period)
  ];
  const spend = await db.spendBetween(bounds.start, bounds.end);
  const st = M.budgetStatus(spend.total, budget.amount, bounds);
  const totals = M.logTotals(logRows);

  if (el.helloT) {
    el.helloT.textContent = stats.items
      ? (current ? 'Here is what you scanned' : 'What are we pricing?')
      : 'Scan something to start your price book';
  }

  const cards = [];
  cards.push(st.budget != null
    ? statCard('book', 'i-wallet', Math.abs(st.left), 'money0',
        st.over ? 'over budget ' + st.label : 'left ' + st.label, 'book')
    : statCard('book', 'i-wallet', st.spent, 'money0', 'spent ' + st.label, 'book'));
  cards.push(statCard('today', 'i-today', totals.kcal, 'int',
    goals.kcal ? 'of ' + Math.round(goals.kcal) + ' kcal today' : 'kcal logged today', 'today'));
  cards.push(statCard('scan', 'i-book', stats.items, 'int',
    stats.items === 1 ? 'item tracked' : 'items tracked', 'book'));
  cards.push(statCard('history', 'i-shop', stats.stores, 'int',
    stats.stores === 1 ? 'store' : 'stores', 'book'));
  el.statRail.innerHTML = cards.join('');
  if (animate) animateStats(el.statRail);
  else el.statRail.querySelectorAll('.stat[data-num]').forEach(function (c) {
    const v = c.querySelector('.stat-v');
    const fmt = STAT_FORMATS[c.dataset.fmt] || STAT_FORMATS.int;
    v.dataset.v = c.dataset.num;
    v.textContent = fmt(Number(c.dataset.num));
  });

  // Wins: the spread your own price book is worth, stated as exactly what it is.
  if (el.wins) {
    if (stats.comparable && stats.spread > 0) {
      el.wins.hidden = false;
      el.wins.innerHTML =
        '<div class="wins-v" id="wins-v"></div>' +
        '<p class="wins-k">the spread in your price book</p>' +
        '<div class="wins-row">' +
          '<div class="wins-cell"><b>' + stats.comparable + '</b>' +
            '<span>' + (stats.comparable === 1 ? 'item comparable' : 'items comparable') + '</span></div>' +
          '<div class="wins-cell"><b>' + stats.prices + '</b>' +
            '<span>' + (stats.prices === 1 ? 'price recorded' : 'prices recorded') + '</span></div>' +
        '</div>' +
        '<p class="wins-note">Across the items you have priced more than once, this is ' +
          'the gap between your highest and your lowest, per package. It is what the ' +
          'spread is worth if you buy at your low, not a claim about money already saved.</p>';
      const winsV = $('#wins-v');
      if (animate) Mo.countUp(winsV, stats.spread, function (v) { return M.money(v); }, 700);
      else { winsV.dataset.v = stats.spread; winsV.textContent = M.money(stats.spread); }
    } else {
      el.wins.hidden = true;
    }
  }

  await renderStories();
  await renderFeed();
  if (animate) {
    Mo.stagger(el.statRail.children, 40);
    if (el.recent) Mo.reveal(el.recent.querySelectorAll('.post'), 60);
    // Scoped to the two home cards. The product result card runs its own flow
    // and must never be caught by an entrance that could leave it hidden.
    Mo.reveal([el.wins, el.tripCard].filter(Boolean), 70);
  }
}

// A feed post: big art, an action row, the price underneath. The art is the
// thing you recognise, so it gets the space.
async function renderFeed() {
  if (!el.recentWrap || !el.recent) return;
  const rows = (await db.priceBook()).slice(0, 12);
  el.recentWrap.hidden = rows.length === 0;
  if (!rows.length) { el.recent.innerHTML = ''; return; }

  const posts = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cached = r.code ? await db.getProduct(r.code) : null;
    const fav = r.code ? await db.isFavorite(r.code) : false;
    const g = cached ? M.grade(cached) : { score: null };
    const item = { code: r.code, name: r.name, image: cached ? cached.image : null };
    const price = r.comparesOnUnit
      ? M.money(r.best.unitPer100g) + ' per 100 g'
      : M.money(r.best.price);
    posts.push(
      '<article class="post" data-post="' + esc(r.code || '') + '">' +
        '<div class="post-head">' +
          faceArt(item, 'post-avatar') +
          '<div class="post-id"><div class="post-n">' + esc(r.name) + '</div>' +
          '<div class="post-m">' + esc(r.brand || '') +
            (r.brand && r.best.store ? ' &middot; ' : '') + esc(r.best.store || '') + '</div></div>' +
        '</div>' +
        '<div class="post-art lead" data-hue="' + hueOf(r.code || r.name) + '" data-art="' + esc(r.code || '') + '">' +
          (item.image ? '<img src="' + esc(item.image) + '" alt="" loading="lazy" />'
                      : initialOf(r.name, r.code)) +
          (g.score != null
            ? '<span class="post-badge"><span class="d" style="background:' + g.band.color + '"></span>' +
              g.score + ' &middot; ' + esc(g.band.label) + '</span>'
            : '') +
        '</div>' +
        '<div class="post-acts">' +
          '<button class="post-act' + (fav ? ' is-on' : '') + '" type="button" data-like="' + esc(r.code || '') + '" ' +
            'aria-label="Favorite"><svg class="ic" aria-hidden="true"><use href="#i-heart" /></svg></button>' +
          '<button class="post-act" type="button" data-quicklog="' + esc(r.code || '') + '" ' +
            'aria-label="Log it"><svg class="ic" aria-hidden="true"><use href="#i-plus" /></svg></button>' +
          '<button class="post-act push" type="button" data-code="' + esc(r.code || '') + '" ' +
            'aria-label="Open"><svg class="ic" aria-hidden="true"><use href="#i-right" /></svg></button>' +
        '</div>' +
        '<div class="post-foot"><div class="post-price">' + price + '</div>' +
          '<div class="post-note">your lowest &middot; ' + r.count +
            (r.count === 1 ? ' price recorded' : ' prices recorded') + '</div></div>' +
      '</article>');
  }
  el.recent.innerHTML = posts.join('');
}

// ---------- today ----------

// The log is a record, so it has to be possible to look back at it. viewDay is
// the day being shown; null means today, which keeps "today" correct across a
// midnight the app was left open through.
function currentDay() {
  return viewDay || db.dayKey();
}

function shiftDay(key, n) {
  const p = String(key).split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
    '-' + String(d.getDate()).padStart(2, '0');
}

function toDisplayWeight(kg) {
  return weightUnit === 'lb' ? kg * LB_PER_KG : kg;
}
function fromDisplayWeight(v) {
  return weightUnit === 'lb' ? v / LB_PER_KG : v;
}

function ringOffset(fraction, radius) {
  const c = 2 * Math.PI * radius;
  return { c: c, offset: c * (1 - Math.max(0, Math.min(1, fraction))) };
}

function goalBar(key, label, value, goal, unit) {
  const known = value != null;
  const pct = goal ? Math.max(0, Math.min(1, (value || 0) / goal)) : 0;
  const right = goal
    ? '<b>' + M.fmt(value || 0, 0) + '</b> <span>/ ' + M.fmt(goal, 0) + unit + '</span>'
    : (known ? '<b>' + M.fmt(value, 0) + unit + '</b> <span>no target</span>'
             : '<span>not published</span>');
  return '<div class="goalbar ' + key + '">' +
    '<div class="gt"><span>' + label + '</span><span>' + right + '</span></div>' +
    '<div class="gr"><div class="gf" style="width:' + (pct * 100).toFixed(1) + '%"></div></div>' +
  '</div>';
}

function loggedRow(r) {
  const per = [];
  if (r.kcal != null) per.push(Math.round(r.kcal * (r.servings || 1)) + ' kcal');
  if (r.protein != null) per.push(M.fmt(r.protein * (r.servings || 1), 1) + ' g protein');
  const servings = (r.servings || 1);
  return '<div class="row-item">' +
    leadArt(r) +
    '<span class="row-main">' +
      '<span class="n">' + esc(r.name) + '</span>' +
      '<span class="m">' + (servings === 1 ? '1 serving' : M.fmt(servings, 2) + ' servings') +
        (per.length ? ' &middot; ' + per.join(' &middot; ') : '') + '</span>' +
    '</span>' +
    '<button class="step-btn" type="button" data-unlog="' + r.id + '" aria-label="Remove from today">' +
      '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-minus" /></svg></button>' +
  '</div>';
}

async function renderToday() {
  if (!el.todayList) return;
  const day = currentDay();
  const today = db.dayKey();
  const rows = await db.logForDay(day);
  const totals = M.logTotals(rows);

  if (el.todayDate) el.todayDate.textContent = dayLabel(dayToTs(day));
  // There is nothing to see in the future, so forward stops at today.
  if (el.dayNext) el.dayNext.disabled = day >= today;
  if (el.dayToday) el.dayToday.hidden = day === today;

  // Streak always describes today, not whichever day is on screen.
  const days = await db.logDays();
  const n = M.streak(days, today);
  if (el.streakChip) {
    el.streakChip.hidden = !showStreak || n === 0;
    if (el.streakN) el.streakN.textContent = n + ' day streak';
  }

  // Energy ring
  const kcal = totals.kcal || 0;
  const r = ringOffset(goals.kcal ? kcal / goals.kcal : 0, 52);
  if (el.kcalRing) {
    el.kcalRing.setAttribute('stroke-dasharray', r.c.toFixed(2));
    el.kcalRing.setAttribute('stroke-dashoffset', r.offset.toFixed(2));
  }
  if (el.kcalNow) el.kcalNow.textContent = Math.round(kcal);
  if (el.kcalGoal) {
    el.kcalGoal.textContent = goals.kcal
      ? 'of ' + Math.round(goals.kcal) + ' kcal'
      : 'kcal logged, no target set';
  }

  if (el.macroGoals) {
    el.macroGoals.innerHTML =
      goalBar('protein', 'Protein', totals.protein, goals.protein, ' g') +
      goalBar('carbs', 'Carbs', totals.carbs, goals.carbs, ' g') +
      goalBar('fat', 'Fat', totals.fat, goals.fat, ' g');
  }
  if (el.todayNote) {
    el.todayNote.textContent = rows.length
      ? 'Totals cover only what the record publishes. A nutrient nobody filled in is left out rather than counted as zero.'
      : 'Nothing logged. Scan an item and add it from its card.';
  }

  // Grouped by meal, in the order a day happens. Rows logged before meals
  // existed have no meal and collect under their own heading rather than
  // being silently reassigned to one.
  const groups = MEALS.map(function (m) {
    return { key: m.key, label: m.label, rows: rows.filter(function (r) { return r.meal === m.key; }) };
  });
  const loose = rows.filter(function (r) { return !r.meal; });
  if (loose.length) groups.push({ key: 'other', label: 'Not assigned', rows: loose });

  const shown = groups.filter(function (g) { return g.rows.length; });
  el.todayList.innerHTML = shown.length
    ? shown.map(function (g) {
        const t = M.logTotals(g.rows);
        return '<div class="meal-head"><span>' + esc(g.label) + '</span>' +
          '<b>' + (t.kcal == null ? '' : Math.round(t.kcal) + ' kcal') + '</b></div>' +
          g.rows.map(loggedRow).join('');
      }).join('')
    : emptyState('i-today', 'Nothing logged on this day.');

  await renderHealthDay(day);
  await renderWater(day);
  await renderTrend(today);
  await renderWeight();
}

function dayToTs(key) {
  const p = String(key).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
}

async function renderWater(day) {
  if (!el.waterV || !el.waterFill) return;
  const ml = await db.getWater(day);
  el.waterV.textContent = waterGoal
    ? Math.round(ml) + ' of ' + waterGoal + ' ml'
    : Math.round(ml) + ' ml';
  el.waterFill.style.width = waterGoal
    ? Math.min(100, (ml / waterGoal) * 100).toFixed(1) + '%'
    : '0%';
}

// Fourteen bars, one per calendar day, blanks included so a gap reads as a gap.
async function renderTrend(today) {
  if (!el.trend) return;
  const all = await db.logDays();
  if (!all.length) {
    el.trend.innerHTML = '<p class="panel-note">No history yet. Days you log will show up here.</p>';
    return;
  }
  const rows = await db.logSince(shiftDay(today, -13));
  const series = M.dailySeries(rows, 14, today);
  const peak = Math.max.apply(null, series.map(function (d) { return d.kcal; }).concat([goals.kcal || 0, 1]));
  const logged = series.filter(function (d) { return d.items > 0; });
  const avg = logged.length
    ? logged.reduce(function (a, d) { return a + d.kcal; }, 0) / logged.length
    : null;

  el.trend.innerHTML =
    '<div class="meter-top"><span class="meter-k">Energy per day</span>' +
      '<span class="meter-v">' + (avg == null ? 'no days logged' :
        Math.round(avg) + ' kcal average over ' + logged.length +
        (logged.length === 1 ? ' day' : ' days')) + '</span></div>' +
    '<div class="trend">' + series.map(function (d) {
      const h = (d.kcal / peak) * 100;
      return '<div class="trend-col" title="' + esc(d.day) + '">' +
        '<div class="trend-bar' + (d.items ? '' : ' is-empty') + '" style="height:' +
        Math.max(2, h).toFixed(1) + '%"></div></div>';
    }).join('') + '</div>' +
    '<div class="trend-x">' + series.map(function (d, i) {
      return '<span>' + (i % 3 === 0 ? d.date.getDate() : '') + '</span>';
    }).join('') + '</div>';
}

async function renderWeight() {
  if (!el.weightInput) return;
  if (el.weightUnit) el.weightUnit.textContent = weightUnit;
  const list = await db.weights();
  const today = db.dayKey();
  const mine = list.filter(function (w) { return w.day === today; })[0];
  if (document.activeElement !== el.weightInput) {
    el.weightInput.value = mine ? M.fmt(toDisplayWeight(mine.kg), 1) : '';
  }

  if (!el.weightTrend) return;
  const pts = list.slice(-30);
  if (pts.length < 2) { el.weightTrend.hidden = true; return; }
  el.weightTrend.hidden = false;
  const vals = pts.map(function (w) { return toDisplayWeight(w.kg); });
  const min = Math.min.apply(null, vals);
  const max = Math.max.apply(null, vals);
  const span = max - min || 1;
  const W = 300, H = 60;
  const d = vals.map(function (v, i) {
    const x = pts.length === 1 ? 0 : (i / (pts.length - 1)) * W;
    const y = H - ((v - min) / span) * H;
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ');
  const lastX = W, lastY = H - ((vals[vals.length - 1] - min) / span) * H;
  el.weightTrend.innerHTML =
    '<div class="panel-head"><svg class="ic ic-sm" aria-hidden="true"><use href="#i-scale" /></svg>' +
      'Last ' + pts.length + ' entries</div>' +
    '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" /><circle cx="' + lastX + '" cy="' + lastY.toFixed(1) + '" r="3.5" />' +
    '</svg>' +
    '<div class="meter-scale">' +
      '<span>' + M.fmt(vals[0], 1) + ' ' + weightUnit + '</span>' +
      '<span>range ' + M.fmt(min, 1) + ' to ' + M.fmt(max, 1) + '</span>' +
      '<span>' + M.fmt(vals[vals.length - 1], 1) + ' ' + weightUnit + '</span>' +
    '</div>';
}

// One full screen surface for every good moment. Resolves when it is dismissed,
// so callers can await it and carry on afterwards.
function showCheer(o) {
  return new Promise(function (resolve) {
    if (!el.cheer) { resolve(); return; }
    el.cheer.style.setProperty('--cheer-a', o.a || '#5b21b6');
    el.cheer.style.setProperty('--cheer-b', o.b || '#2145c7');
    el.cheerBanner.textContent = o.banner || '';
    el.cheerTitle.textContent = o.title || '';
    el.cheerV.textContent = o.value || '';
    // The unit lives under the figure. A hero number that has to share its line
    // with "/ 100 g" either shrinks or runs off the edge.
    el.cheerUnit.textContent = o.unit || '';
    el.cheerUnit.hidden = !o.unit;
    el.cheerSub.textContent = o.sub || '';
    el.cheerStats.innerHTML = (o.stats || []).map(function (r) {
      return '<div class="cheer-stat"><b>' + esc(r[0]) + '</b><span>' + esc(r[1]) + '</span></div>';
    }).join('');
    $('#cheer-go').textContent = o.cta || 'Keep going';
    el.cheer.hidden = false;
    document.body.style.overflow = 'hidden';

    const close = function () {
      el.cheer.hidden = true;
      document.body.style.overflow = '';
      $('#cheer-go').removeEventListener('click', close);
      el.cheer.removeEventListener('click', backdrop);
      document.removeEventListener('keydown', key);
      resolve();
    };
    const backdrop = function (e) { if (e.target === el.cheer) close(); };
    const key = function (e) { if (e.key === 'Escape') close(); };
    $('#cheer-go').addEventListener('click', close);
    el.cheer.addEventListener('click', backdrop);
    document.addEventListener('keydown', key);
    if (o.confetti !== false) celebrate(o.colors);
  });
}

// The one genuinely good thing that happens in this app, so it gets a moment
// rather than a line of grey text.
function celebrate(colors) {
  if (Mo.REDUCED) return;
  const host = document.createElement('div');
  host.className = 'confetti';
  const palette = colors && colors.length
    ? colors
    : ['#7048d8','#2a78d6','#12946a','#b07b00','#d9541f','#d6437f'];
  let html = '';
  for (let i = 0; i < 44; i++) {
    html += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;' +
      'background:' + palette[i % palette.length] + ';' +
      '--dur-c:' + (1.1 + Math.random() * 0.9).toFixed(2) + 's;' +
      'animation-delay:' + (Math.random() * 0.35).toFixed(2) + 's"></i>';
  }
  host.innerHTML = html;
  document.body.appendChild(host);
  setTimeout(function () { host.remove(); }, 2600);
}

// ---------- budget and trips ----------

// One tap starts a trip, one tap ends it, and every price saved in between
// counts as money spent. No per-item confirmation, because the price entry is
// already the confirmation.
async function startTrip() {
  trip = { id: 't' + Date.now(), startedAt: Date.now() };
  await db.setSetting('trip', trip);
  buzz();
  paintTrip();
  say('Trip started. Prices you save now count as spent.');
}

async function endTrip() {
  if (!trip) return;
  const rows = await db.tripEntries(trip.id);
  const total = rows.reduce(function (a, e) { return a + (e.price || 0); }, 0);
  const store = (rows.find(function (e) { return e.store; }) || {}).store || '';
  const minutes = Math.max(1, Math.round((Date.now() - trip.startedAt) / 60000));
  trip = null;
  await db.setSetting('trip', null);
  buzz(20);
  paintTrip();
  renderBudget();
  renderSpend();

  if (!rows.length) { say('Trip ended. Nothing was saved on it.'); return; }

  const bounds = M.periodBounds(budget.period);
  const spend = await db.spendBetween(bounds.start, bounds.end);
  const st = M.budgetStatus(spend.total, budget.amount, bounds);
  const stats = [[String(rows.length), rows.length === 1 ? 'item' : 'items'],
                 [minutes + ' min', 'in store']];
  if (st.budget != null) {
    stats.push([M.money(Math.abs(st.left), 0), st.over ? 'over ' + st.label : 'left ' + st.label]);
  }
  await showCheer({
    a: '#0d7a4e', b: '#2145c7',
    banner: 'Trip done',
    title: store || 'Shopping trip',
    value: M.money(total),
    sub: 'Recorded to your price book and counted toward your budget.',
    stats: stats,
    colors: ['#ffd23f', '#a3e635', '#2fd6a0', '#4f9dff'],
    cta: 'Done'
  });
}

// A trip left running overnight would quietly count tomorrow's browsing as
// today's shopping, so it lapses on its own.
function tripIsStale() {
  return !!trip && Date.now() - trip.startedAt > TRIP_MAX_MS;
}

async function paintTrip() {
  if (!el.tripCard) return;
  if (tripIsStale()) {
    trip = null;
    await db.setSetting('trip', null);
  }
  el.tripCard.hidden = false;
  el.tripCard.classList.toggle('is-on', !!trip);
  if (!trip) {
    el.tripTitle.textContent = 'Shopping trip';
    el.tripSub.textContent = 'Start one and saved prices count toward your budget';
    el.tripBtn.textContent = 'Start';
    return;
  }
  const rows = await db.tripEntries(trip.id);
  const total = rows.reduce(function (a, e) { return a + (e.price || 0); }, 0);
  el.tripTitle.textContent = 'Shopping - ' + M.money(total);
  el.tripSub.textContent = rows.length
    ? rows.length + (rows.length === 1 ? ' item so far' : ' items so far')
    : 'Save a price and it lands here';
  el.tripBtn.textContent = 'End';
}

async function renderBudget() {
  if (!el.budget) return;
  const bounds = M.periodBounds(budget.period);
  const spend = await db.spendBetween(bounds.start, bounds.end);
  const st = M.budgetStatus(spend.total, budget.amount, bounds);

  if (st.budget == null) {
    el.budget.innerHTML =
      '<div class="budget-top"><div>' +
        '<div class="budget-v">' + M.money(st.spent) + '</div>' +
        '<div class="budget-k">spent ' + esc(st.label) + ', ' + spend.items +
          (spend.items === 1 ? ' item' : ' items') + '</div>' +
      '</div><svg class="ic" aria-hidden="true"><use href="#i-wallet" /></svg></div>' +
      '<p class="panel-note">Set a budget in Settings and this shows what is left. ' +
      'It counts prices saved during a shopping trip.</p>';
    return;
  }
  const pacePct = Math.max(0, Math.min(100, (st.expected / st.budget) * 100));
  el.budget.className = 'card budget' + (st.over ? ' budget-over' : '');
  el.budget.innerHTML =
    '<div class="budget-top"><div>' +
      '<div class="budget-v">' + M.money(Math.abs(st.left)) + '</div>' +
      '<div class="budget-k">' + (st.over ? 'over budget ' : 'left ') + esc(st.label) + '</div>' +
    '</div><svg class="ic" aria-hidden="true"><use href="#i-wallet" /></svg></div>' +
    '<div class="meter"><div class="meter-fill" style="width:' + st.pct.toFixed(1) + '%"></div></div>' +
    // A mark on a bar with no label is a riddle on a phone, where there is no
    // hover to explain it. It gets a caption or it does not ship.
    '<div class="budget-pace"><i style="left:' + pacePct.toFixed(1) + '%"></i></div>' +
    '<div class="budget-foot">' +
      '<span>' + M.money(st.spent) + ' of ' + M.money(st.budget) + '</span>' +
      '<span>' + (st.perDay == null
        ? 'last day'
        : M.money(st.perDay) + ' a day for ' + st.daysLeft +
          (st.daysLeft === 1 ? ' day' : ' days')) + '</span>' +
    '</div>' +
    '<p class="budget-legend">The mark is where an even spend rate would sit today, ' +
      M.money(st.expected) + '. It is a reference point, not a target.' +
      (settings.household > 1
        ? ' For ' + settings.household + ' people that is ' +
          M.money(st.budget / settings.household) + ' each ' + esc(st.label) + '.'
        : '') +
    '</p>';
}

// ---------- saved prices for one item ----------

// A price is typed by hand, so it has to be fixable by hand. Without this a
// mistyped low becomes the personal record permanently, because bestPrice
// takes the minimum and nothing could ever remove it.
async function renderEntries(code) {
  const host = $('#entries');
  if (!host) return;
  const rows = await db.entriesFor(code);
  if (!rows.length) {
    host.innerHTML = '<p class="panel-note">No prices saved for this item yet.</p>';
    return;
  }
  host.innerHTML = rows.map(function (e) {
    if (editingEntry === e.id) {
      return '<div class="eedit" data-eid="' + e.id + '">' +
        '<div class="money"><span class="cur">$</span>' +
          '<input class="e-price" inputmode="decimal" value="' +
          (e.price == null ? '' : String(e.price)) + '" aria-label="Price" /></div>' +
        '<input class="store-in e-store" value="' + esc(e.store || '') + '" aria-label="Store" />' +
        '<button class="btn btn-primary btn-sm e-ok" type="button">Save</button>' +
      '</div>';
    }
    const bits = [dateLabel(e.observedAt)];
    if (e.store) bits.push(esc(e.store));
    if (e.unitPer100g != null) bits.push(M.money(e.unitPer100g) + ' / 100 g');
    if (e.bought) bits.push('bought');
    return '<div class="erow">' +
      '<div class="row-item"><span class="row-main">' +
        '<span class="n">' + M.money(e.price) + '</span>' +
        '<span class="m">' + bits.join(' &middot; ') + '</span></span></div>' +
      '<button class="step-btn" type="button" data-eedit="' + e.id + '" aria-label="Edit this price">' +
        '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-pencil" /></svg></button>' +
      '<button class="step-btn" type="button" data-edel="' + e.id + '" aria-label="Delete this price">' +
        '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-trash" /></svg></button>' +
    '</div>';
  }).join('');

  host.querySelectorAll('[data-eedit]').forEach(function (b) {
    b.addEventListener('click', function () {
      editingEntry = Number(b.dataset.eedit);
      renderEntries(code);
    });
  });
  host.querySelectorAll('[data-edel]').forEach(function (b) {
    b.addEventListener('click', async function () {
      const id = Number(b.dataset.edel);
      const snap = await db.snapshot(['entries']);
      await db.deleteEntry(id);
      await refreshAfterPriceChange(code);
      say('Price deleted.', false, {
        label: 'Undo',
        fn: async function () {
          await db.restore(snap);
          await refreshAfterPriceChange(code);
          say('Restored.');
        }
      });
    });
  });
  const ok = host.querySelector('.e-ok');
  if (ok) {
    ok.addEventListener('click', async function () {
      const wrap = ok.closest('[data-eid]');
      const id = Number(wrap.dataset.eid);
      const price = M.num(wrap.querySelector('.e-price').value);
      if (price == null) { say('Enter a price, or delete the row instead.', true); return; }
      await db.updateEntry(id, { price: price, store: wrap.querySelector('.e-store').value });
      editingEntry = null;
      await refreshAfterPriceChange(code);
      say('Price corrected.');
    });
  }
}

async function refreshAfterPriceChange(code) {
  editingEntry = null;
  await renderEntries(code);
  paintBest(await db.bestPrice(code));
  renderBook();
  renderRecent();
  renderBudget();
  renderStores();
}

// ---------- stores and trips ----------

// Where the money goes, by food category, from entries recorded on a trip.
async function renderSpend() {
  if (!el.spend) return;
  const bounds = M.periodBounds(budget.period);
  const rows = (await db.allEntries()).filter(function (e) {
    return e.bought && e.price != null &&
      e.observedAt >= bounds.start && e.observedAt < bounds.end;
  });
  if (!rows.length) {
    el.spend.innerHTML = '<p class="panel-note">Start a shopping trip and the prices you ' +
      'save get grouped here by food category.</p>';
    return;
  }
  const byCat = new Map();
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i];
    let cached = null;
    try { cached = e.code ? await db.getProduct(e.code) : null; } catch (err) { cached = null; }
    const cat = P.categoryOf(cached || {});
    if (!byCat.has(cat.key)) byCat.set(cat.key, { cat: cat, sum: 0, n: 0 });
    const g = byCat.get(cat.key);
    g.sum += e.price; g.n++;
    total += e.price;
  }
  const groups = Array.from(byCat.values()).sort(function (a, b) { return b.sum - a.sum; });

  const R = 54, C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = groups.map(function (g) {
    const frac = total > 0 ? g.sum / total : 0;
    const seg = '<circle cx="66" cy="66" r="' + R + '" stroke="' + g.cat.color + '" ' +
      'stroke-dasharray="' + (frac * C).toFixed(2) + ' ' + C.toFixed(2) + '" ' +
      'stroke-dashoffset="' + (-offset).toFixed(2) + '"></circle>';
    offset += frac * C;
    return seg;
  }).join('');

  el.spend.innerHTML =
    '<div class="spend-wrap">' +
      '<svg class="donut" viewBox="0 0 132 132" aria-hidden="true">' +
        '<circle cx="66" cy="66" r="' + R + '" stroke="var(--surface-2)"></circle>' + arcs +
      '</svg>' +
      '<div class="spend-legend">' + groups.slice(0, 6).map(function (g) {
        return '<div class="spend-row"><span class="d" style="background:' + g.cat.color + '"></span>' +
          '<span class="l">' + esc(g.cat.label) + '</span>' +
          '<span class="v">' + M.money(g.sum) + '</span></div>';
      }).join('') + '</div>' +
    '</div>' +
    '<p class="panel-note">' + M.money(total) + ' across ' + rows.length +
      (rows.length === 1 ? ' item ' : ' items ') + esc(bounds.label) +
      '. Only prices saved during a shopping trip are counted.</p>';
}

async function renderStores() {
  if (!el.stores) return;
  const rows = await db.storeStats();
  if (!rows.length) {
    el.stores.innerHTML = emptyState('i-shop',
      'Put a store name on the prices you save and this ranks them for you.');
    return;
  }
  // The top three ranked stores get a podium; the rest stay as rows below it.
  const ranked = rows.filter(function (r) { return r.index != null; });
  if (el.podium) {
    const top = ranked.slice(0, 3);
    el.podium.hidden = top.length < 2;
    if (top.length >= 2) {
      const cell = function (r, place) {
        if (!r) return '';
        return '<div class="pod pod-' + place + '">' +
          '<span class="pod-name">' + esc(r.store) + '</span>' +
          '<div class="pod-block"><b>' + place + '</b>' +
            '<span>' + r.index.toFixed(2) + '</span></div></div>';
      };
      // Second, first, third, so the tallest block sits in the middle.
      el.podium.innerHTML = cell(top[1], 2) + cell(top[0], 1) + cell(top[2], 3);
    }
  }
  el.stores.innerHTML =
    (ranked.length
      ? '<p class="swap-why">Ranked on the items you have priced at more than one store. ' +
        '1.00 means cheapest every time it could be compared. Items seen at a single ' +
        'store cannot rank anything and are left out.</p>'
      : '<p class="swap-why">Nothing is comparable yet. Price the same item at two ' +
        'different stores and the ranking starts working.</p>') +
    rows.map(function (r, i) {
      // Kept short so it survives a phone width without an ellipsis eating the
      // part that carries the meaning.
      const sub = r.entries + (r.entries === 1 ? ' price' : ' prices') +
        (r.spend > 0 ? ' &middot; ' + M.money(r.spend, 0) : '') +
        (r.comparable
          ? ' &middot; best on ' + r.cheapest + '/' + r.comparable
          : ' &middot; none comparable');
      return '<div class="row-item" style="cursor:default">' +
        '<span class="row-main"><span class="n">' + esc(r.store) + '</span>' +
        '<span class="m">' + sub + '</span></span>' +
        '<span class="row-store' + (r.index != null && i === 0 ? ' store-best' : '') + '">' +
          '<span class="store-index">' + (r.index == null ? '--' : r.index.toFixed(2)) + '</span>' +
          '<span class="m">' + (r.index == null ? 'no index' : 'price index') + '</span>' +
        '</span></div>';
    }).join('');
}

async function renderTrips() {
  if (!el.trips) return;
  const rows = await db.trips(8);
  if (!rows.length) {
    el.trips.innerHTML = emptyState('i-cart',
      'No trips yet. Start one from the scan tab and the prices you save get grouped into it.');
    return;
  }
  el.trips.innerHTML = rows.map(function (t) {
    return '<div class="row-item" style="cursor:default">' +
      '<span class="row-main"><span class="n">' + esc(t.store || 'Trip') + '</span>' +
      '<span class="m">' + dateLabel(t.at) + ' &middot; ' + t.items +
        (t.items === 1 ? ' item' : ' items') + '</span></span>' +
      '<span class="row-price"><span class="n">' + M.money(t.total) + '</span></span>' +
    '</div>';
  }).join('');
}

async function renderMissesCount() {
  if (!el.missesCount) return;
  const n = (await db.misses()).length;
  el.missesCount.textContent = n ? String(n) : 'none';
}

// The failed-scan log exists so the barcode fixture can grow from real
// failures. It was being written and never read, which made it a leak rather
// than a record.
async function missesSheet() {
  const rows = await db.misses();
  openSheet('Scans that failed', rows.length
    ? '<p class="panel-note">Barcodes this app could not resolve. Useful when a ' +
        'decode keeps failing on the same packet, and safe to clear.</p>' +
      '<div class="list">' + rows.slice(0, 50).map(function (m) {
        return '<div class="row-item" style="cursor:default"><span class="row-main">' +
          '<span class="n">' + esc(m.raw) + '</span>' +
          '<span class="m">' + esc(String(m.reason).replace(/_/g, ' ')) + ' &middot; ' +
            dateLabel(m.at) + '</span></span></div>';
      }).join('') + '</div>' +
      '<button id="miss-clear" class="btn btn-soft btn-block" type="button" ' +
        'style="margin-top:14px">Clear the list</button>'
    : '<p class="panel-note">Nothing has failed to resolve. Every scan and every ' +
      'code you typed has been found.</p>');
  const clear = $('#miss-clear');
  if (clear) {
    clear.addEventListener('click', async function () {
      const snap = await db.snapshot(['misses']);
      await db.clearMisses();
      closeSheet();
      renderMissesCount();
      say('Failed scans cleared.', false, {
        label: 'Undo',
        fn: async function () { await db.restore(snap); renderMissesCount(); say('Restored.'); }
      });
    });
  }
}

// ---------- scan history ----------

// A small stable hash of the barcode picks one of the eight categorical hues,
// so an item wears the same colour every time you meet it. It is identity
// decoration next to a name and an initial, never something to decode.
function hueOf(seed) {
  const str = String(seed || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100003;
  return h % 8;
}

function initialOf(name, fallback) {
  return esc(String(name || fallback || '?').trim().charAt(0).toUpperCase() || '?');
}

function leadArt(item) {
  return '<span class="lead" data-hue="' + hueOf(item.code || item.name) + '">' +
    (item.image
      ? '<img src="' + esc(item.image) + '" alt="" loading="lazy" />'
      : initialOf(item.name, item.code)) +
    '</span>';
}

function historyRow(h) {
  const sub = [];
  if (h.brand) sub.push(esc(h.brand));
  if (h.quantity) sub.push(esc(h.quantity));
  if (!sub.length) sub.push(esc(h.code));
  // The time lives in the meta line rather than its own column: with an avatar
  // and two buttons on the row there is not enough width at 390px for a third
  // column, and the name is what you are actually scanning for.
  sub.push(timeLabel(h.at));
  return '<div class="hrow">' +
    '<button class="row-item" type="button" data-code="' + esc(h.code) + '">' +
    leadArt(h) +
    '<span class="row-main">' +
      '<span class="n">' + esc(h.name) + '</span>' +
      '<span class="m">' + sub.join(' &middot; ') + '</span>' +
    '</span>' +
    '</button>' +
    '<button class="step-btn row-relog" type="button" data-relog="' + esc(h.code) + '" ' +
      'aria-label="Log ' + esc(h.name) + ' again">' +
      '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-repeat" /></svg></button>' +
    '<button class="step-btn row-relog" type="button" data-hdel="' + h.id + '" ' +
      'aria-label="Remove ' + esc(h.name) + ' from history">' +
      '<svg class="ic ic-sm" aria-hidden="true"><use href="#i-trash" /></svg></button>' +
  '</div>';
}

// Grouped by calendar day, newest first, the way a log is actually read.
async function renderHistory() {
  if (!el.historyList) return;
  const fav = historyFilter === 'fav';
  const rows = fav ? await db.favorites() : await db.history();

  if (el.historyTitle) {
    el.historyTitle.textContent = fav ? 'Items you starred' : 'Everything you have scanned';
  }
  if (el.clearHistory) el.clearHistory.hidden = fav;

  if (!rows.length) {
    el.historyList.innerHTML = fav
      ? emptyState('i-star', 'No favorites yet. Star an item on its card and it lands here.')
      : emptyState('i-clock', 'Nothing scanned yet. Every item you look up shows up here, priced or not.');
    return;
  }

  let last = null;
  el.historyList.innerHTML = rows.map(function (h) {
    const day = dayLabel(h.at);
    const head = day === last ? '' : '<div class="day">' + esc(day) + '</div>';
    last = day;
    return head + historyRow(h);
  }).join('');
  Mo.stagger(el.historyList.querySelectorAll('.hrow'));
}

// Kept as the name the rest of the app calls; the home screen owns the rails.
async function renderRecent() {
  return renderHome();
}

async function renderBook() {
  const q = (el.bookSearch.value || '').toLowerCase().trim();
  const rows = await db.priceBook();
  const filtered = q
    ? rows.filter(function (r) {
        return (r.name + ' ' + r.brand + ' ' + (r.code || '')).toLowerCase().indexOf(q) >= 0;
      })
    : rows;

  if (!filtered.length) {
    el.bookList.innerHTML = q
      ? emptyState('i-search', 'Nothing in your price book matches &ldquo;' + esc(q) + '&rdquo;.')
      : emptyState('i-book', 'Nothing here yet. Scan something and save the price you see on the shelf.');
    return;
  }

  el.bookList.innerHTML = filtered.map(bookRow).join('');
  Mo.stagger(el.bookList.children);
}

// One download path for both exports, so a fix to either applies to both.
function downloadCsv(csv, name) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

async function doExport() {
  downloadCsv(await db.exportCsv(), 'tare-prices');
}

async function doExportHistory() {
  const rows = await db.history();
  if (!rows.length) { say('Nothing scanned yet, so there is nothing to export.', true); return; }
  downloadCsv(await db.exportHistoryCsv(), 'tare-scans');
  say('Exported ' + rows.length + (rows.length === 1 ? ' scan.' : ' scans.'));
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

  const seen = await db.getSetting('onboarded', false);
  if (!seen && el.onboard) el.onboard.hidden = false;

  settings.store = await db.getSetting('store', '');
  settings.household = Number(await db.getSetting('household', 1)) || 1;
  goals = Object.assign({}, M.DEFAULT_GOALS, await db.getSetting('goals', {}));
  showStreak = await db.getSetting('showStreak', true) !== false;
  weightUnit = (await db.getSetting('weightUnit', 'kg')) === 'lb' ? 'lb' : 'kg';
  waterGoal = Number(await db.getSetting('waterGoal', 2000)) || 0;
  diet = await db.getSetting('diet', {}) || {};
  budget = Object.assign({ amount: null, period: 'week' }, await db.getSetting('budget', {}));
  takeoutCost = await db.getSetting('takeout', null);
  trip = await db.getSetting('trip', null);
  el.setStore.value = settings.store;
  el.setHousehold.value = settings.household;

  el.scan.addEventListener('click', startScanning);
  el.stopScan.addEventListener('click', stopScanning);
  el.manualForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearTimeout(searchTimer);
    findByText(el.manualCode.value);
  });
  el.manualCode.addEventListener('input', function (e) {
    const v = e.target.value.trim();
    // A barcode is not searched for as you type; it is looked up when you submit.
    if (/^[0-9\s-]*$/.test(v)) { closeSearch(); return; }
    searchAsYouType(v);
  });
  $('#btn-search-close').addEventListener('click', closeSearch);
  $('#btn-custom').addEventListener('click', customFoodSheet);
  $('#sheet-close').addEventListener('click', closeSheet);
  el.sheet.addEventListener('click', function (e) { if (e.target === el.sheet) closeSheet(); });
  el.onboard.addEventListener('click', function (e) { if (e.target === el.onboard) dismissOnboard(); });
  $('#ob-start').addEventListener('click', dismissOnboard);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSheet(); if (!el.onboard.hidden) dismissOnboard(); }
  });

  // Day navigation
  if (el.dayPrev) el.dayPrev.addEventListener('click', function () {
    viewDay = shiftDay(currentDay(), -1);
    renderToday();
  });
  if (el.dayNext) el.dayNext.addEventListener('click', function () {
    const next = shiftDay(currentDay(), 1);
    viewDay = next >= db.dayKey() ? null : next;
    renderToday();
  });
  if (el.dayToday) el.dayToday.addEventListener('click', function () {
    viewDay = null;
    renderToday();
  });

  // Water
  const water = function (ml) {
    return async function () {
      await db.addWater(currentDay(), ml);
      buzz(8);
      renderWater(currentDay());
    };
  };
  const w1 = $('#water-250'), w2 = $('#water-500'), w3 = $('#water-minus');
  if (w1) w1.addEventListener('click', water(250));
  if (w2) w2.addEventListener('click', water(500));
  if (w3) w3.addEventListener('click', water(-250));

  // Dietary preferences
  if (el.dietGroup) {
    el.dietGroup.innerHTML = M.DIETS.map(function (d) {
      return '<label class="cell"><span class="cell-k">' + esc(d.label) + '</span>' +
        '<span class="switch"><input type="checkbox" data-diet="' + d.key + '"' +
        (diet[d.key] ? ' checked' : '') + ' /><span class="switch-ui"></span></span></label>';
    }).join('');
    el.dietGroup.addEventListener('change', async function (e) {
      const box = e.target.closest('[data-diet]');
      if (!box) return;
      diet[box.dataset.diet] = box.checked;
      await db.setSetting('diet', diet);
      if (current) renderResult();
    });
  }

  if (el.tripBtn) {
    el.tripBtn.addEventListener('click', function () { trip ? endTrip() : startTrip(); });
  }
  const budgetInput = $('#goal-budget');
  if (budgetInput) {
    budgetInput.value = budget.amount == null ? '' : budget.amount;
    budgetInput.addEventListener('change', async function () {
      const v = M.num(budgetInput.value);
      budget.amount = v != null && v > 0 ? v : null;
      await db.setSetting('budget', budget);
      renderBudget();
    });
  }
  const periodSel = $('#goal-period');
  if (periodSel) {
    periodSel.value = budget.period;
    periodSel.addEventListener('change', async function () {
      budget.period = periodSel.value === 'month' ? 'month' : 'week';
      await db.setSetting('budget', budget);
      renderBudget();
    });
  }

  // One tap re-logs from history: the cached product supplies the nutrition, so
  // it never needs a round trip or a second screen.
  if (el.historyList) {
    el.historyList.addEventListener('click', async function (e) {
      const del = e.target.closest('[data-hdel]');
      if (del) {
        e.stopPropagation();
        const snap = await db.snapshot(['history']);
        await db.deleteHistory(Number(del.dataset.hdel));
        renderHistory();
        say('Removed from history.', false, {
          label: 'Undo',
          fn: async function () { await db.restore(snap); renderHistory(); say('Restored.'); }
        });
        return;
      }
      const btn = e.target.closest('[data-relog]');
      if (!btn) return;
      e.stopPropagation();
      const code = btn.dataset.relog;
      const p = await db.getProduct(code);
      if (!p) { say('Nothing cached for that item yet. Open it once first.', true); return; }
      const per = M.perServing(p);
      const basis = per.servingGrams == null ? M.per100(p) : per;
      await db.addLog({
        code: p.code, name: p.product_name || p.code, brand: p.brands || '',
        image: p.image || null, servings: 1, servingGrams: per.servingGrams,
        kcal: basis.kcal, protein: basis.protein, carbs: basis.carbs, fat: basis.fat,
        meal: lastLogMeal
      });
      buzz();
      say('Logged ' + (p.product_name || code) + '.');
      renderToday();
    });
  }

  const takeoutInput = $('#goal-takeout');
  if (takeoutInput) {
    takeoutInput.value = takeoutCost == null ? '' : takeoutCost;
    takeoutInput.addEventListener('change', async function () {
      const v = M.num(takeoutInput.value);
      takeoutCost = v != null && v > 0 ? v : null;
      await db.setSetting('takeout', takeoutCost);
      if (current) paint();
    });
  }
  $('#btn-misses').addEventListener('click', missesSheet);
  renderMissesCount();

  const waterInput = $('#goal-water');
  if (waterInput) {
    waterInput.value = waterGoal || '';
    waterInput.addEventListener('change', async function () {
      const v = M.num(waterInput.value);
      waterGoal = v != null && v > 0 ? v : 0;
      await db.setSetting('waterGoal', waterGoal);
      renderToday();
    });
  }

  // Import, custom foods, install
  $('#btn-import').addEventListener('click', function () { el.importFile.click(); });
  el.importFile.addEventListener('change', async function () {
    const file = el.importFile.files && el.importFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await db.importCsv(text);
      say('Imported ' + res.added + (res.added === 1 ? ' row' : ' rows') +
        (res.skipped ? ', skipped ' + res.skipped + ' already present.' : '.'));
      renderBook();
      renderRecent();
    } catch (err) {
      say(err && err.message === 'CSV_HEADER_UNRECOGNISED'
        ? 'That CSV has headers this app does not recognise. Export one first to see the shape.'
        : 'Could not read that file.', true);
    }
    el.importFile.value = '';
  });
  $('#btn-foods').addEventListener('click', foodsSheet);
  renderFoodsCount();

  if (el.installBtn) {
    el.installBtn.addEventListener('click', async function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') el.installBtn.hidden = true;
      installPrompt = null;
    });
  }
  el.bookSearch.addEventListener('input', renderBook);
  el.exportBtn.addEventListener('click', doExport);
  el.setStore.addEventListener('change', function (e) {
    settings.store = e.target.value;
    db.setSetting('store', settings.store);
  });
  GOAL_KEYS.forEach(function (k) {
    const input = $('#goal-' + k);
    if (!input) return;
    input.value = goals[k] == null ? '' : goals[k];
    input.addEventListener('change', async function () {
      const v = M.num(input.value);
      goals[k] = v != null && v > 0 ? v : null;
      await db.setSetting('goals', goals);
      paintGoalNote();
      renderToday();
    });
  });
  const streakToggle = $('#goal-streak');
  if (streakToggle) {
    streakToggle.checked = showStreak;
    streakToggle.addEventListener('change', async function () {
      showStreak = streakToggle.checked;
      await db.setSetting('showStreak', showStreak);
      renderToday();
    });
  }
  const unitSel = $('#goal-unit');
  if (unitSel) {
    unitSel.value = weightUnit;
    unitSel.addEventListener('change', async function () {
      weightUnit = unitSel.value === 'lb' ? 'lb' : 'kg';
      await db.setSetting('weightUnit', weightUnit);
      renderToday();
    });
  }
  if (el.weightInput) {
    el.weightInput.addEventListener('change', async function () {
      const v = M.num(el.weightInput.value);
      await db.setWeight(db.dayKey(), v == null ? null : fromDisplayWeight(v));
      say(v == null ? 'Weight cleared for today.' : 'Weight recorded.');
      renderToday();
    });
  }
  paintGoalNote();

  el.setHousehold.addEventListener('change', function (e) {
    settings.household = Math.max(1, Number(e.target.value) || 1);
    db.setSetting('household', settings.household);
    paint();
    renderBudget();
  });
  el.wipe.addEventListener('click', async function () {
    if (!confirm('Delete every price you have saved on this device?')) return;
    // Held in memory only, so it dies with the page rather than becoming a
    // second copy of data the user just asked to delete.
    const snap = await db.snapshot();
    await db.wipe();
    settings = { store: '', household: 1 };
    current = null;
    el.setStore.value = '';
    el.setHousehold.value = 1;
    el.result.innerHTML = '';
    goals = { kcal: null, protein: null, carbs: null, fat: null };
    GOAL_KEYS.forEach(function (k) { const i = $('#goal-' + k); if (i) i.value = ''; });
    if (el.weightInput) el.weightInput.value = '';
    paintGoalNote();
    renderBook();
    renderRecent();
    renderHistory();
    renderToday();
    renderFoodsCount();
    trip = null;
    paintTrip();
    renderBudget();
    renderStores();
    renderTrips();
    renderMissesCount();
    diet = {};
    document.querySelectorAll('[data-diet]').forEach(function (b) { b.checked = false; });
    say('Local data deleted.', false, {
      label: 'Undo',
      fn: async function () {
        await db.restore(snap);
        await boot2();
        say('Everything restored.');
      }
    });
  });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.dataset.view); });
  });
  document.querySelectorAll('.tab-link').forEach(function (t) {
    t.addEventListener('click', function () { showView(t.dataset.view); });
  });

  document.querySelectorAll('.seg-btn[data-hfilter]').forEach(function (b) {
    b.addEventListener('click', function () {
      historyFilter = b.dataset.hfilter;
      document.querySelectorAll('.seg-btn[data-hfilter]').forEach(function (o) {
        o.classList.toggle('is-on', o === b);
      });
      renderHistory();
    });
  });

  const expHist = $('#btn-export-history');
  if (expHist) expHist.addEventListener('click', doExportHistory);

  if (el.clearHistory) {
    el.clearHistory.addEventListener('click', async function () {
      if (!confirm('Clear your scan history? Saved prices and favorites are kept.')) return;
      const snap = await db.snapshot(['history']);
      await db.clearHistory();
      renderHistory();
      say('Scan history cleared.', false, {
        label: 'Undo',
        fn: async function () { await db.restore(snap); renderHistory(); say('History restored.'); }
      });
    });
  }

  if (el.todayList) {
    el.todayList.addEventListener('click', async function (e) {
      const btn = e.target.closest('[data-unlog]');
      if (!btn) return;
      await db.deleteLog(Number(btn.dataset.unlog));
      renderToday();
    });
  }

  // Delegated so rows re-rendered later stay clickable without rebinding.
  if (el.stories) {
    el.stories.addEventListener('click', function (e) {
      const b = e.target.closest('[data-story]');
      if (b) openStory(Number(b.dataset.story));
    });
  }
  $('#story-close').addEventListener('click', closeStory);
  $('#story-next').addEventListener('click', function () { buzz(5); stepStory(1); });
  $('#story-prev').addEventListener('click', function () { buzz(5); stepStory(-1); });
  Mo.dragToDismiss(el.story, closeStory);
  document.addEventListener('keydown', function (e) {
    if (el.story.hidden) return;
    if (e.key === 'Escape') closeStory();
    if (e.key === 'ArrowRight') stepStory(1);
    if (e.key === 'ArrowLeft') stepStory(-1);
  });

  // Feed actions. Delegated, so posts re-rendered later keep working.
  if (el.recent) {
    el.recent.addEventListener('click', async function (e) {
      const like = e.target.closest('[data-like]');
      const log = e.target.closest('[data-quicklog]');
      if (like) {
        const code = like.dataset.like;
        const p = await db.getProduct(code);
        if (!p) return;
        const on = await db.toggleFavorite(p);
        like.classList.toggle('is-on', on);
        buzz(on ? 14 : 8);
        return;
      }
      if (log) {
        const p = await db.getProduct(log.dataset.quicklog);
        if (!p) { say('Open it once first so the nutrition is cached.', true); return; }
        const per = M.perServing(p);
        const basis = per.servingGrams == null ? M.per100(p) : per;
        await db.addLog({
          code: p.code, name: p.product_name || p.code, brand: p.brands || '',
          image: p.image || null, servings: 1, servingGrams: per.servingGrams,
          kcal: basis.kcal, protein: basis.protein, carbs: basis.carbs, fat: basis.fat,
          meal: lastLogMeal
        });
        buzz();
        say('Logged ' + (p.product_name || p.code) + '.');
        renderToday();
      }
    });

    // Double tap the art to favourite, with the heart Instagram taught everyone
    // to expect.
    Mo.onDoubleTap(el.recent, async function (e) {
      const art = e.target.closest('[data-art]');
      if (!art) return;
      const p = await db.getProduct(art.dataset.art);
      if (!p) return;
      const on = await db.toggleFavorite(p);
      buzz(on ? 16 : 8);
      const btn = art.closest('.post').querySelector('[data-like]');
      if (btn) btn.classList.toggle('is-on', on);
      if (!on) return;
      art.style.position = 'relative';
      const heart = document.createElement('span');
      heart.className = 'fly-heart';
      heart.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-heart" /></svg>';
      art.appendChild(heart);
      setTimeout(function () { heart.remove(); }, 800);
    });
  }

  if (el.statRail) {
    el.statRail.addEventListener('click', function (e) {
      const b = e.target.closest('[data-goto]');
      if (!b) return;
      buzz(6);
      showView(b.dataset.goto);
    });
  }

  [el.bookList, el.recent, el.historyList, el.searchList, $('#result')]
    .forEach(function (host) {
    if (!host) return;
    host.addEventListener('click', function (e) {
      const row = e.target.closest('.row-item[data-code], .post [data-code]');
      if (!row) return;
      showView('scan');
      closeSearch();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      lookup(row.dataset.code);
    });
  });

  // Chromium hands the install prompt over once; hold it so the button is real
  // rather than a set of instructions the user has to follow by hand.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    if (el.installBtn) el.installBtn.hidden = false;
  });

  // Swipe between tabs. The scroller keeps vertical intent, so this only fires
  // on a drag that is clearly sideways.
  Mo.onSwipe(document.body, {
    onLeft: function () {
      const i = VIEWS.indexOf(activeView);
      if (i < VIEWS.length - 1) { buzz(6); showView(VIEWS[i + 1], 'left'); }
    },
    onRight: function () {
      const i = VIEWS.indexOf(activeView);
      if (i > 0) { buzz(6); showView(VIEWS[i - 1], 'right'); }
    }
  });

  // Pull down at the top of any view to refresh what it shows.
  if (el.ptr) {
    Mo.pullToRefresh(document.body, el.ptr, async function () {
      buzz(10);
      await Promise.all([
        renderBook(), renderHome(), renderHistory(), renderToday(),
        renderBudget(), renderStores(), renderTrips(), renderSpend(), renderHealthShop()
      ]);
      if (current) await renderResult();
    });
  }

  // A sheet can be thrown away rather than aimed at a close button.
  document.querySelectorAll('.sheet-panel').forEach(function (panel) {
    Mo.dragToDismiss(panel, function () {
      if (panel.closest('#onboard')) dismissOnboard();
      else closeSheet();
    });
  });

  // The app bar tightens up once you have started reading.
  let ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      if (el.appbar) el.appbar.classList.toggle('is-scrolled', window.scrollY > 8);
      ticking = false;
    });
  }, { passive: true });

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
  renderHome({ animate: true });
  renderHistory();
  renderToday();
  renderBudget();
  renderStores();
  renderTrips();
  renderSpend();
  renderHealthShop();
  paintTrip();

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      // Offline support is a bonus here, never a hard requirement to run.
    }
  }
}

boot();
