/*
 * Sudoku UI — play, create, hint and auto-solve on top of SudokuCore.
 * Plain script (no modules) so index.html works straight from file://.
 */
(function () {
  'use strict';

  const Core = window.SudokuCore;
  const Gen = window.SudokuGenerator;
  const { ROW, COL, BOX, PEERS } = Core;

  const $ = (sel) => document.querySelector(sel);
  const STORE = 'sudoku.v2';
  const LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
  const TECH = { logic: 1, guess: 2 };

  // ------------------------------------------------------------------ state
  const play = {
    givens: new Uint8Array(81),
    values: new Uint8Array(81),
    notes: new Uint16Array(81),
    tech: new Uint8Array(81),
    solution: null,
    label: 'Medium',
    elapsed: 0,
    hints: 0,
    status: 'empty', // empty | playing | won | solved
    undo: [],
    redo: [],
  };
  const draft = {
    values: new Uint8Array(81),
    overlay: new Uint8Array(81), // solver result shown on top of the givens
    tech: new Uint8Array(81),
    undo: [],
    redo: [],
    unique: false,
  };
  const ui = {
    mode: 'play',
    difficulty: 'medium',
    selected: 40,
    notesMode: false,
    wrong: new Set(),
    hinted: -1,
    anim: null,
    busy: false,
  };

  // ------------------------------------------------------------------ dom
  const boardEl = $('#board');
  const padEl = $('#pad');
  const cells = new Array(81);
  const padBtns = [];

  function buildBoard() {
    for (let b = 0; b < 9; b++) {
      const box = document.createElement('div');
      box.className = 'box';
      for (let k = 0; k < 9; k++) {
        const r = ((b / 3) | 0) * 3 + ((k / 3) | 0);
        const c = (b % 3) * 3 + (k % 3);
        const i = r * 9 + c;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'cell';
        el.dataset.i = i;
        el.style.setProperty('--d', r + c);
        el.setAttribute('role', 'gridcell');
        el.tabIndex = -1;
        el.innerHTML = '<span class="v"></span><span class="notes">' +
          '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
        el.addEventListener('animationend', (e) => {
          if (e.animationName === 'pop') { el.classList.remove('pop'); el.dataset.pop = ''; }
        });
        cells[i] = el;
        box.appendChild(el);
      }
      boardEl.appendChild(box);
    }
    boardEl.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.cell');
      if (!el) return;
      if (ui.anim) { finishAnimation(); return; }
      select(+el.dataset.i);
    });
  }

  function buildPad() {
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = d + '<small></small>';
      b.addEventListener('click', () => input(d, false));
      padEl.appendChild(b);
      padBtns.push(b);
    }
  }

  // ------------------------------------------------------------------ helpers
  const cur = () => (ui.mode === 'play' ? play : draft);
  const fmtTime = (s) => {
    const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, sec = s % 60;
    const mm = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    return h ? h + ':' + mm : mm;
  };
  const countClues = (g) => g.reduce((n, v) => n + (v ? 1 : 0), 0);
  const isPeer = (a, b) => ROW[a] === ROW[b] || COL[a] === COL[b] || BOX[a] === BOX[b];
  const shownValue = (i) => (ui.mode === 'play' ? play.values[i] : draft.values[i] || draft.overlay[i]);

  let toastTimer = 0;
  const TERM_LINKS = {
    naked: 'What is a naked single?', hidden: 'What is a hidden single?', search: 'How does guessing work?',
  };
  function toast(msg, isErr, term) {
    const el = $('#toast');
    el.textContent = msg;
    if (term) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link toast-link';
      b.dataset.guide = term;
      b.textContent = TERM_LINKS[term];
      el.append(' ', b);
    }
    el.classList.toggle('err', !!isErr);
    el.classList.remove('hide');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hide'), 6000);
  }

  function popCell(i) {
    const el = cells[i];
    el.classList.remove('pop');
    void el.offsetWidth; // restart the animation
    el.dataset.pop = '1';
    el.classList.add('pop');
  }

  // ------------------------------------------------------------------ render
  function render() {
    const m = ui.mode;
    const sel = ui.selected;
    const selVal = shownValue(sel);
    const vals = m === 'play' ? play.values : draft.values;
    const conflicts = new Set(Core.findConflicts(vals));
    const tech = cur().tech;

    for (let i = 0; i < 81; i++) {
      const el = cells[i];
      let v = vals[i];
      let overlay = false;
      if (!v && m === 'create' && draft.overlay[i]) { v = draft.overlay[i]; overlay = true; }
      const given = m === 'play' ? play.givens[i] !== 0 : !!draft.values[i];

      let cls = 'cell';
      if (given) cls += ' given';
      if (overlay) cls += ' overlay';
      if (i === sel) cls += ' selected';
      else if (selVal && v === selVal) cls += ' same';
      else if (isPeer(i, sel)) cls += ' peer';
      if (conflicts.has(i)) cls += ' conflict';
      if (m === 'play' && ui.wrong.has(i)) cls += ' wrong';
      if (i === ui.hinted) cls += ' hinted';
      if (!given && v && tech[i] === TECH.logic) cls += ' t-logic';
      if (!given && v && tech[i] === TECH.guess) cls += ' t-guess';
      if (el.dataset.pop === '1') cls += ' pop';
      if (el.className !== cls) el.className = cls;

      el.firstChild.textContent = v || '';
      const notes = m === 'play' && !v ? play.notes[i] : 0;
      const ns = el.lastChild.children;
      for (let d = 1; d <= 9; d++) {
        const on = notes & (1 << (d - 1));
        ns[d - 1].textContent = on ? d : '';
        ns[d - 1].className = on && d === selVal ? 'hl' : '';
      }
      el.setAttribute('aria-label', Core.cellName(i) + (v ? ' ' + v : ' empty'));
    }

    // pad
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) counts[shownValue(i)]++;
    const locked = m === 'play' && play.status !== 'playing';
    for (let d = 1; d <= 9; d++) {
      const b = padBtns[d - 1];
      b.disabled = !!ui.anim || locked || (m === 'play' && !ui.notesMode && counts[d] >= 9);
      b.classList.toggle('active', d === selVal);
      b.lastChild.textContent = m === 'play' ? (9 - counts[d] > 0 ? 9 - counts[d] : '') : counts[d] || '';
    }

    // tools
    const st = cur();
    setDisabled('undo', !st.undo.length || !!ui.anim || locked);
    setDisabled('redo', !st.redo.length || !!ui.anim || locked);
    setDisabled('erase', !!ui.anim || locked);
    ['notes', 'autonotes', 'hint', 'check'].forEach((a) => setDisabled(a, !!ui.anim || play.status !== 'playing'));
    setDisabled('restart', !!ui.anim || play.status === 'empty');
    setDisabled('clear', !!ui.anim || !countClues(draft.values));
    setDisabled('play', !!ui.anim || !draft.unique);
    setDisabled('new', ui.busy);
    const solveBtn = $('.btn[data-act="solve"]');
    solveBtn.classList.toggle('running', !!ui.anim);
    solveBtn.lastChild.textContent = ui.anim ? 'Skip' : 'Auto-solve';

    document.body.classList.toggle('notes-on', ui.notesMode && m === 'play');
    $('#notesFlag').textContent = ui.notesMode ? 'on' : 'off';

    // meta + progress
    const filled = m === 'play' ? countClues(play.values) : countClues(draft.values);
    if (m === 'play') {
      $('#metaLabel').innerHTML = escapeHtml(play.label) + '<small>' + countClues(play.givens) + ' clues</small>';
      $('#progressBar').style.width = (play.status === 'empty' ? 0 : (filled / 81) * 100) + '%';
    } else {
      $('#metaLabel').innerHTML = 'Draft<small>' + filled + ' givens</small>';
      $('#progressBar').style.width = (countClues(draft.values) + countClues(draft.overlay)) / 81 * 100 + '%';
    }
    renderTimer();
  }

  function setDisabled(act, v) {
    document.querySelectorAll('[data-act="' + act + '"]').forEach((b) => { b.disabled = v; });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function renderTimer() {
    const t = $('#timer');
    if (ui.mode === 'create') { t.textContent = '—'; return; }
    t.textContent = fmtTime(play.elapsed);
    t.classList.toggle('paused', play.status !== 'playing');
  }

  // ------------------------------------------------------------------ editing
  function snapshot(st) {
    st.undo.push({ values: st.values.slice(), notes: st.notes ? st.notes.slice() : null });
    if (st.undo.length > 300) st.undo.shift();
    st.redo.length = 0;
  }
  function restore(st, from, to) {
    const snap = from.pop();
    if (!snap) return;
    to.push({ values: st.values.slice(), notes: st.notes ? st.notes.slice() : null });
    st.values.set(snap.values);
    if (st.notes && snap.notes) st.notes.set(snap.notes);
    afterChange();
  }

  function select(i) {
    ui.selected = Math.max(0, Math.min(80, i));
    render();
  }

  function input(d, asNote) {
    if (ui.anim || ui.busy) return;
    const i = ui.selected;
    if (ui.mode === 'create') {
      snapshot(draft);
      draft.values[i] = draft.values[i] === d ? 0 : d;
      clearOverlay();
      popCell(i);
      afterChange();
      return;
    }
    if (play.status !== 'playing' || play.givens[i]) return;
    if (asNote || ui.notesMode) {
      if (play.values[i]) return;
      snapshot(play);
      play.notes[i] ^= 1 << (d - 1);
      afterChange();
      return;
    }
    snapshot(play);
    placeDigit(i, play.values[i] === d ? 0 : d);
    if (play.values[i]) popCell(i);
    afterChange();
  }

  function placeDigit(i, d) {
    play.values[i] = d;
    play.notes[i] = 0;
    play.tech[i] = 0;
    ui.wrong.delete(i);
    if (d) {
      const b = 1 << (d - 1);
      for (const p of PEERS[i]) play.notes[p] &= ~b;
    }
  }

  function erase() {
    if (ui.anim) return;
    const i = ui.selected;
    if (ui.mode === 'create') {
      if (!draft.values[i]) return;
      snapshot(draft);
      draft.values[i] = 0;
      clearOverlay();
      afterChange();
      return;
    }
    if (play.status !== 'playing' || play.givens[i]) return;
    if (!play.values[i] && !play.notes[i]) return;
    snapshot(play);
    play.values[i] = 0;
    play.notes[i] = 0;
    ui.wrong.delete(i);
    afterChange();
  }

  function clearOverlay() {
    draft.overlay.fill(0);
    draft.tech.fill(0);
    $('#report').hidden = true;
  }

  function afterChange() {
    ui.hinted = -1;
    if (ui.mode === 'create') validateDraft();
    else checkWin();
    render();
    save();
  }

  // ------------------------------------------------------------------ play
  function loadPuzzle(puzzle, solution, label) {
    stopAnimation();
    play.givens.set(puzzle);
    play.values.set(puzzle);
    play.notes.fill(0);
    play.tech.fill(0);
    play.solution = solution ? Array.from(solution) : Core.solve(puzzle).solution;
    play.label = label;
    play.elapsed = 0;
    play.hints = 0;
    play.status = 'playing';
    play.undo.length = 0;
    play.redo.length = 0;
    ui.wrong.clear();
    ui.hinted = -1;
    ui.selected = play.givens.indexOf(0) >= 0 ? play.givens.indexOf(0) : 40;
    $('#win').hidden = true;
    $('#report').hidden = true;
  }

  function newGame() {
    if (ui.busy) return;
    stopAnimation();
    ui.busy = true;
    $('#busy').hidden = false;
    render();
    // let the spinner paint before the (short) synchronous generation
    setTimeout(() => {
      try {
        const g = Gen.generate(ui.difficulty);
        loadPuzzle(g.puzzle, g.solution, LABELS[ui.difficulty]);
        toast(LABELS[ui.difficulty] + ' puzzle · ' + g.clues + ' clues · unique solution.');
      } catch (err) {
        toast('Could not generate a puzzle: ' + err.message, true);
      } finally {
        ui.busy = false;
        $('#busy').hidden = true;
        setMode('play');
      }
    }, 40);
  }

  function restart() {
    if (play.status === 'empty') return;
    loadPuzzle(play.givens.slice(), play.solution, play.label);
    toast('Puzzle restarted.');
    render();
    save();
  }

  function checkWin() {
    if (play.status !== 'playing') return;
    for (let i = 0; i < 81; i++) if (!play.values[i]) return;
    if (Core.findConflicts(play.values).length) return;
    if (play.solution && play.values.some((v, i) => v !== play.solution[i])) return;
    play.status = 'won';
    showWin(true);
  }

  function showWin(animate) {
    $('#winTime').textContent = fmtTime(play.elapsed);
    $('#winSub').textContent = play.label + ' · ' +
      (play.hints ? play.hints + ' hint' + (play.hints > 1 ? 's' : '') : 'no hints');
    $('#win').hidden = false;
    if (animate) {
      boardEl.classList.remove('wave');
      void boardEl.offsetWidth;
      boardEl.classList.add('wave');
      setTimeout(() => boardEl.classList.remove('wave'), 1600);
    }
  }

  function wrongCells() {
    const out = [];
    if (!play.solution) return out;
    for (let i = 0; i < 81; i++) {
      if (!play.givens[i] && play.values[i] && play.values[i] !== play.solution[i]) out.push(i);
    }
    return out;
  }

  function check() {
    if (play.status !== 'playing') return;
    const wrong = wrongCells();
    ui.wrong = new Set(wrong);
    render();
    if (!wrong.length) toast('Everything so far is correct.');
    else toast(wrong.length + ' incorrect ' + (wrong.length > 1 ? 'entries' : 'entry') + ' marked.', true);
  }

  function hint() {
    if (play.status !== 'playing' || ui.anim) return;
    const wrong = wrongCells();
    if (wrong.length) {
      ui.wrong = new Set(wrong);
      ui.selected = wrong[0];
      render();
      toast(Core.cellName(wrong[0]) + ' is incorrect — fix the marked cells first.', true);
      return;
    }
    let step = Core.nextStep(play.values);
    let text, term = 'search';
    if (step) { text = step.text; term = step.technique === 'naked' ? 'naked' : 'hidden'; }
    else {
      // No single available: reveal the most constrained cell (the solver's branch point).
      const cand = Core.candidates(play.values);
      let best = -1, bp = 10;
      for (let i = 0; i < 81; i++) {
        if (play.values[i]) continue;
        const p = Core.popcount(cand[i]);
        if (p < bp) { bp = p; best = i; }
      }
      if (best < 0) return;
      step = { cell: best, digit: play.solution[best] };
      text = 'No single is available — revealed ' + Core.cellName(best) +
        ' (fewest candidates: ' + bp + '). Try pencil marks and look for locked candidates.';
    }
    snapshot(play);
    placeDigit(step.cell, step.digit);
    play.hints++;
    ui.selected = step.cell;
    popCell(step.cell);
    afterChange();
    ui.hinted = step.cell;
    render();
    toast(text, false, term);
  }

  function autoNotes() {
    if (play.status !== 'playing') return;
    snapshot(play);
    const cand = Core.candidates(play.values);
    for (let i = 0; i < 81; i++) play.notes[i] = play.values[i] ? 0 : cand[i];
    afterChange();
    toast('Pencil marks filled from the current grid.');
  }

  // ------------------------------------------------------------------ create
  function validateDraft() {
    const el = $('#createStatus');
    const g = draft.values;
    const n = countClues(g);
    let cls = '', msg;
    draft.unique = false;
    if (!n) msg = 'Enter the givens of your puzzle, or import one.';
    else if (Core.findConflicts(g).length) { cls = 'bad'; msg = 'Duplicate digits in a row, column or box (striped cells).'; }
    else {
      const r = Core.solve(g, { limit: 2, trace: false });
      if (r.status === 'unsolvable') { cls = 'bad'; msg = n + ' givens · no solution. These givens contradict each other.'; }
      else if (r.status === 'multiple') {
        cls = 'warn';
        msg = n + ' givens · more than one solution.' + (n < 17 ? ' A valid sudoku needs at least 17.' : ' Add givens to pin it down.');
      } else {
        const grade = Core.grade(g);
        cls = 'ok';
        msg = n + ' givens · unique solution · rated ' + Gen.labelFor(grade) + '.';
        draft.unique = true;
      }
    }
    el.className = 'create-status ' + cls;
    el.textContent = msg;
  }

  function playDraft() {
    if (!draft.unique) return;
    const g = draft.values.slice();
    const label = 'Custom · ' + Gen.labelFor(Core.grade(g));
    loadPuzzle(g, null, label);
    setMode('play');
    toast('Custom puzzle loaded. Good luck.');
  }

  function clearDraft() {
    if (!countClues(draft.values)) return;
    snapshot(draft);
    draft.values.fill(0);
    clearOverlay();
    afterChange();
  }

  // ------------------------------------------------------------------ auto-solve
  function autoSolve() {
    if (ui.anim) { finishAnimation(); return; }
    if (ui.busy) return;
    const create = ui.mode === 'create';
    const grid = create ? draft.values.slice() : play.givens.slice();
    if (!countClues(grid) && create) { toast('Enter some givens first.', true); return; }
    if (!create && play.status === 'empty') { toast('Start a game first.', true); return; }

    const r = Core.solve(grid);
    if (r.status === 'invalid') { toast('Cannot solve: duplicate digits in the givens.', true); return; }
    if (r.status === 'unsolvable') {
      showReport(r, null);
      toast('No solution exists — the solver exhausted every branch.', true);
      return;
    }
    const unique = Core.countSolutions(grid, 2) === 1;
    showReport(r, unique);

    if (create) {
      clearOverlay();
      $('#report').hidden = false;
    } else {
      snapshot(play);
      play.values.set(play.givens);
      play.notes.fill(0);
      play.tech.fill(0);
      ui.wrong.clear();
      play.status = 'solved';
      $('#win').hidden = true;
    }
    const st = cur();
    const target = create ? draft.overlay : play.values;
    animate(r.trace, (t) => {
      target[t.cell] = t.digit;
      st.tech[t.cell] = t.how === 'guess' ? TECH.guess : TECH.logic;
    }, () => {
      if (!create) play.solution = r.solution;
      toast(unique
        ? 'Solved in ' + fmtMs(r.ms) + '. Teal cells were placed after a guess.'
        : 'Solved, but this puzzle has more than one solution — showing one of them.', !unique);
      save();
    });
  }

  function animate(trace, apply, done) {
    const delay = Math.max(6, Math.min(40, 1500 / Math.max(1, trace.length)));
    let k = 0;
    const step = () => {
      if (k >= trace.length) { ui.anim = null; render(); done(); return; }
      const t = trace[k++];
      apply(t);
      popCell(t.cell);
      ui.selected = t.cell;
      render();
      ui.anim.timer = setTimeout(step, delay);
    };
    ui.anim = {
      timer: 0,
      finish() {
        clearTimeout(this.timer);
        while (k < trace.length) apply(trace[k++]);
        ui.anim = null;
        render();
        done();
      },
    };
    step();
  }
  function finishAnimation() { if (ui.anim) ui.anim.finish(); }
  function stopAnimation() { if (ui.anim) { clearTimeout(ui.anim.timer); ui.anim = null; } }

  const fmtMs = (ms) => (ms < 0.01 ? '< 0.01' : ms < 10 ? ms.toFixed(2) : ms.toFixed(1)) + ' ms';

  function showReport(r, unique) {
    const s = r.stats;
    $('#rTime').textContent = fmtMs(r.ms);
    $('#rNodes').textContent = s.nodes;
    $('#rGuesses').textContent = s.guesses;
    $('#rDead').textContent = s.deadEnds;

    let naked = 0, hidden = 0, guess = 0;
    for (const t of r.trace) {
      if (t.how === 'naked') naked++;
      else if (t.how === 'guess') guess++;
      else hidden++;
    }
    const parts = [
      ['Naked singles', naked, 'var(--accent)', 'naked'],
      ['Hidden singles', hidden, 'color-mix(in srgb, var(--accent) 45%, var(--surface))', 'hidden'],
      ['Placed by guessing', guess, 'var(--guess)', 'search'],
    ];
    $('#rMix').innerHTML = parts.filter((p) => p[1])
      .map((p) => '<span style="flex-grow:' + p[1] + ';background:' + p[2] + '"></span>').join('');
    $('#rLegend').innerHTML = parts
      .map((p) => '<li><i style="background:' + p[2] + '"></i><button type="button" class="term" data-guide="' + p[3] + '">' +
        p[0] + '</button><b>' + p[1] + '</b></li>').join('');

    const elim = [];
    const t = (term, label) => '<button type="button" class="term" data-guide="' + term + '">' + label + '</button>';
    if (s.pointing) elim.push(s.pointing + ' ' + t('pointing', 'pointing'));
    if (s.claiming) elim.push(s.claiming + ' ' + t('claiming', 'claiming'));
    if (s.pairs) elim.push(s.pairs + ' ' + t('pair', 'naked pair' + (s.pairs > 1 ? 's' : '')));
    let note = elim.length ? 'Candidate eliminations: ' + elim.join(', ') + '. ' : '';
    if (r.status === 'unsolvable') note += 'Every branch hit a contradiction — no solution.';
    else if (unique === false) note += 'More than one solution exists.';
    else if (!s.guesses) note += 'Solved by pure logic — no search needed.';
    else note += 'Search depth reached ' + s.maxDepth + '.';
    $('#rNote').innerHTML = note;
    $('#report').hidden = false;
  }

  // ------------------------------------------------------------------ techniques guide
  /*
   * Tiny diagram language, one token per cell:
   *   ''        blank (dimmed)          '5'  given digit
   *   '{247}'   candidates              '^4' highlight 4      '~4' strike 4
   *   '*'       target cell
   */
  const DIAGRAMS = {
    naked: { cols: 3, cells: ['{238}', '6', '{38}', '1', '{4}^4*', '{37}', '{28}', '9', '5'] },
    hidden: {
      cols: 9,
      cells: ['{148}', '{138}', '5', '{378}', '{1368}^6*', '2', '{147}', '9', '{347}'],
    },
    pointing: {
      cols: 9,
      cells: [
        '{14}^4*', '{47}^4*', '8', '{24}~4', '6', '{459}~4', '{12}', '{47}~4', '3',
        '2', '{17}', '9', '', '', '', '', '', '',
        '{17}', '5', '6', '', '', '', '', '', '',
      ],
    },
    claiming: {
      cols: 9,
      cells: [
        '', '', '', '', '', '', '{27}~7', '', '{378}~7',
        '3', '{19}', '4', '8', '{12}', '6', '{17}^7*', '{79}^7*', '{25}',
        '', '', '', '', '', '', '{567}~7', '4', '{17}~7',
      ],
    },
    pair: {
      cols: 9,
      cells: ['{28}^28*', '{1268}~28', '5', '{28}^28*', '{2379}~2', '4', '{38}~8', '{1789}~8', '6'],
    },
  };

  function renderDiagram(el, name) {
    if (name === 'units') return renderUnits(el);
    const spec = DIAGRAMS[name];
    const rows = spec.cells.length / spec.cols;
    el.style.setProperty('--cols', spec.cols);
    el.innerHTML = spec.cells.map((tok, i) => {
      const r = (i / spec.cols) | 0, c = i % spec.cols;
      let cls = 'mc';
      if ((c + 1) % 3 === 0 && c < spec.cols - 1) cls += ' br';
      if ((r + 1) % 3 === 0 && r < rows - 1) cls += ' bb';
      if (!tok) return '<div class="' + cls + ' dim"></div>';
      if (/^\d$/.test(tok)) return '<div class="' + cls + ' gv">' + tok + '</div>';
      const notes = (tok.match(/\{(\d+)\}/) || [, ''])[1];
      const hl = (tok.match(/\^(\d+)/) || [, ''])[1];
      const st = (tok.match(/~(\d+)/) || [, ''])[1];
      if (tok.includes('*')) cls += ' tgt';
      let html = '<div class="' + cls + '"><span class="nt">';
      for (let d = 1; d <= 9; d++) {
        const ds = String(d);
        if (!notes.includes(ds)) { html += '<i></i>'; continue; }
        html += '<i' + (hl.includes(ds) ? ' class="hl"' : st.includes(ds) ? ' class="st"' : '') + '>' + d + '</i>';
      }
      return html + '</span></div>';
    }).join('');
  }

  function renderUnits(el) {
    const sel = 4 * 9 + 5; // R5C6
    el.style.setProperty('--cols', 9);
    el.classList.add('units');
    let html = '';
    for (let i = 0; i < 81; i++) {
      const r = ROW[i], c = COL[i];
      let cls = 'mc';
      if ((c + 1) % 3 === 0 && c < 8) cls += ' br';
      if ((r + 1) % 3 === 0 && r < 8) cls += ' bb';
      if (i === sel) cls += ' tgt';
      else if (isPeer(i, sel)) cls += ' pr';
      html += '<div class="' + cls + '"></div>';
    }
    el.innerHTML = html;
  }

  let guideBuilt = false;
  function openGuide(term) {
    const dlg = $('#guideDlg');
    if (!guideBuilt) {
      dlg.querySelectorAll('[data-diagram]').forEach((el) => renderDiagram(el, el.dataset.diagram));
      dlg.querySelectorAll('.guide-nav a').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        jumpTo(a.getAttribute('href').slice(1));
      }));
      guideBuilt = true;
    }
    if (!dlg.open) dlg.showModal();
    if (term) jumpTo('g-' + term);
    else dlg.querySelector('.guide-body').scrollTop = 0;
  }
  function jumpTo(id) {
    const target = document.getElementById(id);
    if (!target) return;
    const body = $('#guideDlg .guide-body');
    body.scrollTo({ top: target.offsetTop - body.offsetTop - 8, behavior: 'smooth' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }

  // ------------------------------------------------------------------ io
  function copyPuzzle() {
    const g = ui.mode === 'play' ? play.givens : draft.values;
    const text = Core.toString(g);
    const ok = () => toast('Copied: ' + text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, ok));
    } else fallbackCopy(text, ok);
  }
  function fallbackCopy(text, ok) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); ok(); } catch (e) { toast(text); }
    ta.remove();
  }

  function openImport() {
    $('#importErr').textContent = '';
    $('#importText').value = '';
    $('#importDlg').showModal();
  }
  function importString(s) {
    let g;
    try { g = Core.toGrid(s); } catch (e) { return e.message + '.'; }
    stopAnimation();
    setMode('create');
    snapshot(draft);
    draft.values.set(g);
    clearOverlay();
    afterChange();
    toast('Puzzle imported — ' + countClues(g) + ' givens.');
    return null;
  }

  // ------------------------------------------------------------------ mode / persistence
  function setMode(mode) {
    if (ui.mode !== mode) stopAnimation();
    ui.mode = mode;
    document.body.dataset.mode = mode;
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    $('#win').hidden = !(mode === 'play' && play.status === 'won');
    if (mode === 'create') validateDraft();
    $('#report').hidden = true;
    render();
    save();
  }

  function setDifficulty(d) {
    ui.difficulty = d;
    document.querySelectorAll('#difficulty button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.diff === d)));
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        mode: ui.mode,
        difficulty: ui.difficulty,
        play: {
          givens: Array.from(play.givens), values: Array.from(play.values), notes: Array.from(play.notes),
          tech: Array.from(play.tech), solution: play.solution, label: play.label,
          elapsed: play.elapsed, hints: play.hints, status: play.status,
        },
        draft: Array.from(draft.values),
      }));
    } catch (e) { /* storage unavailable — fine */ }
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (!data || !data.play) return false;
      const p = data.play;
      play.givens.set(p.givens);
      play.values.set(p.values);
      play.notes.set(p.notes);
      play.tech.set(p.tech || []);
      play.solution = p.solution;
      play.label = p.label;
      play.elapsed = p.elapsed | 0;
      play.hints = p.hints | 0;
      play.status = p.status;
      if (data.draft) draft.values.set(data.draft);
      setDifficulty(data.difficulty || 'medium');
      ui.mode = data.mode === 'create' ? 'create' : 'play';
      return play.status !== 'empty';
    } catch (e) {
      return false;
    }
  }

  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  function toggleTheme() {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(STORE + '.theme', next); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ events
  const ACTIONS = {
    undo: () => restore(cur(), cur().undo, cur().redo),
    redo: () => restore(cur(), cur().redo, cur().undo),
    erase,
    notes: () => { ui.notesMode = !ui.notesMode; render(); },
    autonotes: autoNotes,
    hint,
    check,
    restart,
    clear: clearDraft,
    import: openImport,
    copy: copyPuzzle,
    solve: autoSolve,
    new: newGame,
    play: playDraft,
    closeReport: () => { $('#report').hidden = true; },
  };

  function bind() {
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-guide]');
      if (g) { openGuide(g.dataset.guide); return; }
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act]();
    });
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    document.querySelectorAll('#difficulty button').forEach((b) =>
      b.addEventListener('click', () => { setDifficulty(b.dataset.diff); newGame(); }));
    $('#themeBtn').addEventListener('click', toggleTheme);

    $('#importOk').addEventListener('click', (e) => {
      const err = importString($('#importText').value);
      if (err) { e.preventDefault(); $('#importErr').textContent = err; }
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('textarea, input, dialog')) return;
      const k = e.key;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); (e.shiftKey ? ACTIONS.redo : ACTIONS.undo)(); return; }
      if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); ACTIONS.redo(); return; }
      if (mod || e.altKey) return;

      const dm = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
      const digit = dm ? +dm[1] : /^[0-9]$/.test(k) ? +k : -1;
      if (digit > 0) { e.preventDefault(); input(digit, e.shiftKey); return; }
      if (digit === 0 || k === 'Backspace' || k === 'Delete') { e.preventDefault(); erase(); return; }

      const r = ROW[ui.selected], c = COL[ui.selected];
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (moves[k]) {
        e.preventDefault();
        const [dr, dc] = moves[k];
        select(((r + dr + 9) % 9) * 9 + ((c + dc + 9) % 9));
        return;
      }
      if (k === '?') { e.preventDefault(); openGuide(); return; }
      switch (k.toLowerCase()) {
        case 'n': ACTIONS.notes(); break;
        case 'h': if (ui.mode === 'play') hint(); break;
        case 'a': if (ui.mode === 'play') autoNotes(); break;
        case 's': autoSolve(); break;
        case 'escape': finishAnimation(); break;
        default: return;
      }
      e.preventDefault();
    });

    setInterval(() => {
      if (ui.mode === 'play' && play.status === 'playing' && !document.hidden && !ui.busy) {
        play.elapsed++;
        renderTimer();
        if (play.elapsed % 5 === 0) save();
      }
    }, 1000);
    document.addEventListener('visibilitychange', save);
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    try { const t = localStorage.getItem(STORE + '.theme'); if (t) applyTheme(t); } catch (e) { /* ignore */ }
    buildBoard();
    buildPad();
    bind();
    setDifficulty('medium');
    const restored = load();
    setMode(ui.mode);
    if (ui.mode === 'play' && play.status === 'won') showWin(false);
    if (!restored) newGame();
  }

  boot();
})();
