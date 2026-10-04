/* ==========================================================================
   TURINOZ / LAB — layout and interaction
   Builds the index from assets/js/projects.js, then adds the custom cursor,
   magnetic links and the entrance. You shouldn't need to edit this file.
   ========================================================================== */

(() => {
  'use strict';

  const LAB = window.LAB;
  const site = LAB.site;
  const projects = LAB.projects;
  const root = document.documentElement;
  const body = document.body;

  const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  root.classList.add('js');
  root.classList.toggle('motion-ok', motion);

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Local file previews need explicit index.html; servers (Netlify) don't.
  const suffix = location.protocol === 'file:' ? 'index.html' : '';
  const url = (p) => new URL(p, LAB.base).href;
  const homeHref = url(suffix || './');
  const isPhone =
    /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent) ||
    (window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 768);
  const projectHref = (p) =>
    p.href ? p.href : url(`${p.slug}/${p.mobile && isPhone ? 'mobile/' : ''}${suffix}`);

  /* ------------------------------------------------------------------------
     Markup
     ------------------------------------------------------------------------ */

  const mark = () => {
    const [a, b] = site.name.split('/').map((s) => s.trim());
    return b
      ? `${esc(a)}<span class="slash" aria-hidden="true">/</span><span class="visually-hidden"> / </span>${esc(b)}`
      : esc(a);
  };

  const header = () => `
    <a class="skip" href="#main">Skip to content</a>
    <div class="frame-lines" aria-hidden="true"></div>
    <header class="bar">
      <a class="bar__mark" href="${homeHref}" data-magnetic>${mark()}</a>
      <a class="bar__link" href="${esc(site.studioUrl)}" data-magnetic>${esc(site.studioLabel)}</a>
    </header>`;

  const footer = () => `
    <footer class="foot">
      <a href="${esc(site.studioUrl)}" data-magnetic>${esc(site.studio)}</a>
      <span class="num">© ${new Date().getFullYear()}</span>
    </footer>
    <div class="cursor" aria-hidden="true">
      <div class="cursor__ring"><i></i></div>
      <div class="cursor__dot"><i></i></div>
    </div>`;

  function home() {
    const rows = projects
      .map(
        (p, i) => `
        <li data-reveal style="--d:${180 + i * 90}">
          <a href="${esc(projectHref(p))}">
            <span class="toc__no num">${pad(i + 1)}</span>
            <span class="toc__title">${esc(p.title)}</span>
            <span class="toc__cat">${esc(p.category)}</span>
            <span class="toc__year num">${esc(p.year)}</span>
          </a>
        </li>`
      )
      .join('');
    return `
      ${header()}
      <main id="main" class="index">
        <h1 class="visually-hidden">${esc(site.name)}</h1>
        <nav class="toc" aria-label="Experiments"><ol>${rows}</ol></nav>
      </main>
      ${footer()}`;
  }

  function notFound() {
    return `
      ${header()}
      <main id="main" class="index nf">
        <div data-reveal>
          <h1>Nothing on this frame.</h1>
          <p>This address doesn’t match an experiment. <a class="u" href="${homeHref}">See all experiments</a>.</p>
        </div>
      </main>
      ${footer()}`;
  }

  // The page is render-blocked (rel=expect) until this script runs. Drop the
  // block before inserting content; nothing paints until this task ends.
  $$('link[rel="expect"]').forEach((l) => l.remove());

  const app = document.getElementById('app') || body;
  app.innerHTML = body.dataset.page === 'home' ? home() : notFound();

  /* ------------------------------------------------------------------------
     Entrance
     ------------------------------------------------------------------------ */

  function ready() {
    requestAnimationFrame(() => {
      root.classList.add('is-ready');
      $$('[data-reveal]').forEach((el) => el.classList.add('is-in'));
    });
  }
  const fontReady =
    document.fonts && document.fonts.load
      ? Promise.race([document.fonts.load('400 17px "Mona Sans"'), new Promise((r) => setTimeout(r, 1200))])
      : Promise.resolve();
  fontReady.then(ready, ready);

  /* ------------------------------------------------------------------------
     Cursor and magnetic links (fine pointer, motion allowed)
     ------------------------------------------------------------------------ */

  if (!motion || !fine) return;

  root.classList.add('has-cursor');
  const cursor = { el: $('.cursor'), ring: $('.cursor__ring'), dot: $('.cursor__dot'), rx: null, ry: null, state: '' };
  const pointer = { x: 0, y: 0, active: false, moved: false };
  const magnets = $$('[data-magnetic]').map((el) => ({ el, x: 0, y: 0 }));

  let raf = 0;
  let last = 0;
  const wake = () => {
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  function tick(now) {
    const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
    last = now;
    let busy = false;

    if (pointer.active) {
      if (cursor.rx === null) {
        cursor.rx = pointer.x;
        cursor.ry = pointer.y;
      }
      cursor.rx = damp(cursor.rx, pointer.x, 18, dt);
      cursor.ry = damp(cursor.ry, pointer.y, 18, dt);
      cursor.dot.style.transform = `translate3d(${pointer.x}px,${pointer.y}px,0)`;
      cursor.ring.style.transform = `translate3d(${cursor.rx}px,${cursor.ry}px,0)`;
      if (Math.abs(cursor.rx - pointer.x) + Math.abs(cursor.ry - pointer.y) > 0.3) busy = true;
    }

    for (const m of magnets) {
      const r = m.el.getBoundingClientRect();
      const dx = pointer.x - (r.left + r.width / 2 - m.x);
      const dy = pointer.y - (r.top + r.height / 2 - m.y);
      const near = pointer.active && Math.hypot(dx, dy) < Math.max(r.width, r.height) / 2 + 24;
      const tx = near ? clamp(dx * 0.3, -8, 8) : 0;
      const ty = near ? clamp(dy * 0.35, -6, 6) : 0;
      m.x = damp(m.x, tx, 10, dt);
      m.y = damp(m.y, ty, 10, dt);
      if (Math.abs(m.x - tx) + Math.abs(m.y - ty) > 0.05) busy = true;
      m.el.style.translate = `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px`;
    }

    if (busy || pointer.moved) {
      pointer.moved = false;
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
    }
  }

  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      pointer.moved = true;
      cursor.el.classList.add('is-visible');
      wake();
    },
    { passive: true }
  );
  document.addEventListener('pointerover', (e) => {
    const state = e.target.closest('a, button') ? 'link' : '';
    if (state !== cursor.state) cursor.el.dataset.state = cursor.state = state;
  });
  root.addEventListener('pointerleave', () => {
    pointer.active = false;
    cursor.el.classList.remove('is-visible');
    wake();
  });
  window.addEventListener('blur', () => {
    pointer.active = false;
    wake();
  });
  window.addEventListener('pointerdown', () => cursor.el.classList.add('is-down'));
  window.addEventListener('pointerup', () => cursor.el.classList.remove('is-down'));
  // Coming back with the browser's back button restores the page from cache.
  window.addEventListener('pageshow', (e) => e.persisted && wake());
})();
