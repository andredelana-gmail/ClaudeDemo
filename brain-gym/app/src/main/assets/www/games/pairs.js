/* Pairs — classic card matching with move-based scoring. */
(function () {
  'use strict';

  const EMOJI = ['🍎', '🐶', '🚀', '🌵', '🎈', '🍩', '🦊', '⚽', '🎸', '🌙', '🐙', '🍉', '🦋', '🔥', '🍀', '👑', '🐢', '🎲', '🍄', '⭐', '🐝', '🧁', '🦄', '🌈'];

  function cfg(l) {
    const pairs = Math.min(15, 3 + Math.floor((l - 1) / 2));
    // similar-looking sets later on make it harder
    const peek = l <= 5 ? 1200 : 0; // show all cards briefly on the easiest levels
    return { pairs, peek, par: Math.round(pairs * 1.6) };
  }
  function cols(pairs) { const n = pairs * 2; return n <= 6 ? 3 : n <= 12 ? 4 : n <= 20 ? 5 : 6; }

  const css = `
  .pr-board { display:grid; gap:8px; touch-action: manipulation; }
  .pr-card { position:relative; perspective: 600px; }
  .pr-card .in { position:absolute; inset:0; transition: transform .35s cubic-bezier(.3,1.3,.5,1); transform-style: preserve-3d; }
  .pr-card.up .in { transform: rotateY(180deg); }
  .pr-card .f, .pr-card .b { position:absolute; inset:0; border-radius: 12px; backface-visibility:hidden; -webkit-backface-visibility:hidden; display:grid; place-items:center; }
  .pr-card .b { background: linear-gradient(135deg, var(--c), #6c5cff); box-shadow: inset 0 -4px 0 #0003; }
  .pr-card .b::after { content:"?"; font-weight:900; color:#fff6; font-size: .7em; }
  .pr-card .f { background: #f5f3ff; transform: rotateY(180deg); }
  .pr-card.matched .f { background: #c8f7de; animation: prm .4s; }
  @keyframes prm { 50% { transform: rotateY(180deg) scale(1.12); } }
  `;
  let styled = false;

  BG.register({
    id: 'pairs', name: 'Pairs', icon: '🃏', color: '#25c6d6', badge: 'MEMORY',
    tagline: 'Flip cards and match all the pairs.',
    description: 'A relaxing classic for visual-spatial memory. Decks grow from 3 to 15 pairs. Finish in few moves for top stars.',
    rules: ['Flip two cards per move.', 'Matching cards stay face-up.', 'Match everything in <b>as few moves</b> as possible.'],
    levels: 30,
    tier(l) { const p = cfg(l).pairs; return p <= 5 ? 'Small deck' : p <= 10 ? 'Medium deck' : 'Big deck'; },
    levelInfo(l) { const c = cfg(l); return `${c.pairs} pairs · par ${c.par} moves`; },

    create(ctx) {
      if (!styled) { document.head.appendChild(ctx.el(`<style>${css}</style>`)); styled = true; }
      const c = cfg(ctx.level);
      const nC = cols(c.pairs), nR = Math.ceil(c.pairs * 2 / nC);
      const pool = EMOJI.slice().sort(() => ctx.rng() - 0.5).slice(0, c.pairs);
      const deck = pool.concat(pool);
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(ctx.rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }

      let open = [], moves = 0, matched = 0, lock = true;
      const board = ctx.el(`<div class="pr-board" style="grid-template-columns:repeat(${nC},1fr)"></div>`);
      const W = ctx.stage.clientWidth - 32, H = ctx.stage.clientHeight - 30;
      const cell = Math.min(W / nC, H / nR * 0.78, 110);
      board.style.width = (cell * nC) + 'px';
      const cards = deck.map((e) => {
        const b = ctx.el(`<button class="pr-card" style="height:${cell / 0.78 - 8}px;font-size:${cell * 0.5}px"><div class="in"><div class="b"></div><div class="f">${e}</div></div></button>`);
        b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); flip(b, e); });
        board.appendChild(b);
        return b;
      });
      ctx.stage.appendChild(board);

      function hud() { ctx.hud.innerHTML = `<span class="pill">Moves ${moves}</span><span class="pill">par ${c.par}</span>`; }
      function flip(b, e) {
        if (lock || b.classList.contains('up')) return;
        b.classList.add('up'); BG.Sound.tap();
        open.push({ b, e });
        if (open.length < 2) return;
        moves++; hud();
        const [x, y] = open; open = [];
        if (x.e === y.e) {
          x.b.classList.add('matched'); y.b.classList.add('matched'); matched++;
          BG.Sound.good();
          if (matched === c.pairs) {
            const stars = moves <= c.par ? 3 : moves <= c.par * 1.4 ? 2 : 1;
            ctx.after(400, () => ctx.win(stars, `All ${c.pairs} pairs in ${moves} moves (par ${c.par}).`));
          }
        } else {
          lock = true;
          ctx.after(750, () => { x.b.classList.remove('up'); y.b.classList.remove('up'); lock = false; });
        }
      }
      hud();
      return {
        start() {
          if (c.peek) {
            cards.forEach((b) => b.classList.add('up'));
            ctx.after(c.peek, () => { cards.forEach((b) => b.classList.remove('up')); ctx.after(350, () => { lock = false; }); });
          } else lock = false;
        },
      };
    },
  });
})();
