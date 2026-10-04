/* Quick Math — mental arithmetic against the clock. */
(function () {
  'use strict';

  function cfg(l) {
    const qs = l <= 10 ? 10 : l <= 20 ? 12 : 15;
    const per = l <= 10 ? 5.5 : l <= 20 ? 6 : 6.5;
    return { qs, time: qs * per };
  }

  function makeQ(l, rng) {
    const R = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const ops = l <= 3 ? ['+'] : l <= 6 ? ['+', '-'] : l <= 10 ? ['+', '-', '×'] : l <= 15 ? ['+', '-', '×', '÷']
      : l <= 22 ? ['+', '-', '×', '÷', 'mix'] : ['+', '-', '×', '÷', 'mix', 'missing', 'sq'];
    const op = pick(ops);
    const max = 5 + l * 4;
    const mul = Math.min(12, 3 + Math.floor(l / 2));
    let text, ans;
    switch (op) {
      case '+': { const a = R(1, max), b = R(1, max); text = `${a} + ${b}`; ans = a + b; break; }
      case '-': { const a = R(3, max + 5), b = R(1, a - 1); text = `${a} − ${b}`; ans = a - b; break; }
      case '×': {
        if (l >= 24 && rng() < 0.4) { const a = R(11, 25), b = R(3, 9); text = `${a} × ${b}`; ans = a * b; }
        else { const a = R(2, mul), b = R(2, mul); text = `${a} × ${b}`; ans = a * b; }
        break;
      }
      case '÷': { const b = R(2, mul), q = R(2, mul); text = `${b * q} ÷ ${b}`; ans = q; break; }
      case 'mix': {
        const a = R(1, 20), b = R(2, 9), c = R(2, 9);
        const f = R(0, 2);
        if (f === 0) { text = `${a} + ${b} × ${c}`; ans = a + b * c; }
        else if (f === 1) { text = `(${a} + ${b}) × ${c}`; ans = (a + b) * c; }
        else { const big = b * c + R(1, 30); text = `${big} − ${b} × ${c}`; ans = big - b * c; }
        break;
      }
      case 'missing': {
        if (rng() < 0.5) { const a = R(2, 12), b = R(2, 12); text = `? × ${b} = ${a * b}`; ans = a; }
        else { const a = R(10, 99), b = R(10, 99); text = `${a} + ? = ${a + b}`; ans = b; }
        break;
      }
      case 'sq': {
        if (rng() < 0.6) { const a = R(4, 16); text = `${a}²`; ans = a * a; }
        else { const a = R(4, 15); text = `√${a * a}`; ans = a; }
        break;
      }
    }
    return { text, ans };
  }

  const css = `
  .qm-q { font-size: clamp(34px, 11vw, 56px); font-weight:900; margin: 6px 0 10px; letter-spacing:1px; text-align:center; min-height:1.2em; }
  .qm-a { font-size: 40px; font-weight:800; min-width: 160px; height: 64px; border-radius: 16px; background:#0004; display:grid; place-items:center;
    margin-bottom: 18px; transition: background .2s, transform .2s; color:#fff; }
  .qm-a.ok { background: #3ddc9755; } .qm-a.no { background: #ff5d7355; }
  .qm-pad { display:grid; grid-template-columns: repeat(3, 1fr); gap: 10px; width:100%; max-width: 360px; touch-action: manipulation; }
  .qm-pad button { height: 62px; border-radius: 16px; background: var(--card2); font-size: 26px; font-weight: 800; transition: transform .08s, background .15s; }
  .qm-pad button:active { transform: scale(.92); background: var(--c); }
  .qm-pad button.fn { background: var(--card); font-size: 20px; }
  .qm-top { width:100%; max-width:420px; margin-bottom: 18px; }
  .qm-count { text-align:center; color: var(--muted); font-weight: 700; margin-top: 6px; font-size: 13px; }
  `;
  let styled = false;

  BG.register({
    id: 'math', name: 'Quick Math', icon: '➗', color: '#ffb02e', badge: 'SPEED',
    tagline: 'Race the clock with mental arithmetic.',
    description: 'Boosts processing speed and numeric fluency. Starts with simple sums and builds up to multiplication, division, order of operations, missing numbers and squares.',
    rules: ['Solve each problem with the keypad.', 'The answer submits itself once you type enough digits.', 'Finish before time runs out. <b>3 mistakes</b> and you\'re out.'],
    levels: 30,
    tier(l) { return l <= 3 ? 'Addition' : l <= 6 ? '+ Subtraction' : l <= 10 ? '+ Multiplication' : l <= 15 ? '+ Division' : l <= 22 ? '+ Order of operations' : 'Master'; },
    levelInfo(l) { const c = cfg(l); return `${c.qs} problems in ${Math.round(c.time)} seconds`; },

    create(ctx) {
      if (!styled) { document.head.appendChild(ctx.el(`<style>${css}</style>`)); styled = true; }
      const { qs, time } = cfg(ctx.level);
      let idx = 0, errors = 0, input = '', q = null, t0 = 0, running = false;

      const top = ctx.el('<div class="qm-top"><div class="timebar"><i></i></div><div class="qm-count"></div></div>');
      const qEl = ctx.el('<div class="qm-q">?</div>');
      const aEl = ctx.el('<div class="qm-a">&nbsp;</div>');
      const pad = ctx.el('<div class="qm-pad"></div>');
      ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '⌫'].forEach((k) => {
        const b = ctx.el(`<button class="${/\d/.test(k) ? '' : 'fn'}">${k}</button>`);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); key(k); });
        pad.appendChild(b);
      });
      ctx.stage.append(top, qEl, aEl, pad);
      const bar = top.querySelector('i'), barWrap = top.querySelector('.timebar'), count = top.querySelector('.qm-count');

      function hud() { ctx.hud.innerHTML = ctx.hearts(3 - errors, 3); count.textContent = `${Math.min(idx + 1, qs)} / ${qs}`; }
      function next() {
        if (idx >= qs) {
          running = false;
          const left = 1 - (Date.now() - t0) / 1000 / time;
          const stars = errors === 0 && left >= 0.35 ? 3 : errors <= 1 && left >= 0.15 ? 2 : 1;
          ctx.win(stars, `${qs} solved with ${errors} mistake${errors === 1 ? '' : 's'} and ${Math.round(left * time)}s to spare.`);
          return;
        }
        q = makeQ(ctx.level, ctx.rng); input = '';
        qEl.textContent = q.text; aEl.innerHTML = '&nbsp;'; aEl.className = 'qm-a';
        hud();
      }
      function key(k) {
        if (!running) return;
        BG.Sound.tap();
        if (k === 'C') input = '';
        else if (k === '⌫') input = input.slice(0, -1);
        else if (input.length < 5) input += k;
        aEl.textContent = input || ' ';
        const want = String(q.ans);
        if (input.length >= want.length) {
          if (input === want) {
            aEl.className = 'qm-a ok'; BG.Sound.good(); idx++;
            running = false; ctx.after(220, () => { running = true; next(); });
          } else {
            aEl.className = 'qm-a no'; errors++; BG.Sound.bad(); ctx.vibrate(60); ctx.shake(aEl);
            hud();
            if (errors >= 3) { running = false; qEl.textContent = `${q.text} = ${q.ans}`; ctx.lose(`Three mistakes. The last answer was ${q.ans}.`); return; }
            running = false;
            ctx.after(450, () => { running = true; input = ''; aEl.innerHTML = '&nbsp;'; aEl.className = 'qm-a'; });
          }
        }
      }
      hud();
      return {
        start() {
          t0 = Date.now(); running = true; next();
          ctx.frame(() => {
            const left = Math.max(0, 1 - (Date.now() - t0) / 1000 / time);
            bar.style.transform = `scaleX(${left})`;
            barWrap.classList.toggle('low', left < 0.2);
            if (left <= 0 && idx < qs) { running = false; ctx.lose(`Time's up! You solved ${idx} of ${qs}.`); return false; }
            return idx < qs;
          });
        },
      };
    },
  });
})();
