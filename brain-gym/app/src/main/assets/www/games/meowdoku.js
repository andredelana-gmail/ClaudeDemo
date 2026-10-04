/* Meowdoku — place one cat in every row, column and coloured region.
   Cats need personal space: no two cats may touch, not even diagonally. */
(function () {
  'use strict';

  const COLORS = ['#ff9eb5', '#ffd27a', '#9be7a6', '#8fd3ff', '#c9a8ff', '#ffb38a', '#7fe0d4', '#f6a6ff', '#d5e68a', '#a8b8ff'];
  const cache = {};

  const TIERS = [[5, 1, 5], [6, 6, 15], [7, 16, 30], [8, 31, 45], [9, 46, 60]]; // size, first, last level
  function sizeFor(l) { return TIERS.find((t) => l <= t[2])[0]; }
  // Target logic difficulty (1 easy … 4 expert); eases back in on every size jump.
  function targetFor(l) {
    const [n, a, b] = TIERS.find((t) => l <= t[2]);
    const p = (l - a) / (b - a + 1);
    const lo = n <= 7 ? 1 : 2, hi = n <= 6 ? 3 : 4;
    return lo + Math.floor(p * (hi - lo + 1));
  }
  const DIFF = ['', 'Easy', 'Medium', 'Hard', 'Expert'];

  const css = `
  .meow-board { display:grid; touch-action:none; border-radius:14px; overflow:hidden; border:3px solid #120f26;
    box-shadow:0 18px 40px -16px #000c; background:#120f26; }
  .meow-cell { position:relative; display:grid; place-items:center; line-height:1; transition:filter .15s; }
  .meow-cell .x { color:#0007; font-weight:900; transform:scale(.55); }
  .meow-cell .x.auto { color:#0003; }
  .meow-cell .cat { animation: catIn .3s cubic-bezier(.2,1.6,.4,1); filter: drop-shadow(0 2px 2px #0004); }
  .meow-cell.bad .cat { animation: catBad .5s infinite alternate; }
  .meow-cell.bad::after { content:""; position:absolute; inset:2px; border-radius:6px; background:#ff2f4f55; }
  .meow-cell.flash::before { content:""; position:absolute; inset:0; background:#fff; opacity:0; animation: flash 1s 2; }
  .meow-board.won .cat { animation: catWin .6s ease-in-out infinite alternate; }
  @keyframes catIn { from { transform: scale(0) rotate(-30deg); } }
  @keyframes catBad { to { transform: rotate(12deg) scale(.9); } }
  @keyframes catWin { to { transform: translateY(-18%) scale(1.12); } }
  @keyframes flash { 50% { opacity:.7; } }
  .meow-info { color: var(--muted); font-size: 13px; margin-top: 12px; text-align:center; }
  `;
  let styled = false;

  BG.register({
    id: 'meowdoku',
    name: 'Meowdoku',
    icon: '🐱',
    winIcon: '😻',
    color: '#ff7eb3',
    badge: 'LOGIC',
    tagline: 'Cat logic puzzle: one cat per row, column & colour — no cuddling!',
    description: 'A purr-fect deduction puzzle. Every row, column and colour region gets exactly one cat, and cats never touch — not even diagonally. Every puzzle has exactly one solution.',
    rules: [
      'Place exactly <b>one 🐱 in every row, column and colour region</b>.',
      'Cats <b>can\'t touch</b> each other, not even diagonally.',
      'Tap a square once for ✕, twice for 🐱. <b>Drag</b> to mark many ✕ at once.',
    ],
    levels: 60,
    tier(l) { const n = sizeFor(l); return n + '×' + n + (n === 5 ? ' · Kitten' : n === 6 ? ' · Cat' : n === 7 ? ' · Tomcat' : n === 8 ? ' · Lion' : ' · Tiger'); },
    levelInfo(l) { const n = sizeFor(l); return `${n}×${n} board · ${DIFF[targetFor(l)]} · find ${n} cats`; },

    create(ctx) {
      if (!styled) { document.head.appendChild(ctx.el(`<style>${css}</style>`)); styled = true; }
      const n = sizeFor(ctx.level);
      const key = ctx.level;
      const puz = cache[key] || (cache[key] = MeowGen.generateRated(n, ctx.levelRng, targetFor(ctx.level), 30));
      const reg = puz.regions, sol = puz.solution;
      const state = new Array(n * n).fill(0); // 0 empty, 1 x, 2 cat
      const undo = [];
      let hints = 0, autoX = BG.Store.get('meow_autox', false), started = false, t0 = 0, done = false;

      // ---- layout ----
      const wrap = ctx.el('<div style="display:flex;flex-direction:column;align-items:center;width:100%"></div>');
      const board = ctx.el(`<div class="meow-board" style="grid-template-columns:repeat(${n},1fr)"></div>`);
      const cells = [];
      for (let i = 0; i < n * n; i++) {
        const r = (i / n) | 0, c = i % n;
        const thick = '3px solid #120f26', thin = '1px solid #0002';
        const cell = ctx.el('<div class="meow-cell"></div>');
        cell.style.background = COLORS[reg[i]];
        cell.style.borderRight = c < n - 1 ? (reg[i + 1] !== reg[i] ? thick : thin) : 'none';
        cell.style.borderBottom = r < n - 1 ? (reg[i + n] !== reg[i] ? thick : thin) : 'none';
        cell.dataset.i = i;
        cells.push(cell);
        board.appendChild(cell);
      }
      const tools = ctx.el(`<div class="toolbar">
        <button class="tool" data-t="undo">↶ Undo</button>
        <button class="tool" data-t="auto">✕ Auto</button>
        <button class="tool" data-t="hint">💡 Hint</button>
        <button class="tool" data-t="clear">🧹</button></div>`);
      const info = ctx.el('<div class="meow-info">Tap: ✕ → 🐱 → empty · drag to mark ✕</div>');
      wrap.append(board, tools, info);
      ctx.stage.appendChild(wrap);

      function fit() {
        const W = ctx.stage.clientWidth - 32, H = ctx.stage.clientHeight - 130;
        const size = Math.max(200, Math.min(W, H, 560));
        board.style.width = board.style.height = size + 'px';
        board.style.fontSize = Math.floor((size / n) * 0.6) + 'px';
      }
      fit();
      window.addEventListener('resize', fit);

      // ---- logic ----
      function attacked() { // cells blocked by any cat (for auto ✕)
        const a = new Array(n * n).fill(false);
        for (let i = 0; i < n * n; i++) {
          if (state[i] !== 2) continue;
          const r = (i / n) | 0, c = i % n;
          for (let j = 0; j < n * n; j++) {
            if (j === i) continue;
            const rr = (j / n) | 0, cc = j % n;
            if (rr === r || cc === c || reg[j] === reg[i] || (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1)) a[j] = true;
          }
        }
        return a;
      }
      function conflicts() {
        const bad = new Set();
        const cats = [];
        for (let i = 0; i < n * n; i++) if (state[i] === 2) cats.push(i);
        for (let a = 0; a < cats.length; a++) for (let b = a + 1; b < cats.length; b++) {
          const i = cats[a], j = cats[b];
          const r1 = (i / n) | 0, c1 = i % n, r2 = (j / n) | 0, c2 = j % n;
          if (r1 === r2 || c1 === c2 || reg[i] === reg[j] || (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1)) { bad.add(i); bad.add(j); }
        }
        return { bad, cats: cats.length };
      }
      let prevRender = new Array(n * n).fill(-1);
      function render() {
        const att = autoX ? attacked() : null;
        const { bad, cats } = conflicts();
        for (let i = 0; i < n * n; i++) {
          const s = state[i];
          const code = s === 2 ? 2 : s === 1 ? 1 : att && att[i] ? 3 : 0;
          if (prevRender[i] !== code) {
            cells[i].innerHTML = code === 2 ? '<span class="cat">🐱</span>' : code === 1 ? '<span class="x">✕</span>' : code === 3 ? '<span class="x auto">✕</span>' : '';
            prevRender[i] = code;
          }
          cells[i].classList.toggle('bad', bad.has(i));
        }
        tools.querySelector('[data-t=auto]').classList.toggle('on', autoX);
        tools.querySelector('[data-t=undo]').disabled = !undo.length;
        hudUpdate(cats);
        if (cats === n && bad.size === 0 && !done) finish();
      }
      function hudUpdate(cats) {
        const sec = started ? Math.floor((Date.now() - t0) / 1000) : 0;
        if (cats === undefined) cats = state.filter((s) => s === 2).length;
        ctx.hud.innerHTML = `<span class="pill">🐱 ${cats}/${n}</span><span class="pill">⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</span>`;
      }
      function finish() {
        done = true;
        board.classList.add('won');
        board.querySelectorAll('.cat').forEach((c, k) => { c.style.animationDelay = (k * 0.07) + 's'; });
        BG.Sound.meow();
        const sec = Math.floor((Date.now() - t0) / 1000);
        const stars = 3 - hints;
        ctx.after(900, () => ctx.win(stars, `Solved in ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` + (hints ? ` with ${hints} hint${hints > 1 ? 's' : ''}.` : ' — no hints! 🏆')));
      }
      function setCells(changes) { // [{i, v}]
        const batch = [];
        for (const { i, v } of changes) if (state[i] !== v) { batch.push({ i, prev: state[i] }); state[i] = v; }
        if (batch.length) undo.push(batch);
        render();
        return batch.length;
      }

      // ---- input: tap cycles, drag marks ✕ ----
      let down = null; // {start, moved, marked:Set}
      function cellAt(x, y) {
        const e = document.elementFromPoint(x, y);
        const c = e && e.closest && e.closest('.meow-cell');
        return c && board.contains(c) ? +c.dataset.i : -1;
      }
      board.addEventListener('pointerdown', (e) => {
        if (done || !started) return;
        const i = cellAt(e.clientX, e.clientY);
        if (i < 0) return;
        down = { start: i, moved: false, batch: [], dragVal: state[i] === 0 ? 1 : state[i] === 1 ? 0 : null };
        try { board.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      board.addEventListener('pointermove', (e) => {
        if (!down) return;
        const i = cellAt(e.clientX, e.clientY);
        if (i < 0) return;
        if (!down.moved && i !== down.start) {
          down.moved = true;
          if (down.dragVal !== null) applyDrag(down.start);
        }
        if (down.moved && down.dragVal !== null) applyDrag(i);
      });
      function applyDrag(i) {
        // dragging only toggles between empty and ✕ — never touches cats
        if (state[i] === 2 || state[i] === down.dragVal) return;
        down.batch.push({ i, prev: state[i] });
        state[i] = down.dragVal;
        BG.Sound.tap();
        render();
      }
      function endPointer() {
        if (!down) return;
        const d = down; down = null;
        if (d.moved) { if (d.batch.length) { undo.push(d.batch); render(); } return; }
        const i = d.start;
        const next = (state[i] + 1) % 3;
        if (next === 2) { BG.Sound.meow(); ctx.vibrate(12); } else BG.Sound.tap();
        setCells([{ i, v: next }]);
        if (next === 2 && cells[i].classList.contains('bad')) ctx.vibrate(60);
      }
      board.addEventListener('pointerup', endPointer);
      board.addEventListener('pointercancel', endPointer);

      tools.addEventListener('click', (e) => {
        const b = e.target.closest('.tool');
        if (!b || done || !started) return;
        const t = b.dataset.t;
        BG.Sound.tap();
        if (t === 'undo') {
          const batch = undo.pop();
          if (batch) for (let k = batch.length - 1; k >= 0; k--) state[batch[k].i] = batch[k].prev;
          render();
        } else if (t === 'auto') {
          autoX = !autoX; BG.Store.set('meow_autox', autoX); render();
        } else if (t === 'clear') {
          setCells(state.map((s, i) => ({ i, v: 0 })));
        } else if (t === 'hint') {
          hint();
        }
      });

      function flash(i) { cells[i].classList.remove('flash'); void cells[i].offsetWidth; cells[i].classList.add('flash'); }
      function hint() {
        hints++;
        // 1. remove a misplaced cat
        for (let i = 0; i < n * n; i++) {
          if (state[i] === 2 && sol[(i / n) | 0] !== i % n) { setCells([{ i, v: 0 }]); flash(i); ctx.toast('🙀 Wrong spot!', '#ffb3c1'); return; }
        }
        // 2. clear an ✕ that hides a cat
        for (let r = 0; r < n; r++) {
          const i = r * n + sol[r];
          if (state[i] === 1) { setCells([{ i, v: 0 }]); flash(i); ctx.toast('A cat hides here…', '#fff'); return; }
        }
        // 3. reveal a cat (prefer the smallest region – usually the logical start)
        const sizes = new Array(n).fill(0);
        reg.forEach((g) => sizes[g]++);
        let best = -1;
        for (let r = 0; r < n; r++) {
          const i = r * n + sol[r];
          if (state[i] !== 2 && (best < 0 || sizes[reg[i]] < sizes[reg[best]])) best = i;
        }
        if (best >= 0) { setCells([{ i: best, v: 2 }]); flash(best); BG.Sound.meow(); }
      }

      render();

      return {
        start() {
          started = true; t0 = Date.now();
          ctx.every(1000, () => { if (!done) hudUpdate(); });
          render();
        },
        destroy() { window.removeEventListener('resize', fit); },
      };
    },
  });
})();
