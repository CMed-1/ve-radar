const NBACK_LETTERS = ['A', 'B', 'C', 'D', 'F', 'H', 'L', 'M', 'P', 'R'];
const NBACK_N = 2;
const NBACK_TOTAL = 24;

const NB = {
  sequence: [],
  idx: 0,
  hits: 0,
  misses: 0,
  falseAlarms: 0,
  responded: false,
  displayTimer: null,
  pauseTimer: null
};

function buildNbackSequence() {
  const sequence = [];
  for (let i = 0; i < NBACK_TOTAL; i += 1) {
    if (i >= NBACK_N && Math.random() < 0.28 && sequence[i - NBACK_N] !== sequence[i - 1]) {
      sequence.push(sequence[i - NBACK_N]);
    } else {
      let letter;
      do {
        letter = NBACK_LETTERS[Math.floor(Math.random() * NBACK_LETTERS.length)];
      } while (i >= NBACK_N && letter === sequence[i - NBACK_N]);
      sequence.push(letter);
    }
  }
  return sequence;
}

function startNback() {
  setProgress(4);
  NB.sequence = buildNbackSequence();
  NB.idx = 0;
  NB.hits = 0;
  NB.misses = 0;
  NB.falseAlarms = 0;
  showScreen('s-nback-test');
  document.getElementById('nb-hits').textContent = '0';
  document.getElementById('nb-fa').textContent = '0';
  document.getElementById('nb-progress').textContent = '0/24';
  document.getElementById('nback-feedback').textContent = '';
  document.getElementById('nback-display').textContent = '';
  document.getElementById('nback-display').style.borderColor = 'var(--border)';
  setTimeout(showNbackStimulus, 600);
}

function showNbackStimulus() {
  if (NB.idx >= NBACK_TOTAL) {
    finishNback();
    return;
  }

  NB.responded = false;
  const letter = NB.sequence[NB.idx];
  const display = document.getElementById('nback-display');
  display.textContent = letter;
  display.style.borderColor = 'var(--border)';
  document.getElementById('nback-feedback').textContent = '';
  document.getElementById('nb-progress').textContent = NB.idx + 1 + '/24';

  NB.displayTimer = setTimeout(() => {
    const isTarget = NB.idx >= NBACK_N && NB.sequence[NB.idx] === NB.sequence[NB.idx - NBACK_N];
    if (isTarget && !NB.responded) {
      NB.misses += 1;
      document.getElementById('nback-feedback').textContent = '漏触了！';
      document.getElementById('nback-feedback').style.color = 'var(--yellow)';
    }
    display.textContent = '';
    NB.idx += 1;
    NB.pauseTimer = setTimeout(showNbackStimulus, 1600);
  }, 700);
}

function nbackSame() {
  if (NB.idx >= NBACK_TOTAL || NB.responded) return;
  NB.responded = true;

  const isTarget = NB.idx >= NBACK_N && NB.sequence[NB.idx] === NB.sequence[NB.idx - NBACK_N];
  const display = document.getElementById('nback-display');
  const feedback = document.getElementById('nback-feedback');

  if (isTarget) {
    NB.hits += 1;
    display.style.borderColor = 'var(--cyan)';
    feedback.textContent = '✓ 正确！';
    feedback.style.color = 'var(--cyan)';
    document.getElementById('nb-hits').textContent = NB.hits;
  } else {
    NB.falseAlarms += 1;
    display.style.borderColor = 'var(--red)';
    feedback.textContent = '✗ 误触';
    feedback.style.color = 'var(--red)';
    document.getElementById('nb-fa').textContent = NB.falseAlarms;
  }
}

function finishNback() {
  clearTimeout(NB.displayTimer);
  clearTimeout(NB.pauseTimer);

  let targets = 0;
  for (let i = NBACK_N; i < NBACK_TOTAL; i += 1) {
    if (NB.sequence[i] === NB.sequence[i - NBACK_N]) {
      targets += 1;
    }
  }

  const nonTargets = NBACK_TOTAL - NBACK_N - targets;
  const hitRate = targets > 0 ? NB.hits / targets : 0;
  const faRate = nonTargets > 0 ? NB.falseAlarms / nonTargets : 0;
  const nbScore = clamp(Math.round(hitRate * 80 - faRate * 40 + 20), 0, 100);

  rawData.nbScore = nbScore;
  rawData.nbHits = NB.hits;
  rawData.nbMisses = NB.misses;
  rawData.nbFalseAlarms = NB.falseAlarms;
  rawData.nbTargets = targets;
  openAimIntro(1);
}

const GRID = {
  level: 0,
  levels: [3, 4, 5],
  next: 1,
  errors: 0,
  startTime: 0,
  times: [],
  allErrors: 0,
  timer: null
};

function startGrid() {
  setProgress(6);
  GRID.level = 0;
  GRID.times = [];
  GRID.allErrors = 0;
  showScreen('s-grid-test');
  renderGridLevel();
}

function renderGridLevel() {
  const size = GRID.levels[GRID.level];
  document.getElementById('grid-level-label').textContent = `${size}×${size}`;
  document.getElementById('grid-next').textContent = '1';
  GRID.next = 1;
  GRID.errors = 0;

  const container = document.getElementById('grid-container');
  const cellSize = Math.min(Math.floor((Math.min(window.innerWidth - 48, 600) - (size - 1) * 8) / size), 90);
  container.style.gridTemplateColumns = `repeat(${size}, ${cellSize}px)`;
  container.style.width = cellSize * size + (size - 1) * 8 + 'px';

  const nums = shuffle([...Array(size * size)].map((_, index) => index + 1));
  container.innerHTML = '';
  nums.forEach(num => {
    const cell = document.createElement('div');
    cell.className = 'grid-cell';
    cell.textContent = num;
    cell.dataset.num = num;
    cell.style.width = cellSize + 'px';
    cell.style.height = cellSize + 'px';
    cell.style.fontSize = Math.max(14, cellSize * 0.35) + 'px';
    cell.onclick = () => handleGridClick(num, cell);
    container.appendChild(cell);
  });

  GRID.startTime = performance.now();
  updateGridTimer();
}

function updateGridTimer() {
  GRID.timer = setInterval(() => {
    const elapsed = (performance.now() - GRID.startTime) / 1000;
    document.getElementById('grid-timer').textContent = elapsed.toFixed(1) + 's';
  }, 100);
}

function handleGridClick(num, cell) {
  if (num === GRID.next) {
    cell.classList.add('correct', 'done');
    cell.onclick = null;
    GRID.next += 1;
    document.getElementById('grid-next').textContent = GRID.next;

    const size = GRID.levels[GRID.level];
    if (GRID.next > size * size) {
      clearInterval(GRID.timer);
      const elapsed = (performance.now() - GRID.startTime) / 1000;
      GRID.times.push({ size, time: elapsed, errors: GRID.errors });
      GRID.allErrors += GRID.errors;
      GRID.level += 1;
      if (GRID.level < GRID.levels.length) {
        setTimeout(renderGridLevel, 600);
      } else {
        setTimeout(finishGrid, 600);
      }
    }
  } else {
    GRID.errors += 1;
    GRID.allErrors += 1;
    cell.classList.add('wrong');
    setTimeout(() => {
      cell.classList.remove('wrong');
    }, 300);
  }
}

function finishGrid() {
  rawData.gridTimes = GRID.times;
  rawData.gridErrors = GRID.allErrors;

  const benchmarks = { 3: 8, 4: 25, 5: 60 };
  let totalScore = 0;
  GRID.times.forEach(({ size, time, errors }) => {
    const bench = benchmarks[size];
    let score = clamp(100 - ((time / bench) - 1) * 50, 0, 100);
    score -= errors * 5;
    totalScore += Math.max(0, score);
  });

  const gridScore = clamp(Math.round(totalScore / GRID.times.length), 0, 100);
  const nbScoreVal = rawData.nbScore !== undefined ? rawData.nbScore : 50;
  scores.cognition = clamp(Math.round(gridScore * 0.6 + nbScoreVal * 0.4), 0, 100);
  showScreen('s-color-intro');
}
