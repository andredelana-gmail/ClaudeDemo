/* ============================================================================
 * engine.js — Production-line simulation engine + data model
 * ----------------------------------------------------------------------------
 * Pure logic, no DOM. Everything here is testable from the console:
 *
 *     const m = ProdSim.presets.bottleneck();
 *     const e = new ProdSim.Engine(m);
 *     for (let i = 0; i < 5000; i++) e.step();
 *     console.log(e.metrics());
 *
 * TIME BASE
 *   The internal clock counts MINUTES. Process/setup/transport times are in
 *   minutes. Rates (arrival, throughput) are expressed in units/hour.
 *   A fixed time step `dt` (default 0.1 min = 6 s) is advanced each tick.
 *
 * MODEL (all serializable to plain JSON — see toJSON / fromJSON)
 *   model = { meta, settings, nodes[], arrows[] }
 *   node  = { id, type, name, x, y, ...type-specific params }
 *   arrow = { id, from, to, transportTime, distance, speed, moveBatch, capacity }
 *
 * NODE TYPES: 'source' | 'process' | 'buffer' | 'sink'
 *
 * BLOCKING & STARVING (the whole point):
 *   - A process machine is STARVED when idle with no input available.
 *   - A process machine is BLOCKED when it has finished a batch but cannot
 *     hand it off (all outgoing arrows are full, because their destination
 *     input buffers are full — backpressure propagates upstream).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* ---- Seeded RNG (mulberry32): deterministic, reproducible runs -------- */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---- id helper -------------------------------------------------------- */
  let _idc = 0;
  function uid(prefix) {
    _idc++;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + _idc.toString(36);
  }

  /* ---- Default parameter factories ------------------------------------- */
  const NODE_DEFAULTS = {
    source: () => ({
      arrivalRate: 120,   // units/hour fed into the line
    }),
    process: () => ({
      processTime: 1.0,   // minutes per batch (batchSize=1 => per unit)
      batchSize: 1,       // units processed together per cycle
      machines: 1,        // parallel machines/operators
      capacity: 10,       // input buffer / WIP limit (units)
      setupTime: 0,       // setup/changeover minutes, applied per batch
      yieldPct: 100,      // % good (rest is scrapped)
      availMode: 'none',  // 'none' | 'uptime' | 'mtbf'
      uptimePct: 100,     // used when availMode==='uptime'
      mtbf: 240,          // mean time between failures (min)
      mttr: 15,           // mean time to repair (min)
    }),
    buffer: () => ({
      maxCapacity: 50,    // max stock
      reorderLevel: 10,   // highlight when below
      initialStock: 0,    // starting stock
    }),
    sink: () => ({}),
  };

  function defaultArrow() {
    return {
      transportTime: 0.5, // minutes (used directly if distance/speed unset)
      distance: 0,        // optional; if >0 and speed>0, time = distance/speed
      speed: 0,           // distance units per minute
      moveBatch: 1,       // transfer/move batch size
      capacity: 6,        // max units in transit (conveyor length) => backpressure
    };
  }

  // Effective transport time: derive from distance/speed when provided.
  function arrowTime(a) {
    if (a.distance > 0 && a.speed > 0) return a.distance / a.speed;
    return Math.max(0, a.transportTime || 0);
  }

  /* ---- Model construction helpers -------------------------------------- */
  function newModel(name) {
    return {
      meta: { name: name || 'Untitled line', createdAt: Date.now() },
      settings: {
        seed: 12345,
        dt: 0.1,              // minutes per tick
        speedMultiplier: 20,  // ticks-per-second target (UI drives real time)
        totalRunTime: 480,    // minutes (0 = run forever)
        warmup: 0,            // minutes excluded from steady-state stats
      },
      nodes: [],
      arrows: [],
    };
  }

  function makeNode(type, x, y, name) {
    const base = { id: uid(type), type: type, name: name || defaultName(type), x: x || 0, y: y || 0 };
    return Object.assign(base, NODE_DEFAULTS[type]());
  }
  function defaultName(type) {
    return ({ source: 'Source', process: 'Station', buffer: 'Buffer', sink: 'Sink' })[type];
  }
  function makeArrow(fromId, toId) {
    return Object.assign({ id: uid('arw'), from: fromId, to: toId }, defaultArrow());
  }

  /* ======================================================================
   * Engine
   * ==================================================================== */
  class Engine {
    // Source staging buffer size (units the source may hold before it blocks).
    static get SOURCE_STAGE() { return 20; }

    constructor(model) {
      this.model = model;
      this.reset();
    }

    /* Rebuild all runtime state and re-seed RNG. */
    reset() {
      const s = this.model.settings;
      this.clock = 0;         // minutes
      this.statMin = 0;       // minutes counted toward steady-state stats
      this.rng = makeRng(s.seed);
      this.rt = {};           // node runtime state keyed by node id
      this.art = {};          // arrow runtime state keyed by arrow id
      this.sinkTotal = 0;     // units absorbed at all sinks (post-reset)
      this.sinkStat = 0;      // units absorbed post-warmup
      this.scrapTotal = 0;
      this.leadSum = 0;       // sum of lead times (post-warmup)
      this.leadCount = 0;
      this.history = [];      // [{t, thru, wip}] samples for chart
      this._lastSample = 0;
      this._sampleEvery = 2;  // minutes between chart samples
      this._winCount = 0;     // units into sinks in current sample window
      this.running = false;
      this.model.nodes.forEach((n) => this._initNodeRt(n));
      this.model.arrows.forEach((a) => (this.art[a.id] = { transit: [], moved: 0 }));
    }

    _initNodeRt(n) {
      const rt = {
        inputBuffer: [],   // tokens waiting (process/buffer/sink input; = stock for buffer)
        out: [],           // source generated tokens awaiting offload
        machines: [],
        genAcc: 0,
        // steady-state counters (per-machine-minutes)
        tBusy: 0, tSetup: 0, tBlocked: 0, tStarved: 0, tDown: 0,
        produced: 0, scrapped: 0, inCount: 0, outCount: 0,
      };
      if (n.type === 'process') {
        for (let i = 0; i < Math.max(1, n.machines); i++) {
          rt.machines.push({ phase: 'idle', timer: 0, batch: [], out: [], down: false, downTimer: 0, resume: 'run' });
        }
      }
      if (n.type === 'buffer' && n.initialStock > 0) {
        for (let i = 0; i < n.initialStock; i++) rt.inputBuffer.push(this._newToken());
      }
      this.rt[n.id] = rt;
    }

    _newToken() {
      return { id: ++_idc, bornAt: this.clock };
    }

    /* Sync runtime after a structural edit (add/remove nodes/arrows) while
       preserving existing state. Called by the UI; also auto-pauses there. */
    sync() {
      const ids = new Set(this.model.nodes.map((n) => n.id));
      Object.keys(this.rt).forEach((id) => { if (!ids.has(id)) delete this.rt[id]; });
      this.model.nodes.forEach((n) => {
        if (!this.rt[n.id]) this._initNodeRt(n);
        // keep machine count in sync with the (possibly edited) param
        if (n.type === 'process') {
          const rt = this.rt[n.id];
          const want = Math.max(1, n.machines | 0);
          while (rt.machines.length < want)
            rt.machines.push({ phase: 'idle', timer: 0, batch: [], out: [], down: false, downTimer: 0, resume: 'run' });
          while (rt.machines.length > want) {
            const m = rt.machines.pop();          // return in-flight work to the queue
            rt.inputBuffer.unshift(...m.batch, ...m.out);
          }
        }
      });
      const aids = new Set(this.model.arrows.map((a) => a.id));
      Object.keys(this.art).forEach((id) => { if (!aids.has(id)) delete this.art[id]; });
      this.model.arrows.forEach((a) => { if (!this.art[a.id]) this.art[a.id] = { transit: [], moved: 0 }; });
    }

    /* Convenience lookups */
    node(id) { return this.model.nodes.find((n) => n.id === id); }
    _outArrows(nodeId) { return this.model.arrows.filter((a) => a.from === nodeId); }
    _inArrows(nodeId) { return this.model.arrows.filter((a) => a.to === nodeId); }

    /* --- One fixed-step tick ------------------------------------------- */
    step(dt) {
      dt = dt || this.model.settings.dt;
      this.clock += dt;

      // A) advance transports and deliver matured units into destinations
      this._advanceTransports();
      // B) first offload pass: drain last tick's finished work into arrows
      this.model.nodes.forEach((n) => this._offload(n));
      // C) internal node update (timers, generation, completion, pulls)
      this.model.nodes.forEach((n) => this._updateNode(n, dt));
      // D) second offload pass: drain fresh completions / generation
      this.model.nodes.forEach((n) => this._offload(n));

      // steady-state accounting (after warm-up)
      if (this.clock > this.model.settings.warmup) this.statMin += dt;

      // chart sampling
      if (this.clock - this._lastSample >= this._sampleEvery) {
        const winMin = this.clock - this._lastSample;
        this.history.push({
          t: this.clock,
          thru: (this._winCount / winMin) * 60, // units/hr over the window
          wip: this.totalWip(),
        });
        if (this.history.length > 600) this.history.shift();
        this._winCount = 0;
        this._lastSample = this.clock;
      }
    }

    _advanceTransports() {
      const dt = this.model.settings.dt;
      this.model.arrows.forEach((a) => {
        const art = this.art[a.id];
        art.transit.forEach((p) => (p.remaining -= dt));
        const dest = this.node(a.to);
        if (!dest) return;
        const drt = this.rt[dest.id];
        // deliver in FIFO order; stop at the first unit that can't be placed
        while (art.transit.length && art.transit[0].remaining <= 0) {
          if (!this._canAccept(dest, drt)) break; // destination full -> backpressure
          const p = art.transit.shift();
          drt.inputBuffer.push(p.token);
          drt.inCount++;
        }
      });
    }

    _canAccept(node, rt) {
      if (node.type === 'process') return rt.inputBuffer.length < node.capacity;
      if (node.type === 'buffer') return rt.inputBuffer.length < node.maxCapacity;
      return true; // sink: unbounded
    }

    _updateNode(n, dt) {
      const rt = this.rt[n.id];
      switch (n.type) {
        case 'source': this._updateSource(n, rt, dt); break;
        case 'process': this._updateProcess(n, rt, dt); break;
        case 'buffer': /* passthrough handled entirely by offload */ break;
        case 'sink': this._updateSink(n, rt, dt); break;
      }
    }

    _updateSource(n, rt, dt) {
      // Infinite raw material, but a small staging buffer: when the line can't
      // keep up, the source becomes BLOCKED rather than hoarding thousands of
      // units, so WIP/lead-time reflect the line itself. Excess demand beyond
      // the staging cap is line-limited (not counted as work-in-progress).
      rt.genAcc += (n.arrivalRate / 60) * dt; // units this tick (units/hr -> per min)
      if (rt.genAcc > 5) rt.genAcc = 5;       // cap pent-up demand
      while (rt.genAcc >= 1 && rt.out.length < Engine.SOURCE_STAGE) {
        rt.out.push(this._newToken());
        rt.genAcc -= 1;
        rt.inCount++;
      }
    }

    _updateSink(n, rt, dt) {
      const post = this.clock > this.model.settings.warmup;
      while (rt.inputBuffer.length) {
        const tok = rt.inputBuffer.shift();
        this.sinkTotal++;
        this._winCount++;
        if (post) {
          this.sinkStat++;
          this.leadSum += this.clock - tok.bornAt;
          this.leadCount++;
        }
      }
    }

    _updateProcess(n, rt, dt) {
      const post = this.clock > this.model.settings.warmup;
      const good = Math.max(0, Math.min(100, n.yieldPct)) / 100;
      for (const m of rt.machines) {
        // 1) breakdown / repair
        if (m.down) {
          m.downTimer -= dt;
          if (post) rt.tDown += dt;
          if (m.downTimer <= 0) { m.down = false; m.phase = m.resume; }
          continue;
        }
        // 2) blocked: finished batch waiting to be handed off
        if (m.out.length > 0) { if (post) rt.tBlocked += dt; continue; }
        // 3) idle: try to pull a fresh batch
        if (m.phase === 'idle') {
          if (rt.inputBuffer.length >= n.batchSize) {
            m.batch = rt.inputBuffer.splice(0, n.batchSize);
            if (n.setupTime > 0) { m.phase = 'setup'; m.timer = n.setupTime; }
            else { m.phase = 'run'; m.timer = n.processTime; }
          } else {
            if (post) rt.tStarved += dt;
          }
          continue;
        }
        // 4) setup / changeover
        if (m.phase === 'setup') {
          m.timer -= dt;
          if (post) rt.tSetup += dt;
          if (m.timer <= 0) { m.phase = 'run'; m.timer = n.processTime; }
          continue;
        }
        // 5) running
        if (m.phase === 'run') {
          m.timer -= dt;
          if (post) rt.tBusy += dt;
          if (this._maybeBreakdown(n, m, dt)) continue;
          if (m.timer <= 0) {
            // complete: apply yield, scrap the rest
            const out = [];
            for (const tok of m.batch) {
              if (this.rng() < good) { out.push(tok); rt.produced++; }
              else { rt.scrapped++; this.scrapTotal++; }
            }
            m.batch = [];
            m.out = out;
            m.phase = 'idle';
          }
        }
      }
    }

    _maybeBreakdown(n, m, dt) {
      let mtbf = 0, mttr = n.mttr;
      if (n.availMode === 'mtbf') mtbf = n.mtbf;
      else if (n.availMode === 'uptime') {
        const u = Math.max(0, Math.min(99.9, n.uptimePct)) / 100;
        mtbf = u >= 1 ? 0 : (n.mttr * u) / (1 - u); // MTBF from uptime & MTTR
      }
      if (mtbf <= 0) return false;
      const p = 1 - Math.exp(-dt / mtbf); // failure probability this tick
      if (this.rng() < p) {
        m.down = true;
        m.resume = 'run';
        m.downTimer = -Math.log(1 - this.rng()) * Math.max(0.1, mttr); // exp repair
        return true;
      }
      return false;
    }

    /* Move a node's finished/held units onto outgoing arrows (round-robin,
       respecting each arrow's transit capacity). This is where blocking is
       realized: units that can't be placed stay put and block the machine. */
    _offload(n) {
      const rt = this.rt[n.id];
      const arrows = this._outArrows(n.id);
      if (!arrows.length) return;

      // collect the output buckets for this node
      let buckets;
      if (n.type === 'source') buckets = [rt.out];
      else if (n.type === 'process') buckets = rt.machines.map((m) => m.out);
      else if (n.type === 'buffer') buckets = [rt.inputBuffer]; // stock flows out
      else return; // sinks don't offload

      let ai = 0;
      for (const bucket of buckets) {
        while (bucket.length) {
          let placed = false;
          for (let k = 0; k < arrows.length; k++) {
            const a = arrows[(ai + k) % arrows.length];
            const art = this.art[a.id];
            if (art.transit.length < a.capacity) {
              const tok = bucket.shift();
              art.transit.push({ token: tok, remaining: arrowTime(a) });
              art.moved++;
              rt.outCount++;
              ai = (ai + k + 1) % arrows.length;
              placed = true;
              break;
            }
          }
          if (!placed) break; // all arrows full -> remaining units are blocked
        }
      }
    }

    /* --- Aggregate / derived metrics ----------------------------------- */
    nodeWip(id) {
      const n = this.node(id), rt = this.rt[id];
      if (!rt) return 0;
      let w = rt.inputBuffer.length + rt.out.length;
      if (n.type === 'process')
        rt.machines.forEach((m) => (w += m.batch.length + m.out.length));
      return w;
    }

    totalWip() {
      let w = 0;
      this.model.nodes.forEach((n) => (w += this.nodeWip(n.id)));
      this.model.arrows.forEach((a) => (w += this.art[a.id].transit.length));
      return w;
    }

    // Per-machine utilization/blocked/starved fractions (0..1).
    nodeStats(id) {
      const n = this.node(id), rt = this.rt[id];
      if (!rt || n.type !== 'process') return null;
      const denom = Math.max(1e-9, this.statMin * rt.machines.length);
      return {
        util: rt.tBusy / denom,
        setup: rt.tSetup / denom,
        blocked: rt.tBlocked / denom,
        starved: rt.tStarved / denom,
        down: rt.tDown / denom,
        produced: rt.produced,
        scrapped: rt.scrapped,
      };
    }

    // Current live state label for coloring: running/starved/blocked/down/idle.
    nodeState(id) {
      const n = this.node(id), rt = this.rt[id];
      if (!rt) return 'idle';
      if (n.type === 'process') {
        const ph = rt.machines.map((m) => (m.down ? 'down' : m.out.length ? 'blocked' : m.phase));
        if (ph.some((p) => p === 'run' || p === 'setup')) return 'running';
        if (ph.some((p) => p === 'down')) return 'down';
        if (ph.some((p) => p === 'blocked')) return 'blocked';
        return 'starved';
      }
      if (n.type === 'buffer') {
        if (rt.inputBuffer.length >= n.maxCapacity) return 'blocked';
        if (rt.inputBuffer.length < n.reorderLevel) return 'starved';
        return 'running';
      }
      if (n.type === 'source') return rt.out.length >= Engine.SOURCE_STAGE ? 'blocked' : 'running';
      if (n.type === 'sink') return 'running';
      return 'idle';
    }

    // The bottleneck = process node with the highest utilization.
    bottleneckId() {
      let best = null, bu = -1;
      this.model.nodes.forEach((n) => {
        if (n.type !== 'process') return;
        const s = this.nodeStats(n.id);
        if (s && s.util > bu) { bu = s.util; best = n.id; }
      });
      return bu > 0.001 ? best : null; // no bottleneck until there's real data
    }

    metrics() {
      const hours = Math.max(1e-9, this.statMin / 60);
      return {
        clock: this.clock,
        totalWip: this.totalWip(),
        throughput: this.sinkStat / hours, // units/hr at the sink, post-warmup
        totalProduced: this.sinkTotal,
        totalScrapped: this.scrapTotal,
        leadTime: this.leadCount ? this.leadSum / this.leadCount : 0, // minutes
        bottleneck: this.bottleneckId(),
      };
    }
  }

  /* ======================================================================
   * Serialization (config only — runtime state is never persisted)
   * ==================================================================== */
  function toJSON(model) {
    return JSON.stringify({ meta: model.meta, settings: model.settings, nodes: model.nodes, arrows: model.arrows }, null, 2);
  }
  function fromJSON(str) {
    const o = typeof str === 'string' ? JSON.parse(str) : str;
    const m = newModel(o.meta && o.meta.name);
    if (o.meta) m.meta = o.meta;
    if (o.settings) Object.assign(m.settings, o.settings);
    m.nodes = (o.nodes || []).map((n) => Object.assign(makeNode(n.type, n.x, n.y, n.name), n));
    m.arrows = (o.arrows || []).map((a) => Object.assign(makeArrow(a.from, a.to), a));
    return m;
  }

  /* ======================================================================
   * Presets — load instantly. Layout coords are in world space.
   * ==================================================================== */
  function chain(model, specs) {
    // specs: [{type, name, x, y, params}] connected in series
    let prev = null;
    specs.forEach((sp) => {
      const n = Object.assign(makeNode(sp.type, sp.x, sp.y, sp.name), sp.params || {});
      model.nodes.push(n);
      if (prev) model.arrows.push(Object.assign(makeArrow(prev.id, n.id), sp.arrow || {}));
      prev = n;
    });
    return model;
  }

  const presets = {
    // 3-station line with a deliberate bottleneck at the MIDDLE station.
    bottleneck() {
      const m = newModel('Bottleneck line (Station 2)');
      m.settings.seed = 42;
      chain(m, [
        { type: 'source', name: 'Raw material', x: -520, y: 0, params: { arrivalRate: 120 } },
        { type: 'process', name: 'Station 1 (fast)', x: -280, y: 0, params: { processTime: 0.5, capacity: 12 } },
        { type: 'process', name: 'Station 2 (BOTTLENECK)', x: -20, y: 0, params: { processTime: 1.5, capacity: 12 } },
        { type: 'process', name: 'Station 3 (fast)', x: 240, y: 0, params: { processTime: 0.5, capacity: 12 } },
        { type: 'sink', name: 'Finished goods', x: 500, y: 0 },
      ]);
      return m;
    },

    // Balanced simple line: source -> process -> sink.
    simple() {
      const m = newModel('Simple line');
      m.settings.seed = 7;
      chain(m, [
        { type: 'source', name: 'Input', x: -360, y: 0, params: { arrivalRate: 90 } },
        { type: 'process', name: 'Assembly', x: -100, y: 0, params: { processTime: 0.6, machines: 1, capacity: 15 } },
        { type: 'sink', name: 'Output', x: 180, y: 0 },
      ]);
      return m;
    },

    // Line with a buffer, scrap, changeover and a random breakdown station.
    packaging() {
      const m = newModel('Packaging line (buffer + scrap + breakdowns)');
      m.settings.seed = 99;
      m.settings.totalRunTime = 600;
      chain(m, [
        { type: 'source', name: 'Bottles in', x: -640, y: 0, params: { arrivalRate: 150 } },
        { type: 'process', name: 'Fill', x: -400, y: 0, params: { processTime: 0.4, capacity: 20, yieldPct: 97 } },
        { type: 'buffer', name: 'Accumulator', x: -160, y: 0, params: { maxCapacity: 60, reorderLevel: 10, initialStock: 5 } },
        { type: 'process', name: 'Cap & Label', x: 80, y: 0, params: { processTime: 0.5, batchSize: 1, setupTime: 2, capacity: 20, availMode: 'mtbf', mtbf: 180, mttr: 12 } },
        { type: 'process', name: 'Pack', x: 320, y: 0, params: { processTime: 0.45, batchSize: 6, setupTime: 1, capacity: 24 } },
        { type: 'sink', name: 'Pallet out', x: 560, y: 0 },
      ]);
      return m;
    },
  };

  /* ---- Public API ------------------------------------------------------ */
  global.ProdSim = {
    Engine, makeRng, uid,
    newModel, makeNode, makeArrow, arrowTime,
    NODE_DEFAULTS, defaultArrow,
    toJSON, fromJSON, presets,
  };
})(typeof window !== 'undefined' ? window : globalThis);
