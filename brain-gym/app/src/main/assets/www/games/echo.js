/* Echo — repeat the growing sequence of lights and tones (Simon-style). */
(function () {
  'use strict';

  const PADS = [
    { c: '#ff4d6d', f: 330 }, { c: '#3d8bff', f: 392 }, { c: '#2fd27a', f: 440 }, { c: '#ffd23d', f: 494 },
    { c: '#b06bff', f: 523 }, { c: '#ff8a2b', f: 587 }, { c: '#25d6d6', f: 659 }, { c: '#ff6bd5', f: 698 }, { c: '#c4e04a', f: 784 },
  ];

  function cfg(l) {
    return {
      pads: l <= 8 ? 4 : l <= 18 ? 6 : 9,
      length: 3 + Math.round((l - 1) * 0.35),
      speed: Math.max(300, 700 - l * 13),   // ms per step
      reverse: l >= 21 && l % 2 === 0,      // repeat it backwards
    };
  }

  const css = `
  .ec-board { display:grid; gap:12px; touch-action: manipulation; }
  .ec-pad { border-radius: 22px; opacity: .38; transition: opacity .12s, transform .12s, box-shadow .12s; box-shadow: inset 0 -6px 0 #0003; }
  .ec-pad.lit { opacity: 1; transform: scale(1.04); box-shadow: 0 0 34px -2px var(--pc), inset 0 -6px 0 #0002; }
  .ec-pad:active { transform: scale(.95); }
  .ec-msg { margin-top: 20px; font-weight: 800; height: 26px; color: var(--muted); text-align:center; }
  .ec-prog { display:flex; gap:5px; margin-bottom: 18px; flex-wrap: wrap; justify-content:center; max-width: 360px; }
  .ec-prog i { width: 12px; height: 12px; border-radius: 50%; background: #fff2; transition: background .2s; }
  .ec-prog i.on { background: var(--c); }
  `;
  let styled = false;

  BG.register({
    id: 'echo', name: 'Echo', icon: '🎵', color: '#2fd27a', badge: 'MEMORY',
    tagline: 'Watch, listen and repeat the growing pattern.',
    description: 'Sequence memory with light and sound. Each round adds one more step. More pads, faster playback and backwards rounds keep you on your toes.',
    rules: ['Watch the pads light up.', 'Repeat the sequence by tapping the pads.', 'Each round adds one step. Reach the target length to win.', 'You may slip <b>twice</b> — the round replays.'],
    levels: 30,
    tier(l) { const c = cfg(l); return c.pads + ' pads'; },
    levelInfo(l) { const c = cfg(l); return `${c.pads} pads · reach ${c.length} steps${c.reverse ? ' · BACKWARDS ⟲' : ''}`; },

    create(ctx) {
      if (!styled) { document.head.appendChild(ctx.el(`<style>${css}</style>`)); styled = true; }
      const c = cfg(ctx.level);
      const cols = c.pads === 4 ? 2 : 3;
      let seq = [], pos = 0, accepting = false, lives = 3;

      const prog = ctx.el('<div class="ec-prog"></div>');
      for (let i = 0; i < c.length; i++) prog.appendChild(document.createElement('i'));
      const board = ctx.el(`<div class="ec-board" style="grid-template-columns:repeat(${cols},1fr)"></div>`);
      const pads = PADS.slice(0, c.pads).map((p, i) => {
        const b = ctx.el(`<button class="ec-pad" style="background:${p.c};--pc:${p.c}"></button>`);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); tap(i); });
        board.appendChild(b);
        return b;
      });
      const msg = ctx.el('<div class="ec-msg"></div>');
      ctx.stage.append(prog, board, msg);
      const W = Math.min(ctx.stage.clientWidth - 32, ctx.stage.clientHeight - 140, 440);
      const rows = Math.ceil(c.pads / cols);
      board.style.width = W + 'px'; board.style.height = (W * rows / cols) + 'px';

      function hud() { ctx.hud.innerHTML = ctx.hearts(lives, 3); }
      function light(i, ms) {
        pads[i].classList.add('lit'); BG.Sound.note(PADS[i].f, ms / 1000);
        ctx.after(ms * 0.8, () => pads[i].classList.remove('lit'));
      }
      function playback() {
        accepting = false; pos = 0;
        msg.textContent = 'Watch…';
        [...prog.children].forEach((d, k) => d.classList.toggle('on', k < seq.length - 1));
        seq.forEach((p, k) => ctx.after(600 + k * c.speed, () => light(p, c.speed * 0.85)));
        ctx.after(600 + seq.length * c.speed, () => {
          accepting = true;
          msg.textContent = c.reverse ? 'Your turn — backwards! ⟲' : 'Your turn!';
        });
      }
      function grow() { seq.push(Math.floor(ctx.rng() * c.pads)); playback(); }
      function tap(i) {
        if (!accepting) return;
        light(i, 260);
        const want = c.reverse ? seq[seq.length - 1 - pos] : seq[pos];
        if (i === want) {
          pos++;
          if (pos === seq.length) {
            accepting = false;
            prog.children[seq.length - 1].classList.add('on');
            if (seq.length >= c.length) { ctx.win(lives, `You echoed ${c.length} steps${c.reverse ? ' backwards' : ''}!`); return; }
            msg.textContent = '✓ Nice!';
            ctx.after(650, grow);
          }
        } else {
          accepting = false; lives--; hud();
          BG.Sound.bad(); ctx.vibrate(90); ctx.shake(board);
          if (lives <= 0) { msg.textContent = ''; ctx.lose(`You reached ${seq.length - 1} of ${c.length} steps.`); return; }
          msg.textContent = 'Oops — watch again';
          ctx.after(900, playback);
        }
      }
      hud();
      return { start: grow };
    },
  });
})();
