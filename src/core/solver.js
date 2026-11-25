/*
 * Sudoku core solver
 * ------------------
 * Pencil-and-paper constraint propagation + depth-first search.
 *
 *   1. Every empty cell keeps a 9-bit mask of pencil marks (candidates).
 *   2. Placing a digit erases it from the pencil marks of the cell's 20 peers.
 *   3. Logical rules are applied until nothing changes:
 *        - naked single     : a cell has exactly one candidate
 *        - hidden single    : a digit fits in exactly one cell of a row/column/box
 *        - locked candidates: pointing / claiming (box <-> line interactions)
 *        - naked pair       : two cells of a unit share the same two candidates
 *   4. If the grid is still open, branch on the cell with the fewest candidates
 *      (MRV heuristic), trying each candidate on a *copy* of the state, and
 *      recurse. Contradictions prune a branch immediately.
 *
 * Works in the browser (window.SudokuCore) and in Node/JSC (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SudokuCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- geometry
  const ALL = 0x1ff; // candidates 1..9 -> bits 0..8
  const ROW = new Uint8Array(81);
  const COL = new Uint8Array(81);
  const BOX = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    ROW[i] = (i / 9) | 0;
    COL[i] = i % 9;
    BOX[i] = ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0);
  }

  // UNITS[0..8] rows, [9..17] columns, [18..26] boxes
  const UNITS = [];
  for (let u = 0; u < 27; u++) UNITS.push([]);
  for (let i = 0; i < 81; i++) {
    UNITS[ROW[i]].push(i);
    UNITS[9 + COL[i]].push(i);
    UNITS[18 + BOX[i]].push(i);
  }
  const UNIT_KIND = ['row', 'column', 'box'];

  const PEERS = [];
  for (let i = 0; i < 81; i++) {
    const set = new Set([...UNITS[ROW[i]], ...UNITS[9 + COL[i]], ...UNITS[18 + BOX[i]]]);
    set.delete(i);
    PEERS.push(Int8Array.from(set));
  }

  const POP = new Uint8Array(512); // popcount
  const BIT_DIGIT = new Uint8Array(512); // single bit -> digit
  for (let m = 1; m < 512; m++) POP[m] = POP[m >> 1] + (m & 1);
  for (let d = 1; d <= 9; d++) BIT_DIGIT[1 << (d - 1)] = d;

  const bit = (d) => 1 << (d - 1);
  function digitsOf(mask) {
    const out = [];
    for (let d = 1; d <= 9; d++) if (mask & bit(d)) out.push(d);
    return out;
  }

  const now = () =>
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

  // ---------------------------------------------------------------- parsing
  /** Accepts a string ("53..7....", 0/./_/* = empty) or an array / 9x9 array. */
  function toGrid(input) {
    if (typeof input === 'string') {
      const chars = input.replace(/[^0-9._*]/g, '');
      if (chars.length !== 81) throw new Error('Expected 81 cells, got ' + chars.length);
      const g = new Uint8Array(81);
      for (let i = 0; i < 81; i++) {
        const c = chars.charCodeAt(i) - 48;
        g[i] = c >= 1 && c <= 9 ? c : 0;
      }
      return g;
    }
    const flat = Array.isArray(input) && Array.isArray(input[0]) ? input.flat() : Array.from(input);
    if (flat.length !== 81) throw new Error('Expected 81 cells, got ' + flat.length);
    const g = new Uint8Array(81);
    for (let i = 0; i < 81; i++) {
      const v = Number(flat[i]) | 0;
      if (v < 0 || v > 9) throw new Error('Cell ' + i + ' out of range: ' + flat[i]);
      g[i] = v;
    }
    return g;
  }

  function toString(grid, empty = '.') {
    let s = '';
    for (let i = 0; i < 81; i++) s += grid[i] ? grid[i] : empty;
    return s;
  }

  /** Cells whose digit is duplicated in some row, column or box. */
  function findConflicts(grid) {
    const bad = new Set();
    for (const unit of UNITS) {
      const seen = new Array(10).fill(-1);
      for (const c of unit) {
        const v = grid[c];
        if (!v) continue;
        if (seen[v] >= 0) {
          bad.add(c);
          bad.add(seen[v]);
        } else seen[v] = c;
      }
    }
    return Array.from(bad).sort((a, b) => a - b);
  }

  /** Plain pencil marks: digits not yet used by any peer (no deductions). */
  function candidates(grid) {
    const out = new Uint16Array(81);
    for (let i = 0; i < 81; i++) {
      if (grid[i]) continue;
      let m = ALL;
      const peers = PEERS[i];
      for (let k = 0; k < 20; k++) if (grid[peers[k]]) m &= ~bit(grid[peers[k]]);
      out[i] = m;
    }
    return out;
  }

  // ---------------------------------------------------------------- state
  class State {
    constructor(src) {
      if (src) {
        this.values = src.values.slice();
        this.cand = src.cand.slice();
        this.empty = src.empty;
        this.trace = src.trace ? src.trace.slice() : null;
      } else {
        this.values = new Uint8Array(81);
        this.cand = new Uint16Array(81).fill(ALL);
        this.empty = 81;
        this.trace = null;
      }
    }
    clone() {
      return new State(this);
    }
  }

  function newStats() {
    return {
      nodes: 0, // search nodes visited
      guesses: 0, // branches tried
      deadEnds: 0, // branches that hit a contradiction
      maxDepth: 0,
      naked: 0,
      hidden: 0,
      pointing: 0,
      claiming: 0,
      pairs: 0,
    };
  }

  /** Place digit d in cell; erase it from peers. Returns false on contradiction. */
  function assign(s, cell, d, how) {
    if (s.values[cell]) return s.values[cell] === d;
    const b = bit(d);
    if (!(s.cand[cell] & b)) return false;
    s.values[cell] = d;
    s.cand[cell] = 0;
    s.empty--;
    if (s.trace && how) s.trace.push({ cell, digit: d, how });
    const peers = PEERS[cell];
    for (let k = 0; k < 20; k++) {
      const p = peers[k];
      if (s.values[p] === 0 && s.cand[p] & b) {
        s.cand[p] &= ~b;
        if (s.cand[p] === 0) return false;
      }
    }
    return true;
  }

  const HIDDEN_HOW = ['hidden-row', 'hidden-col', 'hidden-box'];

  /** Naked + hidden singles until stable. */
  function singles(s, st) {
    let progress = true;
    while (progress && s.empty > 0) {
      progress = false;

      for (let i = 0; i < 81; i++) {
        if (s.values[i]) continue;
        const m = s.cand[i];
        if (m === 0) return false;
        if (POP[m] === 1) {
          if (!assign(s, i, BIT_DIGIT[m], 'naked')) return false;
          st.naked++;
          progress = true;
        }
      }

      for (let u = 0; u < 27; u++) {
        const cells = UNITS[u];
        let once = 0, twice = 0, placed = 0;
        for (let k = 0; k < 9; k++) {
          const c = cells[k];
          const v = s.values[c];
          if (v) placed |= bit(v);
          else {
            const m = s.cand[c];
            twice |= once & m;
            once |= m;
          }
        }
        if ((once | placed) !== ALL) return false; // some digit has nowhere to go
        let uniq = once & ~twice & ~placed;
        while (uniq) {
          const b = uniq & -uniq;
          uniq ^= b;
          let found = false;
          for (let k = 0; k < 9; k++) {
            const c = cells[k];
            if (!s.values[c] && s.cand[c] & b) {
              if (!assign(s, c, BIT_DIGIT[b], HIDDEN_HOW[(u / 9) | 0])) return false;
              st.hidden++;
              progress = true;
              found = true;
              break;
            }
          }
          if (!found) return false; // its only cell was taken by another digit
        }
      }
    }
    return true;
  }

  /** Remove bit b from cell c. Returns -1 contradiction, 1 changed, 0 untouched. */
  function strike(s, c, b) {
    if (s.values[c] || !(s.cand[c] & b)) return 0;
    s.cand[c] &= ~b;
    return s.cand[c] === 0 ? -1 : 1;
  }

  /** Candidate eliminations: locked candidates + naked pairs. -1 / 0 / 1. */
  function eliminate(s, st) {
    let progress = 0;

    // Pointing: inside a box, digit confined to one row/col -> clear rest of that line.
    for (let bx = 0; bx < 9; bx++) {
      const box = UNITS[18 + bx];
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        let rows = 0, cols = 0;
        for (let k = 0; k < 9; k++) {
          const c = box[k];
          if (!s.values[c] && s.cand[c] & b) {
            rows |= 1 << ROW[c];
            cols |= 1 << COL[c];
          }
        }
        if (!rows) continue;
        for (const [mask, base] of [[rows, 0], [cols, 9]]) {
          if (POP[mask] !== 1) continue;
          let hit = false;
          for (const c of UNITS[base + BIT_DIGIT[mask] - 1]) {
            if (BOX[c] === bx) continue;
            const r = strike(s, c, b);
            if (r < 0) return -1;
            if (r) hit = true;
          }
          if (hit) { st.pointing++; progress = 1; }
        }
      }
    }

    // Claiming: inside a line, digit confined to one box -> clear rest of that box.
    for (let u = 0; u < 18; u++) {
      const line = UNITS[u];
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        let boxes = 0;
        for (let k = 0; k < 9; k++) {
          const c = line[k];
          if (!s.values[c] && s.cand[c] & b) boxes |= 1 << BOX[line[k]];
        }
        if (POP[boxes] !== 1) continue;
        const bx = BIT_DIGIT[boxes] - 1;
        let hit = false;
        for (const c of UNITS[18 + bx]) {
          if ((u < 9 ? ROW[c] : 9 + COL[c]) === u) continue;
          const r = strike(s, c, b);
          if (r < 0) return -1;
          if (r) hit = true;
        }
        if (hit) { st.claiming++; progress = 1; }
      }
    }

    // Naked pairs.
    for (let u = 0; u < 27; u++) {
      const cells = UNITS[u];
      for (let i = 0; i < 9; i++) {
        const ci = cells[i];
        const m = s.cand[ci];
        if (s.values[ci] || POP[m] !== 2) continue;
        for (let j = i + 1; j < 9; j++) {
          const cj = cells[j];
          if (s.values[cj] || s.cand[cj] !== m) continue;
          let hit = false;
          for (let k = 0; k < 9; k++) {
            const ck = cells[k];
            if (ck === ci || ck === cj || s.values[ck] || !(s.cand[ck] & m)) continue;
            s.cand[ck] &= ~m;
            if (s.cand[ck] === 0) return -1;
            hit = true;
          }
          if (hit) { st.pairs++; progress = 1; }
        }
      }
    }
    return progress;
  }

  /**
   * Apply logic until stable. level 1 = singles only, level 2 = + eliminations.
   * Returns false if the position is contradictory.
   */
  function propagate(s, level, st) {
    for (;;) {
      if (!singles(s, st)) return false;
      if (s.empty === 0 || level < 2) return true;
      const r = eliminate(s, st);
      if (r < 0) return false;
      if (r === 0) return true;
    }
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Depth-first search. Returns true when the caller should stop. */
  function search(s, opt, ctx, depth) {
    const st = ctx.stats;
    st.nodes++;
    if (depth > st.maxDepth) st.maxDepth = depth;
    if (!propagate(s, opt.level, st)) { st.deadEnds++; return false; }
    if (s.empty === 0) {
      ctx.count++;
      if (!ctx.first) ctx.first = s;
      return ctx.count >= opt.limit;
    }

    // MRV: branch on the cell with the fewest candidates.
    let best = -1, bestPop = 10;
    for (let i = 0; i < 81; i++) {
      if (s.values[i]) continue;
      const p = POP[s.cand[i]];
      if (p < bestPop) { bestPop = p; best = i; if (p === 2) break; }
    }

    const ds = digitsOf(s.cand[best]);
    if (opt.rng) shuffle(ds, opt.rng);
    for (const d of ds) {
      const child = s.clone();
      st.guesses++;
      if (assign(child, best, d, 'guess')) {
        if (search(child, opt, ctx, depth + 1)) return true;
      } else st.deadEnds++;
    }
    return false;
  }

  function stateFrom(grid, withTrace) {
    const s = new State();
    if (withTrace) s.trace = [];
    for (let i = 0; i < 81; i++) if (grid[i] && !assign(s, i, grid[i], null)) return null;
    return s;
  }

  /**
   * Solve a puzzle.
   * options: limit   (stop after N solutions; 2 = uniqueness check)   default 1
   *          level   (1 = singles, 2 = + eliminations)                default 2
   *          rng     (randomise branch order, used by the generator)
   *          trace   (record placement order + technique)            default true
   * status: 'solved' | 'multiple' | 'unsolvable' | 'invalid'
   */
  function solve(input, options = {}) {
    const t0 = now();
    const grid = toGrid(input);
    const limit = options.limit || 1;
    const opt = { limit, level: options.level || 2, rng: options.rng || null };
    const ctx = { count: 0, first: null, stats: newStats() };
    const conflicts = findConflicts(grid);

    let status;
    if (conflicts.length) status = 'invalid';
    else {
      const s = stateFrom(grid, options.trace !== false);
      if (s) search(s, opt, ctx, 0);
      status = ctx.count === 0 ? 'unsolvable' : ctx.count > 1 ? 'multiple' : 'solved';
    }
    return {
      status,
      solution: ctx.first ? Array.from(ctx.first.values) : null,
      trace: ctx.first && ctx.first.trace ? ctx.first.trace : [],
      count: ctx.count,
      unique: limit >= 2 ? ctx.count === 1 : undefined,
      conflicts,
      stats: ctx.stats,
      ms: now() - t0,
    };
  }

  /** Number of solutions, capped at `limit` (0 for invalid grids). */
  function countSolutions(input, limit = 2) {
    return solve(input, { limit, trace: false }).count;
  }

  /** Pure logic, no guessing. */
  function logicSolve(input, level = 2) {
    const grid = toGrid(input);
    const st = newStats();
    if (findConflicts(grid).length) return { solved: false, valid: false, values: grid, stats: st };
    const s = stateFrom(grid, false);
    const ok = s ? propagate(s, level, st) : false;
    return { solved: ok && s.empty === 0, valid: ok, values: s ? Array.from(s.values) : grid, stats: st };
  }

  /**
   * Difficulty tier:
   *   1 - singles only, 2 - needs locked candidates / pairs, 3 - needs guessing.
   */
  function grade(input) {
    const grid = toGrid(input);
    let clues = 0;
    for (let i = 0; i < 81; i++) if (grid[i]) clues++;
    const l1 = logicSolve(grid, 1);
    if (l1.solved) return { tier: 1, clues, stats: l1.stats };
    const l2 = logicSolve(grid, 2);
    if (l2.solved) return { tier: 2, clues, stats: l2.stats };
    const r = solve(grid, { trace: false });
    return { tier: 3, clues, stats: r.stats };
  }

  const cellName = (c) => 'R' + (ROW[c] + 1) + 'C' + (COL[c] + 1);

  /**
   * Next human-style step from the current grid (plain pencil marks).
   * Returns { cell, digit, technique, text } or null if no single exists.
   */
  function nextStep(input) {
    const grid = toGrid(input);
    const cand = candidates(grid);
    for (let i = 0; i < 81; i++) {
      if (!grid[i] && POP[cand[i]] === 1) {
        const d = BIT_DIGIT[cand[i]];
        return {
          cell: i, digit: d, technique: 'naked',
          text: 'Naked single: ' + cellName(i) + ' can only be ' + d +
            ' — every other digit already appears in its row, column or box.',
        };
      }
    }
    for (let u = 0; u < 27; u++) {
      for (let d = 1; d <= 9; d++) {
        const b = bit(d);
        let spot = -1, n = 0, placed = false;
        for (const c of UNITS[u]) {
          if (grid[c] === d) { placed = true; break; }
          if (!grid[c] && cand[c] & b) { n++; spot = c; }
        }
        if (!placed && n === 1) {
          const kind = UNIT_KIND[(u / 9) | 0];
          return {
            cell: spot, digit: d, technique: 'hidden-' + kind,
            text: 'Hidden single: ' + d + ' fits in only one cell of this ' + kind + ' — ' + cellName(spot) + '.',
          };
        }
      }
    }
    return null;
  }

  /** Seedable PRNG (mulberry32). */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return {
    ROW, COL, BOX, UNITS, PEERS, ALL,
    bit, digitsOf, popcount: (m) => POP[m],
    toGrid, toString, findConflicts, candidates,
    solve, countSolutions, logicSolve, grade, nextStep,
    cellName, shuffle, rng,
  };
});
