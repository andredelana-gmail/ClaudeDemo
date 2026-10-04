/* Meowdoku puzzle generator + solver.
   Rules: N x N grid split into N colour regions. Place N cats so that every
   row, column and region holds exactly one cat and no two cats touch
   (not even diagonally). Every generated puzzle has exactly one solution. */
(function (root) {
  'use strict';

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Random column per row, all columns distinct, consecutive rows not adjacent.
  function randomPlacement(n, rng) {
    const cols = new Array(n);
    const used = new Array(n).fill(false);
    function go(r) {
      if (r === n) return true;
      const order = shuffle([...Array(n).keys()], rng);
      for (const c of order) {
        if (used[c] || (r > 0 && Math.abs(c - cols[r - 1]) <= 1)) continue;
        used[c] = true; cols[r] = c;
        if (go(r + 1)) return true;
        used[c] = false;
      }
      return false;
    }
    return go(0) ? cols : null;
  }

  // Grow one region from each cat by random flood fill.
  function growRegions(n, cols, rng) {
    const reg = new Array(n * n).fill(-1);
    for (let r = 0; r < n; r++) reg[r * n + cols[r]] = r;
    let left = n * n - n;
    const nb = (i) => {
      const r = (i / n) | 0, c = i % n, out = [];
      if (r > 0) out.push(i - n);
      if (r < n - 1) out.push(i + n);
      if (c > 0) out.push(i - 1);
      if (c < n - 1) out.push(i + 1);
      return out;
    };
    while (left > 0) {
      // candidate unassigned cells touching an assigned one
      const cand = [];
      for (let i = 0; i < n * n; i++) {
        if (reg[i] !== -1) continue;
        for (const j of nb(i)) if (reg[j] !== -1) { cand.push(i); break; }
      }
      const i = cand[Math.floor(rng() * cand.length)];
      const owners = nb(i).filter((j) => reg[j] !== -1);
      reg[i] = reg[owners[Math.floor(rng() * owners.length)]];
      left--;
    }
    return reg;
  }

  // Count solutions (stops at `limit`). Row-by-row backtracking with pruning.
  function countSolutions(n, reg, limit, out) {
    const cellsOfRegion = Array.from({ length: n }, () => []);
    for (let i = 0; i < n * n; i++) cellsOfRegion[reg[i]].push(i);
    const cols = new Array(n);
    let count = 0;
    let colMask = 0, regMask = 0;
    function feasible(r) {
      // every unused region must still have a cell in rows > r with a free column
      for (let g = 0; g < n; g++) {
        if (regMask & (1 << g)) continue;
        let ok = false;
        for (const i of cellsOfRegion[g]) {
          if (((i / n) | 0) > r && !(colMask & (1 << (i % n)))) { ok = true; break; }
        }
        if (!ok) return false;
      }
      return true;
    }
    function go(r) {
      if (r === n) {
        count++;
        if (out && count === 1) out.push(cols.slice());
        return count >= limit;
      }
      for (let c = 0; c < n; c++) {
        if (colMask & (1 << c)) continue;
        if (r > 0 && Math.abs(c - cols[r - 1]) <= 1) continue;
        const g = reg[r * n + c];
        if (regMask & (1 << g)) continue;
        colMask |= 1 << c; regMask |= 1 << g; cols[r] = c;
        if (feasible(r) && go(r + 1)) return true;
        colMask &= ~(1 << c); regMask &= ~(1 << g);
      }
      return false;
    }
    go(0);
    return count;
  }

  function regionConnectedWithout(n, reg, g, skip) {
    const cells = [];
    for (let i = 0; i < n * n; i++) if (reg[i] === g && i !== skip) cells.push(i);
    if (!cells.length) return false;
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
      const i = stack.pop(), r = (i / n) | 0, c = i % n;
      const nbs = [];
      if (r > 0) nbs.push(i - n);
      if (r < n - 1) nbs.push(i + n);
      if (c > 0) nbs.push(i - 1);
      if (c < n - 1) nbs.push(i + 1);
      for (const j of nbs) if (j !== skip && reg[j] === g && !seen.has(j)) { seen.add(j); stack.push(j); }
    }
    return seen.size === cells.length;
  }

  // Break an alternative solution by moving one of its cat cells into a
  // neighbouring region. The intended solution stays valid.
  function repair(n, reg, sol, alt, rng) {
    const rows = shuffle([...Array(n).keys()].filter((r) => alt[r] !== sol[r]), rng);
    for (const r of rows) {
      const x = r * n + alt[r], g = reg[x], c = alt[r];
      const nbs = [];
      if (r > 0) nbs.push(x - n);
      if (r < n - 1) nbs.push(x + n);
      if (c > 0) nbs.push(x - 1);
      if (c < n - 1) nbs.push(x + 1);
      const targets = shuffle(nbs.map((j) => reg[j]).filter((h) => h !== g), rng);
      if (!targets.length || !regionConnectedWithout(n, reg, g, x)) continue;
      reg[x] = targets[0];
      return true;
    }
    return false;
  }

  // Rate how hard a puzzle is for a human, by solving with increasingly
  // advanced deductions:
  //   1 = only "last free cell in a row/column/region"
  //   2 = + "region confined to one line" (and vice versa) eliminations
  //   3 = + "placing here would empty another unit" eliminations
  //   4 = needs deeper reasoning than the above
  function rate(n, reg) {
    const N = n * n;
    const cand = new Array(N).fill(true), cat = new Array(N).fill(false);
    const units = [];
    for (let r = 0; r < n; r++) units.push([...Array(n).keys()].map((c) => r * n + c));
    for (let c = 0; c < n; c++) units.push([...Array(n).keys()].map((r) => r * n + c));
    for (let g = 0; g < n; g++) units.push([...Array(N).keys()].filter((i) => reg[i] === g));
    const R = (i) => (i / n) | 0, C = (i) => i % n;
    const clash = (i, j) => R(i) === R(j) || C(i) === C(j) || reg[i] === reg[j] ||
      (Math.abs(R(i) - R(j)) <= 1 && Math.abs(C(i) - C(j)) <= 1);
    const free = (u) => u.filter((i) => cand[i]);
    const hasCat = (u) => u.some((i) => cat[i]);
    function place(i) { cat[i] = true; cand[i] = false; for (let j = 0; j < N; j++) if (cand[j] && clash(i, j)) cand[j] = false; }
    let level = 1;
    for (let guard = 0; guard < 500; guard++) {
      if (units.every(hasCat)) return level;
      let progress = false;
      // L1: a unit with a single free cell
      for (const u of units) {
        if (hasCat(u)) continue;
        const f = free(u);
        if (f.length === 0) return 4;
        if (f.length === 1) { place(f[0]); progress = true; break; }
      }
      if (progress) continue;
      // L2: a unit whose free cells share one row / column / region
      for (const u of units) {
        if (hasCat(u)) continue;
        const f = free(u);
        const inU = new Set(u);
        const lines = [
          f.every((i) => R(i) === R(f[0])) && units[R(f[0])],
          f.every((i) => C(i) === C(f[0])) && units[n + C(f[0])],
          f.every((i) => reg[i] === reg[f[0]]) && units[2 * n + reg[f[0]]],
        ];
        for (const line of lines) {
          if (!line) continue;
          for (const j of line) if (cand[j] && !inU.has(j)) { cand[j] = false; progress = true; }
        }
        if (progress) break;
      }
      if (progress) { level = Math.max(level, 2); continue; }
      // L3: a cell whose cat would leave some other unit without room
      for (let i = 0; i < N && !progress; i++) {
        if (!cand[i]) continue;
        for (const u of units) {
          if (hasCat(u) || u.includes(i)) continue;
          if (free(u).every((j) => clash(i, j))) { cand[i] = false; progress = true; break; }
        }
      }
      if (progress) { level = Math.max(level, 3); continue; }
      return 4;
    }
    return 4;
  }

  // Generate a unique puzzle, preferring one whose difficulty rating
  // matches `target` (1..4). Tries a handful of candidates.
  function generateRated(n, rng, target, tries) {
    let best = null;
    for (let k = 0; k < (tries || 30); k++) {
      const p = generate(n, rng);
      if (!p) continue;
      p.rating = rate(n, p.regions);
      if (!best || Math.abs(p.rating - target) < Math.abs(best.rating - target)) best = p;
      if (best.rating === target) break;
    }
    return best;
  }

  function generate(n, rng, maxAttempts) {
    maxAttempts = maxAttempts || 400;
    for (let a = 0; a < maxAttempts; a++) {
      const sol = randomPlacement(n, rng);
      if (!sol) continue;
      const reg = growRegions(n, sol, rng);
      for (let k = 0; k < 60; k++) {
        const cnt = countSolutions(n, reg, 2, null);
        if (cnt === 1) return { n, regions: reg, solution: sol, attempts: a + 1 };
        // find a solution different from ours
        const alt = findOther(n, reg, sol);
        if (!alt || !repair(n, reg, sol, alt, rng)) break;
      }
    }
    return null;
  }

  function findOther(n, reg, sol) {
    const all = [];
    collect(n, reg, all, 3);
    for (const s of all) if (s.some((c, r) => c !== sol[r])) return s;
    return null;
  }

  function collect(n, reg, out, limit) {
    const cols = new Array(n);
    let colMask = 0, regMask = 0;
    (function go(r) {
      if (r === n) { out.push(cols.slice()); return out.length >= limit; }
      for (let c = 0; c < n; c++) {
        if (colMask & (1 << c)) continue;
        if (r > 0 && Math.abs(c - cols[r - 1]) <= 1) continue;
        const g = reg[r * n + c];
        if (regMask & (1 << g)) continue;
        colMask |= 1 << c; regMask |= 1 << g; cols[r] = c;
        if (go(r + 1)) return true;
        colMask &= ~(1 << c); regMask &= ~(1 << g);
      }
      return false;
    })(0);
  }

  const api = { generate, generateRated, rate, countSolutions };
  if (typeof module !== 'undefined') module.exports = api;
  else root.MeowGen = api;
})(this);
