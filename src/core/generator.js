/*
 * Sudoku puzzle generator — built entirely on SudokuCore.
 *
 *   1. Fill an empty grid with the solver, branching in random order
 *      -> a random complete solution.
 *   2. Carve: remove clues in 180°-symmetric pairs (random order). A removal is
 *      kept only if the puzzle still meets the difficulty's rule:
 *        easy / medium : still solvable with singles alone
 *        hard          : still solvable with singles + eliminations
 *        expert        : still has exactly one solution (search allowed)
 *      Solving with pure logic implies a unique solution, so the cheaper logic
 *      check doubles as the uniqueness check for the first three tiers.
 *   3. Grade the result and retry until it lands in the requested tier.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./solver.js'));
  else root.SudokuGenerator = factory(root.SudokuCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const PRESETS = {
    easy:   { tier: 1, clues: [36, 40], minTier: 1, attempts: 6 },
    medium: { tier: 1, clues: [28, 32], minTier: 1, attempts: 6 },
    hard:   { tier: 2, clues: [22, 26], minTier: 2, attempts: 40 },
    expert: { tier: 3, clues: [17, 17], minTier: 3, attempts: 60 },
  };

  function randomSolution(rng) {
    return Core.solve(new Uint8Array(81), { rng, trace: false }).solution;
  }

  function keeps(puzzle, tier) {
    if (tier === 3) return Core.countSolutions(puzzle, 2) === 1;
    return Core.logicSolve(puzzle, tier).solved;
  }

  function carve(solution, preset, rng) {
    const puzzle = Uint8Array.from(solution);
    const [lo, hi] = preset.clues;
    const target = lo + Math.floor(rng() * (hi - lo + 1));
    const order = Core.shuffle(Array.from({ length: 41 }, (_, i) => i), rng);
    let clues = 81;
    for (const i of order) {
      if (clues <= target) break;
      const j = 80 - i;
      const a = puzzle[i], b = puzzle[j];
      puzzle[i] = 0;
      puzzle[j] = 0;
      if (keeps(puzzle, preset.tier)) clues -= i === j ? 1 : 2;
      else { puzzle[i] = a; puzzle[j] = b; }
    }
    return puzzle;
  }

  /**
   * generate('easy' | 'medium' | 'hard' | 'expert', { rng?, seed? })
   * -> { puzzle, solution, difficulty, clues, tier, attempts, ms }
   */
  function generate(difficulty = 'medium', options = {}) {
    const preset = PRESETS[difficulty] || PRESETS.medium;
    const rng = options.rng || (options.seed != null ? Core.rng(options.seed) : Math.random);
    const t0 = Date.now();
    let best = null;

    for (let attempt = 1; attempt <= preset.attempts; attempt++) {
      const solution = randomSolution(rng);
      const puzzle = carve(solution, preset, rng);
      const g = Core.grade(puzzle);
      const cand = { puzzle, solution, difficulty, clues: g.clues, tier: g.tier, guesses: g.stats.guesses, attempts: attempt };
      if (g.tier >= preset.minTier) { best = cand; break; }
      if (!best || cand.tier > best.tier || (cand.tier === best.tier && cand.clues < best.clues)) best = cand;
    }
    best.ms = Date.now() - t0;
    best.puzzle = Array.from(best.puzzle);
    return best;
  }

  /** Map a grade to a human label (used for custom puzzles). */
  function labelFor(g) {
    if (g.tier === 3) return 'Expert';
    if (g.tier === 2) return 'Hard';
    return g.clues >= 34 ? 'Easy' : 'Medium';
  }

  return { generate, labelFor, PRESETS };
});
