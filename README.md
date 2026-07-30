# Production Line Simulator

A configurable, browser-only discrete production-process simulator. Lay out a
production line as boxes connected by arrows (MS Visio style), configure the
process parameters, press **Play**, and watch the simulation run with all key
metrics updating live.

**No build step, no server, no dependencies.** Just open `index.html` in any
modern browser (double-click it). Everything is drawn with the `<canvas>` API so
it works fully offline.

## Files

| File | Responsibility |
|------|----------------|
| `index.html` | Layout, CSS (dark/light aware), control bar, dashboard shell |
| `engine.js`  | Data model + simulation engine — pure logic, no DOM, console-testable |
| `ui.js`      | Canvas rendering, pan/zoom, quick-add flow, config panels, dashboard, persistence |

## Quick start

1. Open `index.html`. It loads the **Bottleneck line** preset by default.
2. Press **▶ Play** (or `Space`). Drag the **Speed** slider up to run faster.
3. Watch WIP pile up in front of Station 2, Station 3 sit starved, and the
   dashboard flag Station 2 as the bottleneck.

## Building a line

- **Empty canvas:** click the big central **+** and pick an element type.
- **Grow the line:** hover any box to reveal **+** handles on all four sides.
  Click a handle → pick a type → a new element is created and auto-connected.
- **Manual connections:** drag *from* a **+** handle *onto* another existing box
  to draw an arrow (supports merges, splits, and rework loops).
- **Edit:** click a box or arrow to open the config panel (edits apply live).
- **Delete:** select an element and click **Delete** (or press `Delete`).
- **Navigate:** drag empty space to pan, scroll to zoom, **⤢ Fit** to frame all.

## Element types

- **Source** — feeds raw material at a configurable arrival rate (units/hr).
- **Process / Station** — cycle time, batch size, parallel machines, input-buffer
  (WIP) limit, setup/changeover time, yield/scrap %, and optional breakdowns
  (uptime % or MTBF/MTTR).
- **Buffer / Stock** — holds stock up to a max capacity, highlights below reorder level.
- **Sink** — absorbs finished units and records lead time / total output.

Arrows carry transport time (or distance ÷ speed), a move-batch size, and an
in-transit capacity that produces realistic **backpressure**.

## Live metrics

Shown on each box and in the dashboard: per-station and total WIP, throughput
(units/hr) overall and at the sink, per-station utilization, buffer stock levels,
the **automatically highlighted bottleneck**, average lead time, total produced /
scrapped, and blocked / starved % per station — plus a live throughput chart.

Color code: **green** = running, **yellow** = idle/starved, **red** =
blocked/bottleneck, **purple** = broken down.

## Design notes

### Engine
- **Fixed time step.** The clock counts **minutes**; each tick advances `dt`
  (default 0.1 min). Rates are entered in **units/hour**, times in **minutes**.
- **Seeded RNG** (mulberry32) drives scrap and breakdowns, so a given seed
  produces a byte-for-byte reproducible run.
- **Starving and blocking are modeled explicitly.** A machine is *starved* when
  idle with no input; *blocked* when it has finished a batch but every outgoing
  arrow is full because the downstream input buffer is full. Backpressure
  propagates upstream through arrows' finite in-transit capacity — this is the
  whole point of the simulation.
- Runtime state is kept separate from the serializable model, so config edits
  apply live and only the config is ever saved/exported.

### Edit-while-running policy (chosen behavior)
**Structural edits** (adding/deleting a node or arrow) **auto-pause** the run so
the model and runtime never disagree mid-tick — press Play to resume.
**Parameter edits** (process time, machine count, arrival rate, …) apply **live
on the next tick** without pausing.

## Presets, saving & sharing

- Three presets ship in the toolbar: **Bottleneck line** (the 3-station demo),
  **Simple line**, and a **Packaging line** (buffer + scrap + changeover + random
  breakdowns).
- **Save / Load** persist to `localStorage`; the app also auto-saves periodically.
- **Export / Import** read and write the full config (nodes, arrows, all
  parameters, run settings) as JSON.

## Console testing

The engine is usable headlessly. In the browser console (or Node, with
`global.window = globalThis; require('./engine.js')`):

```js
const m = ProdSim.presets.bottleneck();
const e = new ProdSim.Engine(m);
for (let i = 0; i < 6000; i++) e.step();   // 600 sim-minutes
console.log(e.metrics());                  // throughput, WIP, lead time, bottleneck
```

`window.model`, `window.engine`, and `window.view` are exposed in the running app
for live inspection.
