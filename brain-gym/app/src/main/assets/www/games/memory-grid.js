/* Memory Grid — memorise the lit tiles, then tap them back. */
(function () {
  'use strict';

  function cfg(l) {
    const g = l <= 8 ? 3 : l <= 16 ? 4 : l <= 24 ? 5 : 6;
    const count = 3 + Math.floor((l - 1) * 0.45);
    return { g, count, showMs: 900 + count * 140, rounds: 3 };
  }

  const css = `
  .mg-board { display:grid; gap:8px; touch-action:manipulation; }
  .mg-tile { border-radius:12px; background:var(--card2); perspective:400px; transition: transform .15s; position:relative; }
  .mg-tile:active { transform: scale(.94); }
  .mg-tile i { position:absolute; inset:0; border-radius:12px; background:linear-gradient(135deg,#5ee7ff,#3a8bff);
    transform: rotateY(90deg); transition: transform .25s ease, opacity .25s; opacity:0; box-shadow:0 0 20px -4px #4cc4ff; }
  .mg-tile.on i { transform:none; opacity:1; }
  .mg-tile.miss i { background:linear-gradient(135deg,#ff8a9b,#ff3d5d); transform:none; opacity:1; box-shadow:0 0 20px -4px #ff5d73; }
  .mg-tile.hintshow i { transform:none; opacity:.45; }
  .mg-msg { margin-top:18px; font-weight:700; color:var(--muted); height:24px; text-align:center; }
  `;
  let styled = false;

  BG.register({
    id: 'memory', name: 'Memory Grid', icon: '🧩', color: '#3fa9ff', badge: 'MEMORY',
    tagline: 'Flash! Remember which tiles lit up.',
    description: 'Trains working memory. A pattern of tiles flashes for a moment — reproduce it from memory. Grids get bigger and patterns longer as you climb.',
    rules: ['Watch the tiles that light up.', 'When they turn off, <b>tap all of them</b> in any order.', 'Complete <b>3 rounds</b>. A wrong tap costs a ❤️.'],
    levels: 30,
    tier(l) { const g = cfg(l).g; return g + '×' + g + ' grid'; },
    levelInfo(l) { const c = cfg(l); return `${c.g}×${c.g} grid · remember ${c.count} tiles`; },

    create(ctx) {
      if (!styled) { document.head.appendChild(ctx.el(`<style>${css}</style>`)); styled = true; }
      const { g, count, showMs, rounds } = cfg(ctx.level);
      let lives = 3, round = 0, target = new Set(), found = new Set(), accepting = false;

      const board = ctx.el(`<div class="mg-board" style="grid-template-columns:repeat(${g},1fr)"></div>`);
      const msg = ctx.el('<div class="mg-msg"></div>');
      const tiles = [];
      for (let i = 0; i < g * g; i++) {
        const t = ctx.el('<button class="mg-tile"><i></i></button>');
        t.addEventListener('pointerdown', () => tap(i));
        tiles.push(t); board.appendChild(t);
      }
      ctx.stage.append(board, msg);
      const size = Math.min(ctx.stage.clientWidth - 32, ctx.stage.clientHeight - 120, 480);
      board.style.width = board.style.height = size + 'px';

      function hud() { ctx.hud.innerHTML = `<span class="pill">Round ${Math.min(round + 1, rounds)}/${rounds}</span>${ctx.hearts(lives, 3)}`; }

      function newRound() {
        accepting = false; found = new Set();
        tiles.forEach((t) => (t.className = 'mg-tile'));
        target = new Set();
        while (target.size < count) target.add(Math.floor(ctx.rng() * g * g));
        msg.textContent = 'Watch…';
        hud();
        ctx.after(500, () => {
          target.forEach((i) => tiles[i].classList.add('on'));
          BG.Sound.note(523, 0.15);
          ctx.after(showMs, () => {
            tiles.forEach((t) => t.classList.remove('on'));
            accepting = true;
            msg.textContent = `Tap the ${count} tiles`;
          });
        });
      }

      function tap(i) {
        if (!accepting || !ctx.alive || found.has(i)) return;
        if (target.has(i)) {
          found.add(i);
          tiles[i].classList.add('on');
          BG.Sound.note(523 * Math.pow(2, found.size / 12), 0.12);
          if (found.size === target.size) {
            accepting = false; round++;
            ctx.toast('✓', '#3ddc97'); BG.Sound.good();
            if (round >= rounds) { ctx.win(lives, `Perfect memory on ${rounds} rounds with ${lives} ❤️ left.`); return; }
            msg.textContent = 'Great!';
            ctx.after(700, newRound);
          }
        } else {
          accepting = false; lives--;
          tiles[i].classList.add('miss');
          BG.Sound.bad(); ctx.vibrate(80); ctx.shake(board);
          target.forEach((k) => { if (!found.has(k)) tiles[k].classList.add('hintshow'); });
          hud();
          if (lives <= 0) { msg.textContent = ''; ctx.lose('Out of hearts. The pattern is shown faded.'); return; }
          msg.textContent = 'Oops! New pattern…';
          ctx.after(1300, newRound);
        }
      }
      hud();
      return { start: newRound };
    },
  });
})();
