/* Number Hunt — Schulte table: find the numbers in order as fast as you can. */
(function () {
  'use strict';

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function cfg(l) {
    const g = l <= 3 ? 3 : l <= 9 ? 4 : l <= 17 ? 5 : 6;
    let mode = 'asc';
    if (l >= 7 && l % 3 === 1) mode = 'desc';
    if (l >= 12 && l % 3 === 2) mode = 'alt';
    if (l >= 20 && l % 3 === 0) mode = 'shuffle';
    const per = { asc: 1.15, desc: 1.3, alt: 1.6, shuffle: 1.5 }[mode];
    return { g, mode, par: Math.round(g * g * per) };
  }

  function sequence(g, mode) {
    const n = g * g;
    if (mode === 'desc') return Array.from({ length: n }, (_, i) => String(n - i));
    if (mode === 'alt') { // 1 A 2 B 3 C ...
      const out = [];
      for (let i = 0; out.length < n; i++) { out.push(String(i + 1)); if (out.length < n) out.push(LETTERS[i]); }
      return out;
    }
    return Array.from({ length: n }, (_, i) => String(i + 1));
  }

  const css = `
  .nh-board { display:grid; gap:7px; touch-action: manipulation; }
  .nh-cell { border-radius: 12px; background: var(--card2); font-weight: 800; display:grid; place-items:center; transition: transform .1s, background .2s, opacity .3s; }
  .nh-cell:active { transform: scale(.92); }
  .nh-cell.done { background: transparent; color: #fff3; transform: scale(.85); }
  .nh-cell.wrong { background: var(--bad); }
  .nh-next { margin-bottom: 16px; font-size: 15px; color: var(--muted); font-weight:700; text-align:center; }
  .nh-next b { display:inline-block; min-width: 46px; font-size: 26px; color: #fff; background: var(--c); border-radius: 12px; padding: 2px 10px; margin-left: 8px; vertical-align: middle; }
  `;
  let styled = false;

  BG.register({
    id: 'schulte', name: 'Number Hunt', icon: '🔢', color: '#8b7bff', badge: 'VISUAL',
    tagline: 'Find 1, 2, 3… as fast as you can.',
    description: 'Schulte tables sharpen visual search, peripheral vision and focus. Bigger grids, countdowns, number–letter switching and shuffling boards come later.',
    rules: ['Tap the items in order as fast as you can.', 'The next target is shown at the top.', 'Wrong taps add <b>+2 s</b>. Beat the par time for ⭐⭐⭐.'],
    levels: 30,
    tier(l) { const g = cfg(l).g; return g + '×' + g + ' grid'; },
    levelInfo(l) {
      const c = cfg(l), n = c.g * c.g;
      const what = { asc: `1 → ${n}`, desc: `${n} → 1 (countdown)`, alt: '1 A 2 B 3 C … (switch!)', shuffle: `1 → ${n} · board shuffles!` }[c.mode];
      return `${what} · par ${c.par}s`;
    },

    create(ctx) {
      if (!styled) { document.head.appendChild(ctx.el(`<style>${css}</style>`)); styled = true; }
      const c = cfg(ctx.level);
      const seq = sequence(c.g, c.mode);
      let pos = 0, t0 = 0, penalty = 0, running = false;

      const nextEl = ctx.el('<div class="nh-next">Find <b>&nbsp;</b></div>');
      const board = ctx.el(`<div class="nh-board" style="grid-template-columns:repeat(${c.g},1fr)"></div>`);
      ctx.stage.append(nextEl, board);
      const size = Math.min(ctx.stage.clientWidth - 32, ctx.stage.clientHeight - 90, 500);
      board.style.width = board.style.height = size + 'px';
      board.style.fontSize = Math.floor(size / c.g * 0.38) + 'px';

      let items = seq.slice();
      const cells = [];
      function layout() {
        for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(ctx.rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
        board.innerHTML = ''; cells.length = 0;
        items.forEach((v) => {
          const b = ctx.el(`<button class="nh-cell">${v}</button>`);
          if (seq.indexOf(v) < pos) b.classList.add('done');
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); tap(v, b); });
          board.appendChild(b); cells.push(b);
        });
      }
      layout();

      function elapsed() { return (Date.now() - t0) / 1000 + penalty; }
      function hud() { ctx.hud.innerHTML = `<span class="pill">⏱ ${running ? elapsed().toFixed(1) : '0.0'}s</span><span class="pill">par ${c.par}s</span>`; }
      function tap(v, b) {
        if (!running || b.classList.contains('done')) return;
        if (v === seq[pos]) {
          b.classList.add('done'); BG.Sound.note(440 * Math.pow(2, (pos % 24) / 24), 0.08);
          pos++;
          if (pos >= seq.length) {
            running = false;
            const t = elapsed();
            const stars = t <= c.par ? 3 : t <= c.par * 1.6 ? 2 : 1;
            hud();
            ctx.win(stars, `Time ${t.toFixed(1)}s (par ${c.par}s).`);
            return;
          }
          nextEl.querySelector('b').textContent = seq[pos];
          if (c.mode === 'shuffle') layout();
        } else {
          penalty += 2; BG.Sound.bad(); ctx.vibrate(50); ctx.toast('+2s', '#ff8a9b');
          b.classList.add('wrong'); ctx.after(250, () => b.classList.remove('wrong'));
        }
      }
      hud();
      return {
        start() {
          t0 = Date.now(); running = true;
          nextEl.querySelector('b').textContent = seq[0];
          ctx.every(100, () => { if (running) hud(); });
          ctx.after(c.par * 4000, () => { if (running) { running = false; ctx.lose('Took too long — keep practising!'); } });
        },
      };
    },
  });
})();
