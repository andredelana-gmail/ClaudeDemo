/* Color Clash — a Stroop test. Name the INK colour, not the word… unless told otherwise. */
(function () {
  'use strict';

  const ALL = [
    { name: 'RED', hex: '#ff4d5e' }, { name: 'BLUE', hex: '#3d8bff' }, { name: 'GREEN', hex: '#2fd27a' },
    { name: 'YELLOW', hex: '#ffd23d' }, { name: 'PURPLE', hex: '#b06bff' }, { name: 'ORANGE', hex: '#ff8a2b' },
  ];

  function cfg(l) {
    return {
      colors: l <= 10 ? 4 : l <= 20 ? 5 : 6,
      items: 16 + Math.floor(l / 5) * 2,
      ms: Math.max(1500, 3600 - l * 75),
      congruent: l <= 3 ? 0.5 : l <= 8 ? 0.25 : 0.1,
      switching: l >= 13,           // rule can switch between INK and WORD
      switchRate: l >= 22 ? 0.5 : 0.3,
    };
  }

  const css = `
  .cc-rule { font-weight:900; letter-spacing:3px; font-size:14px; padding:6px 14px; border-radius:999px; background:#fff1; margin: 14px 0 0; transition: background .2s; }
  .cc-rule.word { background:#fff; color:#14112b; }
  .cc-word { font-size: clamp(48px, 16vw, 84px); font-weight: 900; letter-spacing: 2px; margin: 26px 0 30px; min-height: 1.2em; text-align:center; }
  .cc-word.pop { animation: ccpop .2s ease-out; }
  @keyframes ccpop { from { transform: scale(.6); opacity:0; } }
  .cc-btns { display:grid; grid-template-columns: repeat(2,1fr); gap: 12px; width:100%; max-width: 380px; touch-action: manipulation; }
  .cc-btns.six { grid-template-columns: repeat(3,1fr); }
  .cc-btns button { height: 70px; border-radius: 18px; font-weight: 900; font-size: 13px; color:#14112bcc; transition: transform .08s; box-shadow: inset 0 -5px 0 #0003; }
  .cc-btns button:active { transform: scale(.92); }
  .cc-top { width:100%; max-width: 420px; }
  .cc-count { text-align:center; color: var(--muted); font-weight: 700; margin-top: 6px; font-size: 13px; }
  `;
  let styled = false;

  BG.register({
    id: 'stroop', name: 'Color Clash', icon: '🎨', color: '#ff5d8f', badge: 'FOCUS',
    tagline: 'Tap the INK colour — ignore what the word says.',
    description: 'The classic Stroop challenge trains attention and impulse control. Later levels add more colours, faster pace and rule switching between INK and WORD.',
    rules: ['A colour word appears painted in some colour.', 'When the rule says <b>INK</b>, tap the colour of the letters.', 'When it says <b>WORD</b>, tap the colour the word names.', 'Be quick! Slow or wrong answers cost a ❤️.'],
    levels: 30,
    tier(l) { return l <= 12 ? 'Ink only' : l <= 21 ? 'Rule switching' : 'Rapid switching'; },
    levelInfo(l) { const c = cfg(l); return `${c.items} words · ${(c.ms / 1000).toFixed(1)}s each${c.switching ? ' · rules switch!' : ''}`; },

    create(ctx) {
      if (!styled) { document.head.appendChild(ctx.el(`<style>${css}</style>`)); styled = true; }
      const c = cfg(ctx.level);
      const cols = ALL.slice(0, c.colors);
      let lives = 3, idx = 0, item = null, t0 = 0, accepting = false, rule = 'ink';

      const top = ctx.el('<div class="cc-top"><div class="timebar"><i></i></div><div class="cc-count"></div></div>');
      const ruleEl = ctx.el('<div class="cc-rule">INK</div>');
      const word = ctx.el('<div class="cc-word">&nbsp;</div>');
      const btns = ctx.el(`<div class="cc-btns ${c.colors > 4 ? 'six' : ''}"></div>`);
      // shuffle button order per game so position isn't a cue
      const order = cols.slice().sort(() => ctx.rng() - 0.5);
      order.forEach((col) => {
        const b = ctx.el(`<button style="background:${col.hex}">${col.name}</button>`);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); answer(col.name); });
        btns.appendChild(b);
      });
      ctx.stage.append(top, ruleEl, word, btns);
      const bar = top.querySelector('i'), barWrap = top.querySelector('.timebar'), count = top.querySelector('.cc-count');

      function hud() { ctx.hud.innerHTML = ctx.hearts(lives, 3); count.textContent = `${Math.min(idx + 1, c.items)} / ${c.items}`; }

      function next() {
        if (idx >= c.items) { ctx.win(lives, `${c.items} words with ${lives} ❤️ left.`); return; }
        const w = cols[Math.floor(ctx.rng() * cols.length)];
        let ink = w;
        if (ctx.rng() >= c.congruent) { do { ink = cols[Math.floor(ctx.rng() * cols.length)]; } while (ink === w); }
        if (c.switching && idx > 0 && ctx.rng() < c.switchRate) rule = rule === 'ink' ? 'word' : 'ink';
        item = { w, ink };
        ruleEl.textContent = rule === 'ink' ? 'INK' : 'WORD';
        ruleEl.classList.toggle('word', rule === 'word');
        word.textContent = w.name; word.style.color = ink.hex;
        word.classList.remove('pop'); void word.offsetWidth; word.classList.add('pop');
        hud();
        t0 = Date.now(); accepting = true;
      }

      function answer(name) {
        if (!accepting) return;
        accepting = false;
        const want = rule === 'ink' ? item.ink.name : item.w.name;
        if (name === want) { BG.Sound.good(); idx++; ctx.after(160, next); }
        else miss(name ? 'Wrong colour' : 'Too slow');
      }

      function miss(why) {
        lives--; BG.Sound.bad(); ctx.vibrate(80); ctx.shake(word); ctx.toast(why, '#ff8a9b');
        hud();
        if (lives <= 0) { ctx.lose(`Out of hearts after ${idx} correct.`); return; }
        idx++;
        ctx.after(650, next);
      }

      hud();
      return {
        start() {
          next();
          ctx.frame(() => {
            if (accepting) {
              const left = Math.max(0, 1 - (Date.now() - t0) / c.ms);
              bar.style.transform = `scaleX(${left})`;
              barWrap.classList.toggle('low', left < 0.3);
              if (left <= 0) { accepting = false; miss('Too slow'); }
            }
            return lives > 0 && idx <= c.items;
          });
        },
      };
    },
  });
})();
