// Gestures and motion.
//
// The app was correct and completely inert: every interaction was a tap on a
// static page. This file adds the layer that makes a phone app feel like one -
// swipe between tabs, pull to refresh, drag a sheet away, numbers that move
// when they change.
//
// Two rules throughout:
//   - a gesture never fights the scroller. Vertical intent wins by default and
//     a horizontal swipe has to prove itself before anything moves.
//   - every effect here is decoration over behaviour that already works by tap,
//     so prefers-reduced-motion can switch all of it off and lose nothing.

export const REDUCED = typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Pure gesture maths, kept separate from the DOM so it can be tested directly.
// ---------------------------------------------------------------------------

// A drag is horizontal only if it is far enough AND clearly more sideways than
// down. Without the ratio a slow diagonal scroll flips the tab under the thumb.
export function swipeIntent(dx, dy, opts) {
  const o = opts || {};
  const min = o.min == null ? 60 : o.min;
  const ratio = o.ratio == null ? 1.7 : o.ratio;
  if (Math.abs(dx) < min) return null;
  if (Math.abs(dx) < Math.abs(dy) * ratio) return null;
  return dx < 0 ? 'left' : 'right';
}

// Rubber banding: the further you pull, the less it gives. Past the trigger the
// resistance is what tells your thumb the gesture has armed.
export function rubber(distance, limit) {
  const d = Math.max(0, distance);
  const l = limit == null ? 120 : limit;
  return l * (1 - Math.exp(-d / l));
}

export function easeOutCubic(t) {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

// ---------------------------------------------------------------------------
// Swipe between views
// ---------------------------------------------------------------------------

export function onSwipe(target, handlers) {
  let x0 = 0, y0 = 0, tracking = false;
  target.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { tracking = false; return; }
    // A swipe that starts inside something scrolled sideways belongs to it.
    if (e.target.closest && e.target.closest('[data-noswipe]')) { tracking = false; return; }
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });

  target.addEventListener('touchend', function (e) {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dir = swipeIntent(t.clientX - x0, t.clientY - y0);
    if (dir === 'left' && handlers.onLeft) handlers.onLeft();
    if (dir === 'right' && handlers.onRight) handlers.onRight();
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Pull to refresh
// ---------------------------------------------------------------------------

export function pullToRefresh(scroller, indicator, onRefresh) {
  const TRIGGER = 64;
  let y0 = 0, pulling = false, armed = false, busy = false;

  const reset = function () {
    indicator.style.transform = '';
    indicator.classList.remove('is-armed', 'is-busy');
    pulling = false;
    armed = false;
  };

  scroller.addEventListener('touchstart', function (e) {
    // Only from a genuine top, or the gesture steals ordinary scrolling.
    if (busy || e.touches.length !== 1 || window.scrollY > 0) { pulling = false; return; }
    y0 = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  scroller.addEventListener('touchmove', function (e) {
    if (!pulling || busy) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0) { reset(); return; }
    const pulled = rubber(dy, 110);
    indicator.style.transform = 'translateY(' + pulled + 'px) rotate(' + (pulled * 3) + 'deg)';
    armed = pulled > TRIGGER;
    indicator.classList.toggle('is-armed', armed);
  }, { passive: true });

  scroller.addEventListener('touchend', async function () {
    if (!pulling || busy) return;
    if (!armed) { reset(); return; }
    busy = true;
    indicator.classList.add('is-busy');
    indicator.style.transform = 'translateY(56px)';
    try { await onRefresh(); } catch (err) { /* a failed refresh is not a crash */ }
    busy = false;
    reset();
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Drag a bottom sheet away
// ---------------------------------------------------------------------------

export function dragToDismiss(panel, onDismiss) {
  let y0 = 0, dragging = false, dy = 0;
  panel.addEventListener('touchstart', function (e) {
    // Only when the sheet is scrolled to its own top, so dragging does not
    // hijack scrolling within a long sheet.
    if (e.touches.length !== 1 || panel.scrollTop > 0) { dragging = false; return; }
    y0 = e.touches[0].clientY;
    dragging = true;
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', function (e) {
    if (!dragging) return;
    dy = e.touches[0].clientY - y0;
    if (dy < 0) dy = -rubber(-dy, 40);      // resists upward, gives downward
    panel.style.transform = 'translateY(' + dy + 'px)';
  }, { passive: true });

  panel.addEventListener('touchend', function () {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 110) onDismiss();
    dy = 0;
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Numbers that move when they change
// ---------------------------------------------------------------------------

export function countUp(node, to, format, ms) {
  const from = Number(node.dataset.v || 0);
  const target = Number(to);
  if (!isFinite(target)) return;
  node.dataset.v = String(target);
  if (REDUCED || from === target) { node.textContent = format(target); return; }

  const dur = ms || 420;
  const started = performance.now();
  const step = function (now) {
    const t = easeOutCubic((now - started) / dur);
    node.textContent = format(from + (target - from) * t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// A double tap is two taps close in time and close in space. Without the
// distance check, two quick taps on different rows read as one double tap.
export function onDoubleTap(target, handler) {
  let last = 0, lx = 0, ly = 0;
  target.addEventListener('click', function (e) {
    const now = Date.now();
    const near = Math.abs(e.clientX - lx) < 40 && Math.abs(e.clientY - ly) < 40;
    if (now - last < 320 && near) {
      last = 0;
      handler(e);
      return;
    }
    last = now;
    lx = e.clientX;
    ly = e.clientY;
  });
}

export function burst(host, x, y) {
  if (REDUCED) return;
  const el = document.createElement('span');
  el.className = 'burst';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  host.appendChild(el);
  setTimeout(function () { el.remove(); }, 700);
}

// Reveal on scroll. Cards below the fold animate when they arrive rather than
// all at once at load, where the ones off screen would finish unseen and appear
// already-landed. Falls back to an immediate stagger where there is no observer.
export function reveal(nodes, step) {
  const list = Array.prototype.slice.call(nodes);
  if (REDUCED) return;
  if (typeof IntersectionObserver !== 'function') { stagger(list, step); return; }

  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      const i = Number(entry.target.dataset.revealI || 0);
      entry.target.style.animationDelay = Math.min(i, 8) * (step || 55) + 'ms';
      entry.target.classList.add('enters');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  let i = 0;
  const pending = [];
  list.forEach(function (n) {
    // A node that has already arrived is left alone. Without this, re-rendering
    // a view would hide everything on screen and play the entrance again.
    if (n.classList.contains('enters')) return;
    n.dataset.revealI = i++;
    n.classList.add('pre-enter');
    pending.push(n);
    io.observe(n);
  });

  // pre-enter sets opacity to zero, so anything the observer never reports -
  // hidden behind another view, zero-height at the moment it was observed - is
  // shown anyway. An entrance animation must never be able to hide content.
  setTimeout(function () {
    pending.forEach(function (n) {
      if (n.classList.contains('enters')) return;
      n.classList.remove('pre-enter');
      io.unobserve(n);
    });
  }, 1400);

  return io;
}

// Staggered entrance. Index capped so a hundred-row list does not spend two
// seconds arriving.
export function stagger(nodes, step) {
  if (REDUCED) return;
  const s = step || 26;
  Array.prototype.forEach.call(nodes, function (n, i) {
    n.style.animationDelay = Math.min(i, 12) * s + 'ms';
    n.classList.add('enters');
  });
}
