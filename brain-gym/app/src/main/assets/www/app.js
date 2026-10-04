/* Brain Gym — app shell: navigation, progress, sound, level flow. */
(function () {
  'use strict';

  // ---------------- storage ----------------
  const Store = {
    get(k, d) {
      try { const v = localStorage.getItem('bg_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem('bg_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const settings = Object.assign({ sound: true, vibrate: true }, Store.get('settings', {}));
  const saveSettings = () => Store.set('settings', settings);

  // ---------------- utils ----------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function today() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function onTap(node, fn) {
    node.addEventListener('click', fn);
  }

  // ---------------- sound ----------------
  let actx = null;
  function tone(freq, dur, type, vol, when) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime + (when || 0);
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(actx.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) { /* audio unavailable */ }
  }
  const Sound = {
    tap() { tone(660, 0.06, 'triangle', 0.08); },
    good() { tone(880, 0.09, 'sine', 0.14); tone(1320, 0.12, 'sine', 0.1, 0.06); },
    bad() { tone(180, 0.22, 'sawtooth', 0.08); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.15, i * 0.09)); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'triangle', 0.14, i * 0.14)); },
    note(f, d) { tone(f, d || 0.3, 'sine', 0.2); },
    meow() {
      if (!settings.sound) return;
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        const t0 = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(700, t0); o.frequency.linearRampToValueAtTime(1100, t0 + 0.08);
        o.frequency.linearRampToValueAtTime(600, t0 + 0.28);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + 0.35);
      } catch (e) { /* ignore */ }
    },
  };
  function vibrate(ms) {
    if (!settings.vibrate) return;
    try {
      if (window.AndroidBridge) window.AndroidBridge.vibrate(Array.isArray(ms) ? ms.reduce((a, b) => a + b, 0) : ms);
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* ignore */ }
  }

  // ---------------- progress ----------------
  const games = [];
  const byId = {};
  function prog(id) { return Store.get('prog_' + id, { stars: {} }); }
  function setStars(id, level, stars) {
    const p = prog(id);
    if ((p.stars[level] || 0) < stars) p.stars[level] = stars;
    Store.set('prog_' + id, p);
  }
  function unlocked(id) { // highest playable level
    const p = prog(id), g = byId[id];
    let l = 1;
    while (p.stars[l] && l < g.levels) l++;
    return l;
  }
  function starCount(id) { const p = prog(id); return Object.values(p.stars).reduce((a, b) => a + b, 0); }
  function doneCount(id) { return Object.keys(prog(id).stars).length; }
  function totalStars() { return games.reduce((a, g) => a + starCount(g.id), 0); }

  function markPlayedToday() {
    const s = Store.get('streak', { last: null, days: 0, best: 0 });
    const t = today();
    if (s.last === t) return;
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yest = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
    s.days = s.last === yest ? s.days + 1 : 1;
    s.best = Math.max(s.best, s.days);
    s.last = t;
    Store.set('streak', s);
  }
  function streak() {
    const s = Store.get('streak', { last: null, days: 0 });
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yest = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
    return s.last === today() || s.last === yest ? s.days : 0;
  }

  // ---------------- navigation ----------------
  const app = () => document.getElementById('app');
  let current = null;   // { el, kind, cleanup }
  let workout = null;   // { queue: [gameId], idx }

  function show(node, kind, cleanup) {
    if (current) {
      const old = current;
      if (old.cleanup) old.cleanup();
      old.el.classList.add('out');
      setTimeout(() => old.el.remove(), 200);
    }
    current = { el: node, kind, cleanup };
    app().appendChild(node);
  }

  function back() {
    if (!current) return false;
    const ov = current.el.querySelector('.overlay[data-dismiss]');
    if (ov) { ov.remove(); return true; }
    if (current.kind === 'play') {
      if (workout) { workout = null; home(); } else levels(current.gameId);
      return true;
    }
    if (current.kind === 'levels' || current.kind === 'settings') { home(); return true; }
    return false;
  }

  // ---------------- home ----------------
  function home() {
    workout = null;
    const s = streak();
    const daily = Store.get('daily', {});
    const dailyDone = daily.date === today() && daily.done;
    const node = el(`<div class="screen">
      <div class="scroll">
        <div class="topbar" style="padding:14px 0 0"><div style="flex:1"></div><button class="iconbtn" data-act="settings">⚙️</button></div>
        <div class="hero" style="padding:0 4px 4px"><h1 class="brand">Brain <span>Gym</span></h1><p>Daily workouts for a sharper mind</p></div>
        <div class="stats" style="padding:14px 0 0">
          <div class="stat"><b>⭐ ${totalStars()}</b><small>stars</small></div>
          <div class="stat"><b>🔥 ${s}</b><small>day streak</small></div>
          <div class="stat"><b>🏅 ${games.reduce((a, g) => a + doneCount(g.id), 0)}</b><small>levels</small></div>
        </div>
        <button class="daily" style="width:100%;text-align:left" data-act="daily">
          <div class="ico">${dailyDone ? '✅' : '🏋️'}</div>
          <div style="flex:1"><b>${dailyDone ? 'Workout complete!' : "Today's workout"}</b>
          <small>${dailyDone ? 'Come back tomorrow — or train again' : '3 games picked for you · ~5 min'}</small></div>
          <div style="font-size:22px">›</div>
        </button>
        <div class="section-title">Games</div>
        <div class="grid"></div>
      </div></div>`);
    const grid = node.querySelector('.grid');
    games.forEach((g, i) => {
      const done = doneCount(g.id), pct = Math.round((done / g.levels) * 100);
      const card = el(`<button class="gcard ${i === 0 ? 'featured' : ''}" style="--c:${g.color}">
        ${g.badge ? `<span class="badge">${esc(g.badge)}</span>` : ''}
        <div class="gi">${g.icon}</div><div class="gn">${esc(g.name)}</div><div class="gt">${esc(g.tagline)}</div>
        <div class="gp"><span>Lv ${unlocked(g.id)}</span><span>⭐ ${starCount(g.id)}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div></button>`);
      onTap(card, () => { Sound.tap(); levels(g.id); });
      grid.appendChild(card);
    });
    onTap(node.querySelector('[data-act=settings]'), () => { Sound.tap(); settingsScreen(); });
    onTap(node.querySelector('[data-act=daily]'), () => { Sound.tap(); startWorkout(); });
    show(node, 'home');
  }

  function startWorkout() {
    const rng = mulberry32(hashStr(today()) + (Store.get('daily', {}).date === today() ? Date.now() : 0));
    const ids = games.map((g) => g.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    workout = { queue: ids.slice(0, 3), idx: 0 };
    play(workout.queue[0], unlocked(workout.queue[0]));
  }

  // ---------------- settings ----------------
  function settingsScreen() {
    const node = el(`<div class="screen">
      <div class="topbar"><button class="iconbtn" data-act="back">‹</button><h1>Settings</h1></div>
      <div class="scroll"><div class="settings-list">
        <div class="setting" data-k="sound"><span>🔊 Sound effects</span><div class="switch"></div></div>
        <div class="setting" data-k="vibrate"><span>📳 Vibration</span><div class="switch"></div></div>
        <button class="setting danger" data-act="reset"><span>🗑️ Reset all progress</span><span>›</span></button>
      </div>
      <div class="about">Brain Gym · ${games.length} games · ${games.reduce((a, g) => a + g.levels, 0)} levels.<br>
      Everything works offline and your progress stays on this device.<br>Train a little every day to keep your streak alive. 🔥</div>
      </div></div>`);
    node.querySelectorAll('.setting[data-k]').forEach((row) => {
      const k = row.dataset.k, sw = row.querySelector('.switch');
      sw.classList.toggle('on', !!settings[k]);
      onTap(row, () => { settings[k] = !settings[k]; saveSettings(); sw.classList.toggle('on', settings[k]); Sound.tap(); vibrate(15); });
    });
    onTap(node.querySelector('[data-act=back]'), () => home());
    onTap(node.querySelector('[data-act=reset]'), () => {
      confirmBox(node, 'Reset progress?', 'All stars, levels and your streak will be erased.', 'Reset', () => {
        games.forEach((g) => Store.set('prog_' + g.id, { stars: {} }));
        Store.set('streak', { last: null, days: 0, best: 0 }); Store.set('daily', {});
        home();
      });
    });
    show(node, 'settings');
  }

  function confirmBox(parent, title, text, okLabel, onOk) {
    const ov = el(`<div class="overlay" data-dismiss><div class="modal"><div class="big">⚠️</div><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="row"><button class="btn alt" data-a="no">Cancel</button><button class="btn" style="background:var(--bad)" data-a="ok">${esc(okLabel)}</button></div></div></div>`);
    onTap(ov.querySelector('[data-a=no]'), () => ov.remove());
    onTap(ov.querySelector('[data-a=ok]'), () => { ov.remove(); onOk(); });
    parent.appendChild(ov);
  }

  // ---------------- level select ----------------
  function levels(id) {
    workout = null;
    const g = byId[id], p = prog(id), cur = unlocked(id);
    const node = el(`<div class="screen" style="--c:${g.color}">
      <div class="topbar"><button class="iconbtn" data-act="back">‹</button><h1>${esc(g.name)}</h1><span class="pill">⭐ ${starCount(id)}/${g.levels * 3}</span></div>
      <div class="scroll">
        <div class="game-head"><div class="gi">${g.icon}</div><p>${esc(g.description)}</p></div>
        <button class="btn c" data-act="play" style="margin:0 0 18px">▶ Play level ${cur}</button>
        <div class="levels"></div>
      </div></div>`);
    const wrap = node.querySelector('.levels');
    let lastTier = null;
    for (let l = 1; l <= g.levels; l++) {
      const tier = g.tier ? g.tier(l) : null;
      if (tier && tier !== lastTier) { wrap.appendChild(el(`<div class="tier">${esc(tier)}</div>`)); lastTier = tier; }
      const st = p.stars[l] || 0, locked = l > cur;
      const b = el(`<button class="lvl ${locked ? 'locked' : ''} ${l === cur && !st ? 'current' : ''}">
        ${locked ? '🔒' : l}<span class="st">${st ? '★'.repeat(st) + '<span style="color:#fff3">' + '★'.repeat(3 - st) + '</span>' : ''}</span></button>`);
      if (!locked) onTap(b, () => { Sound.tap(); play(id, l); });
      else onTap(b, () => { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); vibrate(20); });
      wrap.appendChild(b);
    }
    onTap(node.querySelector('[data-act=back]'), () => home());
    onTap(node.querySelector('[data-act=play]'), () => { Sound.tap(); play(id, cur); });
    show(node, 'levels');
    const curEl = wrap.querySelector('.current');
    if (curEl) setTimeout(() => curEl.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
  }

  // ---------------- play ----------------
  function play(id, level) {
    const g = byId[id];
    const timers = new Set();
    let alive = true, finished = false;
    const title = workout ? `Workout ${workout.idx + 1}/3 · ${g.name}` : `${g.name}`;
    const node = el(`<div class="screen" style="--c:${g.color}">
      <div class="topbar"><button class="iconbtn" data-act="back">‹</button><h1>${esc(title)}<div style="font-size:12px;color:var(--muted);font-weight:600">Level ${level}</div></h1><div class="hud"></div></div>
      <div class="stage"></div></div>`);
    const stage = node.querySelector('.stage'), hud = node.querySelector('.hud');
    let instance = null;

    const ctx = {
      level,
      rng: mulberry32(hashStr(id + ':' + level) ^ (Math.random() * 1e9)),
      levelRng: mulberry32(hashStr(id + ':' + level)), // deterministic per level
      stage, hud, Sound, vibrate, el, esc,
      get alive() { return alive && !finished; },
      after(ms, fn) { const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms); timers.add(t); return t; },
      every(ms, fn) { const t = setInterval(() => { if (alive) fn(); }, ms); timers.add(t); return t; },
      clear(t) { clearTimeout(t); clearInterval(t); timers.delete(t); },
      frame(fn) { // rAF loop until fn returns false
        const loop = (ts) => { if (!alive || finished) return; if (fn(ts) !== false) requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      },
      toast(text, color) {
        const t = el(`<div class="toast" style="color:${color || '#fff'}">${text}</div>`);
        stage.appendChild(t); setTimeout(() => t.remove(), 850);
      },
      shake(node) { node = node || stage; node.classList.remove('shake'); void node.offsetWidth; node.classList.add('shake'); },
      hearts(n, max) { return '<span class="hearts">' + '❤️'.repeat(Math.max(0, n)) + '<span style="opacity:.25">' + '🖤'.repeat(Math.max(0, max - n)) + '</span></span>'; },
      win(stars, msg) { if (finished) return; finished = true; stars = Math.max(1, Math.min(3, stars | 0)); setStars(id, level, stars); markPlayedToday(); Sound.win(); vibrate([30, 40, 30]); setTimeout(() => result(true, stars, msg), 450); },
      lose(msg) { if (finished) return; finished = true; markPlayedToday(); Sound.lose(); vibrate(200); setTimeout(() => result(false, 0, msg), 450); },
    };

    function cleanup() { alive = false; timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); timers.clear(); if (instance && instance.destroy) instance.destroy(); }

    function result(won, stars, msg) {
      if (!alive) return;
      const inWorkout = !!workout;
      const lastOfWorkout = inWorkout && workout.idx === workout.queue.length - 1;
      const hasNext = level < g.levels;
      let buttons;
      if (inWorkout) {
        buttons = `<button class="btn c" data-a="wnext">${lastOfWorkout ? 'Finish workout 🎉' : 'Next game ›'}</button>
          ${won ? '' : '<button class="btn alt" data-a="retry">Try again</button>'}`;
      } else if (won) {
        buttons = `${hasNext ? `<button class="btn c" data-a="next">Next level ›</button>` : ''}
          <div class="row"><button class="btn alt" data-a="retry">↻ Replay</button><button class="btn alt" data-a="levels">Levels</button></div>`;
      } else {
        buttons = `<button class="btn c" data-a="retry">↻ Try again</button><button class="btn alt" data-a="levels">Levels</button>`;
      }
      const praise = ['Nice!', 'Great job!', 'Brilliant!'][stars - 1] || 'So close!';
      const ov = el(`<div class="overlay"><div class="modal">
        <div class="big">${won ? (g.winIcon || '🧠') : '😵'}</div>
        <h2>${won ? praise : 'Not this time'}</h2>
        <div class="stars">${[1, 2, 3].map((i) => `<span class="${won && i <= stars ? 'on' : ''}" style="animation-delay:${i * 0.15}s">★</span>`).join('')}</div>
        <p>${msg ? esc(msg) : won ? 'Level ' + level + ' complete.' : 'Give it another go!'}</p>
        ${buttons}</div></div>`);
      const act = (a, fn) => { const b = ov.querySelector(`[data-a=${a}]`); if (b) onTap(b, () => { Sound.tap(); fn(); }); };
      act('next', () => play(id, level + 1));
      act('retry', () => play(id, level));
      act('levels', () => levels(id));
      act('wnext', () => {
        if (lastOfWorkout) { Store.set('daily', { date: today(), done: true }); workout = null; home(); }
        else { workout.idx++; const nid = workout.queue[workout.idx]; play(nid, unlocked(nid)); }
      });
      node.appendChild(ov);
    }

    function intro() {
      const info = g.levelInfo(level);
      const ov = el(`<div class="overlay"><div class="modal">
        <div class="big">${g.icon}</div><h2>${esc(g.name)} · ${level}</h2>
        <div class="rules"><ul>${g.rules.map((r) => `<li>${r}</li>`).join('')}</ul></div>
        <div class="goal">${esc(info)}</div>
        <button class="btn c" data-a="go">Start</button></div></div>`);
      onTap(ov.querySelector('[data-a=go]'), () => {
        Sound.tap(); ov.remove();
        if (instance && instance.start) instance.start();
      });
      node.appendChild(ov);
    }

    onTap(node.querySelector('[data-act=back]'), () => back());
    show(node, 'play', cleanup);
    current.gameId = id;
    instance = g.create(ctx);
    intro();
  }

  // ---------------- public ----------------
  window.BG = {
    Store, Sound, mulberry32,
    register(g) { games.push(g); byId[g.id] = g; },
    back() { return back(); },
    boot() {
      document.addEventListener('contextmenu', (e) => e.preventDefault());
      // unlock audio on first touch
      document.addEventListener('pointerdown', function once() {
        try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (e) { /* ignore */ }
        document.removeEventListener('pointerdown', once);
      });
      home();
    },
  };
})();
