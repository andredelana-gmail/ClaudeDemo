/* ============================================================================
 * ui.js — Canvas rendering, interaction, config panels, dashboard, controls.
 * ----------------------------------------------------------------------------
 * Depends on engine.js (global `ProdSim`). No frameworks, no build step.
 *
 * ARCHITECTURE
 *   - model         : the serializable data model (ProdSim.newModel / presets)
 *   - engine        : ProdSim.Engine wrapping the model (runtime state)
 *   - view          : { panX, panY, zoom } world<->screen transform
 *   - interaction   : mouse handling for pan/zoom/drag/connect/quick-add
 *   - render loop    : requestAnimationFrame draws canvas + steps the engine
 *
 * EDIT-WHILE-RUNNING POLICY (chosen):
 *   Structural edits (adding/deleting a node or arrow) AUTO-PAUSE the run so
 *   the model and runtime never disagree mid-tick. Parameter edits (process
 *   time, machines, rates, ...) apply LIVE on the next tick without pausing.
 * ==========================================================================*/
(function () {
  'use strict';

  const NODE_W = 150, NODE_H = 78;   // node box size in world units
  const TYPE_COLORS = {
    source: '#6366f1', process: '#0ea5e9', buffer: '#f59e0b', sink: '#10b981',
  };
  const STATE_COLORS = {
    running: '#22c55e', starved: '#eab308', blocked: '#ef4444',
    down: '#a855f7', idle: '#94a3b8', bottleneck: '#ef4444',
  };

  /* ---- Application state ------------------------------------------------ */
  let model, engine;
  let view = { panX: 0, panY: 0, zoom: 1 };
  let selected = null;               // {kind:'node'|'arrow', id}
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  let hoverNode = null;              // node id currently hovered
  let hoverHandle = null;            // {nodeId, dir} quick-add/connect handle
  const anim = [];                   // moving dots {arrowId, token} — derived each frame

  /* ---- Coordinate transforms ------------------------------------------ */
  function w2s(x, y) { return { x: x * view.zoom + view.panX, y: y * view.zoom + view.panY }; }
  function s2w(x, y) { return { x: (x - view.panX) / view.zoom, y: (y - view.panY) / view.zoom }; }

  /* ---- Canvas sizing (DPR-aware) -------------------------------------- */
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cssSize = { w: r.width, h: r.height };
  }
  let cssSize = { w: 800, h: 600 };

  /* ======================================================================
   * Rendering
   * ==================================================================== */
  function draw() {
    ctx.clearRect(0, 0, cssSize.w, cssSize.h);
    drawGrid();
    model.arrows.forEach(drawArrow);
    model.nodes.forEach(drawNode);
    if (hoverNode && !dragState) drawHandles(hoverNode);
    if (connectDrag) drawConnectPreview();
    if (!model.nodes.length) drawCenterAdd();
  }

  function drawGrid() {
    const step = 40 * view.zoom;
    if (step < 6) return;
    const ox = view.panX % step, oy = view.panY % step;
    ctx.save();
    ctx.strokeStyle = getCss('--grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < cssSize.w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, cssSize.h); }
    for (let y = oy; y < cssSize.h; y += step) { ctx.moveTo(0, y); ctx.lineTo(cssSize.w, y); }
    ctx.stroke();
    ctx.restore();
  }

  function nodeCenter(n) { return { x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 }; }

  // Clip a line from box-center to a point at the box's edge.
  function edgePoint(n, tx, ty) {
    const c = nodeCenter(n);
    const dx = tx - c.x, dy = ty - c.y;
    if (dx === 0 && dy === 0) return c;
    const hw = NODE_W / 2, hh = NODE_H / 2;
    const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: c.x + dx * s, y: c.y + dy * s };
  }

  function drawArrow(a) {
    const from = engine.node(a.from), to = engine.node(a.to);
    if (!from || !to) return;
    const fc = nodeCenter(from), tc = nodeCenter(to);
    const p1 = edgePoint(from, tc.x, tc.y);
    const p2 = edgePoint(to, fc.x, fc.y);
    const s1 = w2s(p1.x, p1.y), s2 = w2s(p2.x, p2.y);
    const isSel = selected && selected.kind === 'arrow' && selected.id === a.id;

    ctx.save();
    ctx.strokeStyle = isSel ? '#f43f5e' : getCss('--arrow');
    ctx.lineWidth = isSel ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();

    // arrowhead
    const ang = Math.atan2(s2.y - s1.y, s2.x - s1.x);
    const ah = 10;
    ctx.beginPath();
    ctx.moveTo(s2.x, s2.y);
    ctx.lineTo(s2.x - ah * Math.cos(ang - 0.4), s2.y - ah * Math.sin(ang - 0.4));
    ctx.lineTo(s2.x - ah * Math.cos(ang + 0.4), s2.y - ah * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fillStyle = isSel ? '#f43f5e' : getCss('--arrow');
    ctx.fill();

    // moving units (dots) along the arrow, positioned by transit progress
    const art = engine.art[a.id];
    if (art && art.transit.length) {
      const tt = Math.max(1e-6, ProdSim.arrowTime(a));
      ctx.fillStyle = '#38bdf8';
      art.transit.forEach((p) => {
        const prog = 1 - Math.max(0, Math.min(1, p.remaining / tt));
        const x = s1.x + (s2.x - s1.x) * prog;
        const y = s1.y + (s2.y - s1.y) * prog;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // transit count label at midpoint
    if (art && art.transit.length) {
      const mx = (s1.x + s2.x) / 2, my = (s1.y + s2.y) / 2;
      ctx.fillStyle = getCss('--muted');
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(art.transit.length), mx, my - 6);
    }
    ctx.restore();
  }

  function drawNode(n) {
    const s = w2s(n.x, n.y);
    const w = NODE_W * view.zoom, h = NODE_H * view.zoom;
    const state = engine.nodeState(n.id);
    const isBottleneck = engine.bottleneckId() === n.id;
    const isSel = selected && selected.kind === 'node' && selected.id === n.id;
    const border = isBottleneck ? STATE_COLORS.bottleneck : STATE_COLORS[state] || STATE_COLORS.idle;

    ctx.save();
    // body
    roundRect(s.x, s.y, w, h, 8 * view.zoom);
    ctx.fillStyle = getCss('--node-bg');
    ctx.fill();
    ctx.lineWidth = (isSel ? 4 : 3) * Math.max(0.6, view.zoom);
    ctx.strokeStyle = border;
    ctx.stroke();

    // type accent bar (left)
    ctx.fillStyle = TYPE_COLORS[n.type];
    roundRect(s.x, s.y, 6 * view.zoom, h, 3 * view.zoom);
    ctx.fill();

    if (view.zoom > 0.35) {
      const pad = 10 * view.zoom;
      // name
      ctx.fillStyle = getCss('--text');
      ctx.font = `${Math.max(9, 13 * view.zoom)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(fit(n.name, 16), s.x + pad, s.y + 8 * view.zoom);

      // type + bottleneck tag
      ctx.fillStyle = getCss('--muted');
      ctx.font = `${Math.max(8, 10 * view.zoom)}px system-ui, sans-serif`;
      ctx.fillText(isBottleneck ? n.type.toUpperCase() + ' • BOTTLENECK' : n.type.toUpperCase(),
        s.x + pad, s.y + 26 * view.zoom);

      // live numbers
      const line = liveLine(n);
      ctx.fillStyle = getCss('--text');
      ctx.font = `${Math.max(9, 12 * view.zoom)}px system-ui, sans-serif`;
      ctx.fillText(line, s.x + pad, s.y + 42 * view.zoom);

      // utilization bar for process nodes
      if (n.type === 'process') {
        const st = engine.nodeStats(n.id);
        const u = st ? st.util : 0;
        const bw = w - pad * 2, bh = 6 * view.zoom;
        const by = s.y + h - bh - 8 * view.zoom;
        ctx.fillStyle = getCss('--bar-bg');
        roundRect(s.x + pad, by, bw, bh, bh / 2); ctx.fill();
        ctx.fillStyle = u > 0.85 ? '#ef4444' : u > 0.6 ? '#f59e0b' : '#22c55e';
        roundRect(s.x + pad, by, bw * Math.max(0, Math.min(1, u)), bh, bh / 2); ctx.fill();
      }
      // stock bar for buffers
      if (n.type === 'buffer') {
        const lvl = engine.rt[n.id].inputBuffer.length / Math.max(1, n.maxCapacity);
        const bw = w - pad * 2, bh = 6 * view.zoom;
        const by = s.y + h - bh - 8 * view.zoom;
        ctx.fillStyle = getCss('--bar-bg');
        roundRect(s.x + pad, by, bw, bh, bh / 2); ctx.fill();
        const low = engine.rt[n.id].inputBuffer.length < n.reorderLevel;
        ctx.fillStyle = low ? '#eab308' : '#0ea5e9';
        roundRect(s.x + pad, by, bw * Math.max(0, Math.min(1, lvl)), bh, bh / 2); ctx.fill();
      }
    }

    // delete control when selected
    if (isSel) {
      const bx = s.x + w - 9 * view.zoom, by = s.y + 9 * view.zoom;
      ctx.beginPath(); ctx.arc(bx, by, 9 * view.zoom, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `${12 * view.zoom}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('×', bx, by);
    }
    ctx.restore();
  }

  function liveLine(n) {
    const rt = engine.rt[n.id];
    if (n.type === 'process') return `WIP ${engine.nodeWip(n.id)}  •  Q ${rt.inputBuffer.length}`;
    if (n.type === 'buffer') return `Stock ${rt.inputBuffer.length}/${n.maxCapacity}`;
    if (n.type === 'source') return `In ${rt.inCount}  •  ${n.arrivalRate}/hr`;
    if (n.type === 'sink') return `Out ${engine.sinkTotal}`;
    return '';
  }

  // Quick-add / connect handles on the 4 sides of the hovered node.
  const HANDLE_DIRS = [
    { dir: 'r', dx: 1, dy: 0 }, { dir: 'l', dx: -1, dy: 0 },
    { dir: 't', dx: 0, dy: -1 }, { dir: 'b', dx: 0, dy: 1 },
  ];
  function handlePos(n, d) {
    const c = nodeCenter(n);
    const x = c.x + d.dx * (NODE_W / 2 + 22);
    const y = c.y + d.dy * (NODE_H / 2 + 22);
    return w2s(x, y);
  }
  function drawHandles(nodeId) {
    const n = engine.node(nodeId);
    if (!n) return;
    ctx.save();
    HANDLE_DIRS.forEach((d) => {
      const p = handlePos(n, d);
      const active = hoverHandle && hoverHandle.nodeId === nodeId && hoverHandle.dir === d.dir;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#2563eb' : '#3b82f6';
      ctx.globalAlpha = 0.95; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 15px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+', p.x, p.y);
    });
    ctx.restore();
  }

  function drawConnectPreview() {
    const from = engine.node(connectDrag.fromId);
    const s1 = w2s(nodeCenter(from).x, nodeCenter(from).y);
    ctx.save();
    ctx.strokeStyle = '#3b82f6'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(connectDrag.x, connectDrag.y); ctx.stroke();
    ctx.restore();
  }

  function drawCenterAdd() {
    const x = cssSize.w / 2, y = cssSize.h / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+', x, y - 2);
    ctx.fillStyle = getCss('--muted'); ctx.font = '13px system-ui';
    ctx.fillText('Click to add your first element', x, y + 56);
    ctx.restore();
    centerAddHit = { x, y, r: 34 };
  }
  let centerAddHit = null;

  /* ---- canvas primitives ---------------------------------------------- */
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fit(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function getCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  /* ======================================================================
   * Hit testing
   * ==================================================================== */
  function nodeAt(sx, sy) {
    // topmost first
    for (let i = model.nodes.length - 1; i >= 0; i--) {
      const n = model.nodes[i];
      const p = w2s(n.x, n.y);
      if (sx >= p.x && sx <= p.x + NODE_W * view.zoom && sy >= p.y && sy <= p.y + NODE_H * view.zoom) return n;
    }
    return null;
  }
  function deleteHit(n, sx, sy) {
    const p = w2s(n.x, n.y);
    const bx = p.x + NODE_W * view.zoom - 9 * view.zoom, by = p.y + 9 * view.zoom;
    return Math.hypot(sx - bx, sy - by) <= 11 * view.zoom;
  }
  function handleAt(sx, sy) {
    if (!hoverNode) return null;
    const n = engine.node(hoverNode);
    if (!n) return null;
    for (const d of HANDLE_DIRS) {
      const p = handlePos(n, d);
      if (Math.hypot(sx - p.x, sy - p.y) <= 16) return { nodeId: n.id, dir: d.dir, d };
    }
    return null;
  }

  // Expanded region around a box that comfortably includes its 4 + handles,
  // so hover doesn't drop while the mouse travels from the box to a handle.
  function withinHandleZone(n, sx, sy) {
    const p = w2s(n.x, n.y);
    const pad = 42 * view.zoom;
    return sx >= p.x - pad && sx <= p.x + NODE_W * view.zoom + pad &&
           sy >= p.y - pad && sy <= p.y + NODE_H * view.zoom + pad;
  }
  function arrowAt(sx, sy) {
    for (const a of model.arrows) {
      const from = engine.node(a.from), to = engine.node(a.to);
      if (!from || !to) continue;
      const p1 = w2s(edgePoint(from, nodeCenter(to).x, nodeCenter(to).y).x, edgePoint(from, nodeCenter(to).x, nodeCenter(to).y).y);
      const p2 = w2s(edgePoint(to, nodeCenter(from).x, nodeCenter(from).y).x, edgePoint(to, nodeCenter(from).x, nodeCenter(from).y).y);
      if (distToSeg(sx, sy, p1.x, p1.y, p2.x, p2.y) < 7) return a;
    }
    return null;
  }
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  /* ======================================================================
   * Interaction
   * ==================================================================== */
  let dragState = null;    // node drag
  let panState = null;     // canvas pan
  let connectDrag = null;  // drag-to-connect / from a handle
  let downInfo = null;     // to distinguish click vs drag

  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('mousedown', (e) => {
    const { x, y } = localXY(e);
    downInfo = { x, y, moved: false, t: Date.now() };

    // empty-canvas center add
    if (!model.nodes.length && centerAddHit && Math.hypot(x - centerAddHit.x, y - centerAddHit.y) <= centerAddHit.r) {
      openTypePicker(x, y, (type) => {
        const w = s2w(cssSize.w / 2 - NODE_W / 2 * view.zoom, cssSize.h / 2 - NODE_H / 2 * view.zoom);
        addNode(type, w.x, w.y);
      });
      downInfo = null; return;
    }

    // quick-add / connect handle?
    const h = handleAt(x, y);
    if (h) { connectDrag = { fromId: h.nodeId, dir: h.dir, d: h.d, x, y, fromHandle: true }; return; }

    const n = nodeAt(x, y);
    if (n) {
      // delete control on selected node
      if (selected && selected.kind === 'node' && selected.id === n.id && deleteHit(n, x, y)) {
        deleteNode(n.id); downInfo = null; return;
      }
      select('node', n.id);
      const wp = s2w(x, y);
      dragState = { id: n.id, dx: wp.x - n.x, dy: wp.y - n.y };
      return;
    }

    const a = arrowAt(x, y);
    if (a) { select('arrow', a.id); return; }

    // empty space -> pan (and clear selection)
    select(null);
    panState = { x, y, panX: view.panX, panY: view.panY };
  });

  window.addEventListener('mousemove', (e) => {
    const { x, y } = localXY(e);
    if (downInfo && (Math.abs(x - downInfo.x) > 3 || Math.abs(y - downInfo.y) > 3)) downInfo.moved = true;

    if (connectDrag) { connectDrag.x = x; connectDrag.y = y; return; }
    if (dragState) {
      const wp = s2w(x, y);
      const n = engine.node(dragState.id);
      n.x = wp.x - dragState.dx; n.y = wp.y - dragState.dy;
      return;
    }
    if (panState) {
      view.panX = panState.panX + (x - panState.x);
      view.panY = panState.panY + (y - panState.y);
      return;
    }
    // hover state for handles. Sticky: keep the handles alive while the mouse
    // is anywhere near the box (including the gap between the box and its +
    // buttons) so they don't vanish mid-reach.
    const nUnder = nodeAt(x, y);
    if (nUnder) {
      hoverNode = nUnder.id;
    } else if (hoverNode) {
      const hn = engine.node(hoverNode);
      if (!hn || !withinHandleZone(hn, x, y)) hoverNode = null;
    }
    hoverHandle = handleAt(x, y);
    canvas.style.cursor = hoverHandle ? 'crosshair' : nUnder ? 'move' : 'grab';
  });

  window.addEventListener('mouseup', (e) => {
    const { x, y } = localXY(e);

    if (connectDrag) {
      const target = nodeAt(x, y);
      const isClick = !downInfo || !downInfo.moved;
      if (target && target.id !== connectDrag.fromId) {
        // dragged onto an existing node -> manual connection
        addArrow(connectDrag.fromId, target.id);
      } else if (isClick) {
        // click on a + handle -> quick-add a new node in that direction
        const fromId = connectDrag.fromId, d = connectDrag.d;
        openTypePicker(x, y, (type) => quickAdd(fromId, d, type));
      }
      connectDrag = null;
    }
    dragState = null; panState = null; downInfo = null;
  });

  // zoom to cursor
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { x, y } = localXY(e);
    const before = s2w(x, y);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    view.zoom = Math.max(0.2, Math.min(3, view.zoom * factor));
    const after = s2w(x, y);
    view.panX += (after.x - before.x) * view.zoom;
    view.panY += (after.y - before.y) * view.zoom;
  }, { passive: false });

  /* ---- Type picker popup ---------------------------------------------- */
  function openTypePicker(sx, sy, cb) {
    closePopup();
    const el = document.createElement('div');
    el.className = 'popup';
    el.style.left = Math.min(sx, cssSize.w - 170) + 'px';
    el.style.top = Math.min(sy, cssSize.h - 220) + 'px';
    const types = [
      ['process', 'Process / Station'], ['buffer', 'Stock / Buffer'],
      ['source', 'Source (input)'], ['sink', 'Sink (output)'],
    ];
    el.innerHTML = '<div class="popup-title">Add element</div>';
    types.forEach(([t, label]) => {
      const b = document.createElement('button');
      b.className = 'popup-item';
      b.innerHTML = `<span class="dot" style="background:${TYPE_COLORS[t]}"></span>${label}`;
      b.onclick = () => { closePopup(); cb(t); };
      el.appendChild(b);
    });
    document.getElementById('canvas-wrap').appendChild(el);
    activePopup = el;
    setTimeout(() => document.addEventListener('mousedown', outsidePopup, { once: true }), 0);
  }
  let activePopup = null;
  function outsidePopup(e) { if (activePopup && !activePopup.contains(e.target)) closePopup(); }
  function closePopup() { if (activePopup) { activePopup.remove(); activePopup = null; } }

  /* ======================================================================
   * Structural edits (auto-pause the run)
   * ==================================================================== */
  function structuralPause() { if (engine.running) { setRunning(false); flash('Paused — structural edit applied'); } }

  function addNode(type, x, y) {
    structuralPause();
    const n = ProdSim.makeNode(type, x, y);
    // auto-number stations for readability
    if (type === 'process') n.name = 'Station ' + (model.nodes.filter((m) => m.type === 'process').length + 1);
    model.nodes.push(n);
    engine.sync();
    select('node', n.id);
    return n;
  }

  function quickAdd(fromId, dir, type) {
    const from = engine.node(fromId);
    const off = { r: [240, 0], l: [-240, 0], t: [0, -150], b: [0, 150] }[dir] || [240, 0];
    let x = from.x + off[0], y = from.y + off[1];
    // nudge to avoid overlap
    while (model.nodes.some((m) => Math.abs(m.x - x) < NODE_W && Math.abs(m.y - y) < NODE_H)) { x += 20; y += 20; }
    const n = addNode(type, x, y);
    addArrow(fromId, n.id);
    return n;
  }

  function addArrow(fromId, toId) {
    if (fromId === toId) return;
    if (model.arrows.some((a) => a.from === fromId && a.to === toId)) { flash('Arrow already exists'); return; }
    structuralPause();
    const a = ProdSim.makeArrow(fromId, toId);
    model.arrows.push(a);
    engine.sync();
    select('arrow', a.id);
  }

  function deleteNode(id) {
    structuralPause();
    model.nodes = model.nodes.filter((n) => n.id !== id);
    model.arrows = model.arrows.filter((a) => a.from !== id && a.to !== id);
    engine.sync();
    select(null);
  }
  function deleteArrow(id) {
    structuralPause();
    model.arrows = model.arrows.filter((a) => a.id !== id);
    engine.sync();
    select(null);
  }

  /* ======================================================================
   * Selection + config panel (parameter edits apply LIVE)
   * ==================================================================== */
  function select(kind, id) {
    selected = kind ? { kind, id } : null;
    renderConfig();
  }

  // field spec per node type
  const FIELDS = {
    common: [['name', 'Name', 'text']],
    source: [['arrivalRate', 'Arrival rate (units/hr)', 'num']],
    process: [
      ['processTime', 'Process time (min/batch)', 'num'],
      ['batchSize', 'Batch size', 'int'],
      ['machines', 'Parallel machines', 'int'],
      ['capacity', 'Input buffer / WIP limit', 'int'],
      ['setupTime', 'Setup / changeover (min)', 'num'],
      ['yieldPct', 'Yield (% good)', 'num'],
      ['availMode', 'Availability', 'select:none,uptime,mtbf'],
      ['uptimePct', 'Uptime (%)', 'num'],
      ['mtbf', 'MTBF (min)', 'num'],
      ['mttr', 'MTTR (min)', 'num'],
    ],
    buffer: [
      ['maxCapacity', 'Max capacity', 'int'],
      ['reorderLevel', 'Reorder / min level', 'int'],
      ['initialStock', 'Initial stock', 'int'],
    ],
    sink: [],
    arrow: [
      ['transportTime', 'Transport time (min)', 'num'],
      ['distance', 'Distance (opt)', 'num'],
      ['speed', 'Speed (dist/min, opt)', 'num'],
      ['moveBatch', 'Move batch size', 'int'],
      ['capacity', 'In-transit capacity', 'int'],
    ],
  };

  function renderConfig() {
    const panel = document.getElementById('config');
    if (!selected) {
      panel.innerHTML = '<div class="hint">Select a box or arrow to edit its parameters.<br><br>' +
        'Build the line by clicking the <b>+</b> handles that appear when you hover a box, ' +
        'or drag from a handle onto another box to connect them.</div>';
      return;
    }
    let obj, fields, title;
    if (selected.kind === 'arrow') {
      obj = model.arrows.find((a) => a.id === selected.id);
      if (!obj) { select(null); return; }
      fields = FIELDS.arrow; title = 'Transport';
    } else {
      obj = engine.node(selected.id);
      if (!obj) { select(null); return; }
      fields = FIELDS.common.concat(FIELDS[obj.type]); title = obj.type[0].toUpperCase() + obj.type.slice(1);
    }
    let html = `<div class="cfg-head"><span>${title}</span>` +
      `<button class="del-btn" id="cfg-del">Delete</button></div>`;
    fields.forEach(([key, label, kind]) => {
      // hide availability sub-fields unless relevant
      if (obj.type === 'process') {
        if ((key === 'uptimePct') && obj.availMode !== 'uptime') return;
        if ((key === 'mtbf' || key === 'mttr') && obj.availMode === 'none') return;
      }
      const val = obj[key];
      if (kind.startsWith('select')) {
        const opts = kind.split(':')[1].split(',');
        html += `<label class="fld"><span>${label}</span><select data-k="${key}">` +
          opts.map((o) => `<option value="${o}"${o === val ? ' selected' : ''}>${o}</option>`).join('') +
          `</select></label>`;
      } else {
        const type = kind === 'text' ? 'text' : 'number';
        const stepAttr = kind === 'int' ? 'step="1"' : kind === 'num' ? 'step="0.1"' : '';
        html += `<label class="fld"><span>${label}</span>` +
          `<input type="${type}" ${stepAttr} data-k="${key}" value="${val}"></label>`;
      }
    });
    if (selected.kind === 'node') {
      const st = engine.nodeStats && engine.nodeStats(selected.id);
      if (st) {
        html += `<div class="cfg-metrics">` +
          metricRow('Utilization', pct(st.util)) +
          metricRow('Blocked', pct(st.blocked)) +
          metricRow('Starved', pct(st.starved)) +
          (st.setup ? metricRow('Setup', pct(st.setup)) : '') +
          (st.down ? metricRow('Down', pct(st.down)) : '') +
          metricRow('Produced', st.produced) +
          metricRow('Scrapped', st.scrapped) +
          `</div>`;
      }
    }
    panel.innerHTML = html;

    // wire inputs (live edits)
    panel.querySelectorAll('[data-k]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        let v = inp.value;
        if (inp.tagName === 'INPUT' && inp.type === 'number') v = parseFloat(v) || 0;
        obj[k] = v;
        if (k === 'machines') engine.sync(); // machine count change: reconcile runtime
        renderConfigMetricsOnly(); // keep field focus; metrics refresh via loop anyway
      });
    });
    const del = document.getElementById('cfg-del');
    if (del) del.onclick = () => (selected.kind === 'arrow' ? deleteArrow(selected.id) : deleteNode(selected.id));
  }
  function renderConfigMetricsOnly() { /* metrics redraw each frame via loop; no-op keeps focus */ }
  function metricRow(k, v) { return `<div class="mrow"><span>${k}</span><b>${v}</b></div>`; }
  function pct(x) { return (100 * (x || 0)).toFixed(1) + '%'; }

  // Live-refresh the metrics block in the config panel without stealing focus.
  function refreshConfigMetrics() {
    if (!selected || selected.kind !== 'node') return;
    const box = document.querySelector('#config .cfg-metrics');
    const st = engine.nodeStats(selected.id);
    if (!box || !st) return;
    box.innerHTML =
      metricRow('Utilization', pct(st.util)) +
      metricRow('Blocked', pct(st.blocked)) +
      metricRow('Starved', pct(st.starved)) +
      (st.setup ? metricRow('Setup', pct(st.setup)) : '') +
      (st.down ? metricRow('Down', pct(st.down)) : '') +
      metricRow('Produced', st.produced) +
      metricRow('Scrapped', st.scrapped);
  }

  /* ======================================================================
   * Dashboard + throughput chart
   * ==================================================================== */
  const chart = document.getElementById('chart');
  const cctx = chart.getContext('2d');

  function renderDashboard() {
    const m = engine.metrics();
    document.getElementById('clock').textContent = fmtClock(m.clock);
    const el = document.getElementById('dash');
    const bnName = m.bottleneck ? engine.node(m.bottleneck).name : '—';
    el.innerHTML =
      dashTile('Total WIP', m.totalWip.toFixed(0)) +
      dashTile('Throughput', m.throughput.toFixed(1) + ' /hr') +
      dashTile('Produced', m.totalProduced) +
      dashTile('Scrapped', m.totalScrapped) +
      dashTile('Avg lead time', m.leadTime.toFixed(1) + ' min') +
      dashTile('Bottleneck', bnName, true);

    // per-station table
    const rows = model.nodes.filter((n) => n.type === 'process').map((n) => {
      const s = engine.nodeStats(n.id);
      const isBn = n.id === m.bottleneck;
      return `<tr class="${isBn ? 'bn' : ''}"><td>${fit(n.name, 18)}</td>` +
        `<td>${engine.nodeWip(n.id)}</td>` +
        `<td>${pct(s.util)}</td><td>${pct(s.blocked)}</td><td>${pct(s.starved)}</td></tr>`;
    }).join('');
    document.getElementById('station-table').innerHTML =
      '<tr><th>Station</th><th>WIP</th><th>Util</th><th>Blk</th><th>Strv</th></tr>' + rows;

    drawChart();
  }
  function dashTile(label, val, hi) {
    return `<div class="tile ${hi ? 'hi' : ''}"><div class="t-val">${val}</div><div class="t-lab">${label}</div></div>`;
  }

  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const r = chart.getBoundingClientRect();
    if (chart.width !== Math.round(r.width * dpr)) { chart.width = Math.round(r.width * dpr); chart.height = Math.round(r.height * dpr); }
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height;
    cctx.clearRect(0, 0, W, H);
    const data = engine.history;
    cctx.fillStyle = getCss('--muted'); cctx.font = '10px system-ui'; cctx.textAlign = 'left';
    cctx.fillText('Throughput (units/hr) over time', 6, 12);
    if (data.length < 2) return;
    const maxT = Math.max(10, ...data.map((d) => d.thru));
    const x0 = 6, x1 = W - 6, y0 = H - 16, y1 = 20;
    const sx = (i) => x0 + (x1 - x0) * (i / (data.length - 1));
    const sy = (v) => y0 + (y1 - y0) * (v / maxT);
    // gridline for max
    cctx.strokeStyle = getCss('--grid'); cctx.beginPath(); cctx.moveTo(x0, y1); cctx.lineTo(x1, y1); cctx.stroke();
    cctx.fillText(maxT.toFixed(0), x1 - 24, y1 - 2);
    // area + line
    cctx.beginPath(); cctx.moveTo(x0, y0);
    data.forEach((d, i) => cctx.lineTo(sx(i), sy(d.thru)));
    cctx.lineTo(x1, y0); cctx.closePath();
    cctx.fillStyle = 'rgba(56,189,248,0.15)'; cctx.fill();
    cctx.beginPath();
    data.forEach((d, i) => { const X = sx(i), Y = sy(d.thru); i ? cctx.lineTo(X, Y) : cctx.moveTo(X, Y); });
    cctx.strokeStyle = '#38bdf8'; cctx.lineWidth = 2; cctx.stroke();
  }

  /* ======================================================================
   * Controls / run loop
   * ==================================================================== */
  let lastFrame = 0, tickAccum = 0;

  function setRunning(on) {
    engine.running = on;
    document.getElementById('btn-play').classList.toggle('active', on);
    document.getElementById('btn-play').textContent = on ? '⏸ Pause' : '▶ Play';
    if (on) lastFrame = performance.now();
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(100, now - lastFrame) / 1000; // seconds since last frame
    lastFrame = now;

    if (engine.running) {
      // speedMultiplier = target simulation ticks per real second
      tickAccum += dt * model.settings.speedMultiplier;
      let budget = 2000; // safety cap on ticks/frame
      while (tickAccum >= 1 && budget-- > 0) {
        engine.step();
        tickAccum -= 1;
        const tr = model.settings.totalRunTime;
        if (tr > 0 && engine.clock >= tr) { setRunning(false); flash('Run complete at ' + fmtClock(engine.clock)); break; }
      }
    }
    draw();
    renderDashboard();
    refreshConfigMetrics();
    saveThrottled();
  }

  /* ---- control bar wiring --------------------------------------------- */
  function wireControls() {
    document.getElementById('btn-play').onclick = () => setRunning(!engine.running);
    document.getElementById('btn-step').onclick = () => { engine.step(); };
    document.getElementById('btn-reset').onclick = () => { setRunning(false); engine.reset(); flash('Reset'); };
    document.getElementById('btn-fit').onclick = fitToView;

    const speed = document.getElementById('speed');
    speed.oninput = () => {
      model.settings.speedMultiplier = parseInt(speed.value, 10);
      document.getElementById('speed-val').textContent = speed.value + '×';
    };
    speed.value = model.settings.speedMultiplier;
    document.getElementById('speed-val').textContent = speed.value + '×';

    // global settings
    const gs = document.getElementById('global-settings');
    gs.innerHTML =
      gfield('seed', 'Random seed', model.settings.seed) +
      gfield('warmup', 'Warm-up (min)', model.settings.warmup) +
      gfield('totalRunTime', 'Run time (min, 0=∞)', model.settings.totalRunTime);
    gs.querySelectorAll('[data-g]').forEach((inp) => {
      inp.addEventListener('input', () => {
        model.settings[inp.dataset.g] = parseFloat(inp.value) || 0;
      });
    });

    // presets
    const sel = document.getElementById('preset-select');
    sel.onchange = () => { if (sel.value) loadModel(ProdSim.presets[sel.value]()); sel.value = ''; };

    // persistence
    document.getElementById('btn-save').onclick = () => { saveLocal(); flash('Saved to browser'); };
    document.getElementById('btn-load').onclick = () => { if (loadLocal()) flash('Loaded from browser'); else flash('No saved line'); };
    document.getElementById('btn-export').onclick = exportJSON;
    document.getElementById('btn-import').onclick = () => document.getElementById('import-file').click();
    document.getElementById('import-file').onchange = importJSON;
    document.getElementById('btn-clear').onclick = () => { loadModel(ProdSim.newModel('New line')); };
  }
  function gfield(key, label, val) {
    return `<label class="fld"><span>${label}</span><input type="number" data-g="${key}" value="${val}"></label>`;
  }

  /* ======================================================================
   * View helpers
   * ==================================================================== */
  function fitToView() {
    if (!model.nodes.length) { view.panX = cssSize.w / 2; view.panY = cssSize.h / 2; view.zoom = 1; return; }
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    model.nodes.forEach((n) => {
      minx = Math.min(minx, n.x); miny = Math.min(miny, n.y);
      maxx = Math.max(maxx, n.x + NODE_W); maxy = Math.max(maxy, n.y + NODE_H);
    });
    const pad = 60;
    const zx = cssSize.w / (maxx - minx + pad * 2), zy = cssSize.h / (maxy - miny + pad * 2);
    view.zoom = Math.max(0.2, Math.min(1.5, Math.min(zx, zy)));
    view.panX = cssSize.w / 2 - ((minx + maxx) / 2) * view.zoom;
    view.panY = cssSize.h / 2 - ((miny + maxy) / 2) * view.zoom;
  }

  /* ======================================================================
   * Persistence: localStorage + import/export JSON
   * ==================================================================== */
  const LS_KEY = 'prodsim.model.v1';
  let _saveTimer = 0;
  function saveThrottled() {
    if (Date.now() - _saveTimer < 3000) return;
    _saveTimer = Date.now();
    try { localStorage.setItem(LS_KEY, ProdSim.toJSON(model)); } catch (e) {}
  }
  function saveLocal() { try { localStorage.setItem(LS_KEY, ProdSim.toJSON(model)); } catch (e) {} }
  function loadLocal() {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (!s) return false;
      loadModel(ProdSim.fromJSON(s));
      return true;
    } catch (e) { return false; }
  }
  function exportJSON() {
    const blob = new Blob([ProdSim.toJSON(model)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (model.meta.name || 'production-line').replace(/\s+/g, '-') + '.json';
    a.click(); URL.revokeObjectURL(url);
  }
  function importJSON(e) {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { loadModel(ProdSim.fromJSON(rd.result)); flash('Imported'); } catch (err) { flash('Import failed: ' + err.message); } };
    rd.readAsText(f);
    e.target.value = '';
  }

  /* ---- Load a model into the app -------------------------------------- */
  function loadModel(m) {
    model = m;
    engine = new ProdSim.Engine(model);
    window.model = model; window.engine = engine; window.view = view; // expose for console testing
    setRunning(false);
    select(null);
    // refresh global settings inputs
    const gs = document.getElementById('global-settings');
    if (gs) {
      gs.querySelectorAll('[data-g]').forEach((inp) => { inp.value = model.settings[inp.dataset.g]; });
    }
    const speed = document.getElementById('speed');
    if (speed) { speed.value = model.settings.speedMultiplier; document.getElementById('speed-val').textContent = speed.value + '×'; }
    document.getElementById('line-name').value = model.meta.name;
    fitToView();
  }

  /* ---- flash toast ---------------------------------------------------- */
  let flashTimer = 0;
  function flash(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  /* ---- misc helpers --------------------------------------------------- */
  function fmtClock(min) {
    const h = Math.floor(min / 60), m = Math.floor(min % 60), s = Math.floor((min * 60) % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /* ======================================================================
   * Boot
   * ==================================================================== */
  function boot() {
    resize();
    window.addEventListener('resize', () => { resize(); });

    // load a model FIRST (controls read model.settings), then wire the UI
    if (!loadLocal()) loadModel(ProdSim.presets.bottleneck());
    wireControls();

    document.getElementById('line-name').addEventListener('input', (e) => { model.meta.name = e.target.value; });

    // keyboard: space=play/pause, s=step, delete=remove selection
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); setRunning(!engine.running); }
      else if (e.key === 's') engine.step();
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected) (selected.kind === 'arrow' ? deleteArrow(selected.id) : deleteNode(selected.id));
      }
    });

    lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
