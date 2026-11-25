/*
 * Core tests. Run with either:
 *   node tests/run.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/run.js   (macOS, from repo root)
 */
/* global load, print */
var Core, Gen;
if (typeof module === 'object' && typeof require === 'function') {
  Core = require('../src/core/solver.js');
  Gen = require('../src/core/generator.js');
} else {
  load('src/core/solver.js');
  load('src/core/generator.js');
  Core = this.SudokuCore;
  Gen = this.SudokuGenerator;
}
var log = typeof console !== 'undefined' && console.log ? console.log.bind(console) : print;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; log('  ok   ' + name); }
  catch (e) { failed++; log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' expected ' + b + ', got ' + a); }
function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }

function isValidSolution(sol, puzzle) {
  if (!sol || sol.length !== 81) return false;
  for (var i = 0; i < 81; i++) {
    if (sol[i] < 1 || sol[i] > 9) return false;
    if (puzzle && puzzle[i] && puzzle[i] !== sol[i]) return false;
  }
  return Core.findConflicts(sol).length === 0;
}

// The original README example.
var ORIGINAL =
  '945......' + '.8...3...' + '....2..1.' +
  '5.3..29..' + '..93.64..' + '..79..8.3' +
  '.7..4....' + '...1...9.' + '......746';
// Arto Inkala's "world's hardest sudoku".
var INKALA = '8..........36......7..9.2...5...7.......457.....1...3...1....68..85...1..9....4..';
// Norvig's top95 #1 — needs search.
var PLATINUM = '4.....8.5.3..........7......2.....6.....8.4......1.......6.3.7.5..2.....1.4......';
// 17-clue puzzle.
var SEVENTEEN = '000000010400000000020000000000050407008000300001090000300400200050100000000806000';

log('solver');
[['original example', ORIGINAL], ['inkala', INKALA], ['norvig top95 #1', PLATINUM], ['17 clues', SEVENTEEN]]
  .forEach(function (p) {
    test('solves ' + p[0] + ' uniquely', function () {
      var g = Core.toGrid(p[1]);
      var r = Core.solve(g, { limit: 2 });
      eq(r.status, 'solved', 'status');
      eq(r.unique, true, 'unique');
      ok(isValidSolution(r.solution, g), 'valid solution');
      log('       ' + r.ms.toFixed(1) + ' ms, nodes ' + r.stats.nodes + ', guesses ' + r.stats.guesses);
    });
  });

test('trace covers every empty cell exactly once, in a replayable order', function () {
  var g = Core.toGrid(INKALA);
  var r = Core.solve(g);
  var empty = 0, i;
  for (i = 0; i < 81; i++) if (!g[i]) empty++;
  eq(r.trace.length, empty, 'trace length');
  var seen = {};
  r.trace.forEach(function (t) { ok(!seen[t.cell], 'dup cell'); seen[t.cell] = 1; eq(r.solution[t.cell], t.digit); });
});

test('empty grid -> multiple', function () {
  eq(Core.solve(new Uint8Array(81), { limit: 2 }).status, 'multiple');
});

test('duplicate givens -> invalid with conflict cells', function () {
  var g = Core.toGrid(ORIGINAL);
  g[8] = 9; // second 9 in row 1
  var r = Core.solve(g);
  eq(r.status, 'invalid');
  ok(r.conflicts.indexOf(0) >= 0 && r.conflicts.indexOf(8) >= 0, 'conflicts reported');
});

test('consistent-looking but unsolvable grid -> unsolvable', function () {
  // Row 1 needs a 9 in C9, but column 9 already has one.
  var g = Core.toGrid('12345678.' + '........9' + '.'.repeat(63));
  eq(Core.solve(g).status, 'unsolvable');
});

test('removing a clue from a unique puzzle can create multiple solutions', function () {
  var g = Core.toGrid(SEVENTEEN); // 17-clue puzzles are minimal
  for (var i = 0; i < 81; i++) if (g[i]) { g[i] = 0; break; }
  eq(Core.countSolutions(g, 2), 2);
});

test('parser accepts dots, zeros and ascii-art grids', function () {
  var art = ORIGINAL.match(/.{9}/g).map(function (r) { return '|' + r.slice(0, 3) + '|' + r.slice(3, 6) + '|' + r.slice(6) + '|'; }).join('\n');
  eq(Core.toString(Core.toGrid(art)), ORIGINAL);
  eq(Core.toString(Core.toGrid(ORIGINAL.replace(/\./g, '0'))), ORIGINAL);
});

test('nextStep gives a correct logical placement', function () {
  var g = Core.toGrid(ORIGINAL);
  var sol = Core.solve(g).solution;
  var steps = 0;
  for (;;) {
    var s = Core.nextStep(g);
    if (!s) break;
    eq(sol[s.cell], s.digit, s.text);
    g[s.cell] = s.digit;
    steps++;
  }
  ok(steps > 0, 'made progress');
});

test('grade separates logic tiers', function () {
  eq(Core.grade(ORIGINAL).tier <= 2, true);
  eq(Core.grade(INKALA).tier, 3);
});

log('generator');
['easy', 'medium', 'hard', 'expert'].forEach(function (d) {
  test('generates ' + d, function () {
    for (var seed = 1; seed <= 3; seed++) {
      var p = Gen.generate(d, { seed: seed * 7919 });
      eq(Core.countSolutions(p.puzzle, 2), 1, 'unique');
      ok(isValidSolution(p.solution, p.puzzle), 'solution matches');
      var tier = Core.grade(p.puzzle).tier;
      log('       seed ' + seed + ': ' + p.clues + ' clues, tier ' + tier + ', ' + p.attempts + ' attempt(s), ' + p.ms + ' ms');
      ok(tier >= Gen.PRESETS[d].tier || d === 'expert', 'tier ' + tier);
      if (d === 'easy' || d === 'medium') eq(tier, 1, 'singles only');
    }
  });
});

test('same seed -> same puzzle', function () {
  eq(Core.toString(Gen.generate('medium', { seed: 42 }).puzzle), Core.toString(Gen.generate('medium', { seed: 42 }).puzzle));
});

log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed && typeof process !== 'undefined') process.exit(1);
