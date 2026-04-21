const CP1_COLORS = [
  { hex: '#EF4444', label: '红色', isTarget: true },
  { hex: '#3B82F6', label: '蓝色', isTarget: false },
  { hex: '#22C55E', label: '绿色', isTarget: false },
  { hex: '#F59E0B', label: '黄色', isTarget: false },
  { hex: '#A855F7', label: '紫色', isTarget: false },
  { hex: '#F97316', label: '橙色', isTarget: false }
];

function buildCP1Sequence() {
  const reds = Array(8).fill(0).map(() => 0);
  const distractors = shuffle([1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2]);
  return shuffle([...reds, ...distractors]);
}

const CP1 = {
  round: 0,
  total: 20,
  sequence: [],
  hits: 0,
  falseAlarms: 0,
  misses: 0,
  hitTimes: [],
  state: 'idle',
  timer: null,
  startTime: 0
};

function startColor() {
  setProgress(7);
  CP1.round = 0;
  CP1.hits = 0;
  CP1.falseAlarms = 0;
  CP1.misses = 0;
  CP1.hitTimes = [];
  CP1.sequence = buildCP1Sequence();
  showScreen('s-color-p1');
  setTimeout(nextCP1Round, 600);
}

function nextCP1Round() {
  if (CP1.round >= CP1.total) {
    finishCP1();
    return;
  }

  const arena = document.getElementById('color-arena');
  document.getElementById('cp1-round').textContent = CP1.round + 1;
  arena.style.background = '#0a0a0a';
  arena.style.borderColor = 'var(--border)';
  document.getElementById('color-arena-text').textContent = '等待...';
  document.getElementById('color-arena-text').style.color = 'var(--sub)';
  document.getElementById('color-arena-sub').textContent = '屏幕变红时点击';
  CP1.state = 'blank';

  const delay = 700 + Math.random() * 1400;
  CP1.timer = setTimeout(() => {
    const colorIdx = CP1.sequence[CP1.round];
    const color = CP1_COLORS[colorIdx];
    CP1.round += 1;
    arena.style.background = color.hex + '22';
    arena.style.borderColor = color.hex;
    document.getElementById('color-arena-text').textContent = color.label;
    document.getElementById('color-arena-text').style.color = color.hex;
    document.getElementById('color-arena-sub').textContent = color.isTarget ? '← 点击！' : '不要点击';
    CP1.state = 'active';
    CP1.isTarget = color.isTarget;
    CP1.startTime = performance.now();
    CP1.timer = setTimeout(() => {
      if (CP1.state !== 'active') return;
      CP1.state = 'idle';
      if (CP1.isTarget) CP1.misses += 1;
      updateCP1HUD();
      setTimeout(nextCP1Round, 350);
    }, 1200);
  }, delay);
}

function handleColorClick() {
  if (CP1.state !== 'active') return;
  clearTimeout(CP1.timer);
  const rt = performance.now() - CP1.startTime;
  CP1.state = 'idle';

  if (CP1.isTarget) {
    CP1.hits += 1;
    CP1.hitTimes.push(rt);
    document.getElementById('color-arena').style.boxShadow = '0 0 30px rgba(16,185,129,0.5)';
    setTimeout(() => {
      document.getElementById('color-arena').style.boxShadow = '';
    }, 250);
  } else {
    CP1.falseAlarms += 1;
    document.getElementById('color-arena').style.boxShadow = '0 0 30px rgba(239,68,68,0.5)';
    setTimeout(() => {
      document.getElementById('color-arena').style.boxShadow = '';
    }, 250);
  }

  updateCP1HUD();
  setTimeout(nextCP1Round, 400);
}

function updateCP1HUD() {
  document.getElementById('cp1-hits').textContent = CP1.hits;
  document.getElementById('cp1-false').textContent = CP1.falseAlarms;
  if (CP1.hitTimes.length > 0) {
    const avg = Math.round(CP1.hitTimes.reduce((sum, time) => sum + time, 0) / CP1.hitTimes.length);
    document.getElementById('cp1-avgrt').textContent = avg + 'ms';
  }
}

function finishCP1() {
  rawData.colorP1Hits = CP1.hits;
  rawData.colorP1Total = 8;
  rawData.colorP1FalseAlarms = CP1.falseAlarms;
  rawData.colorP1Misses = CP1.misses;
  rawData.colorP1AvgRT = CP1.hitTimes.length
    ? Math.round(CP1.hitTimes.reduce((sum, time) => sum + time, 0) / CP1.hitTimes.length)
    : 999;
  showScreen('s-color-transition');
}

const CP2_ROUNDS = [
  { total: 12, reds: [0, 5, 355], distractors: ['#3B82F6', '#10B981', '#8B5CF6', '#EAB308', '#0EA5E9'], time: 3000 },
  { total: 12, reds: [0, 10, 350, 5], distractors: ['#3B82F6', '#10B981', '#8B5CF6', '#EAB308', '#EC4899'], time: 2800 },
  { total: 15, reds: [0, 5, 10, 355], distractors: ['#3B82F6', '#10B981', 'hsl(28,90%,54%)', '#8B5CF6'], time: 2800 },
  { total: 16, reds: [0, 5, 355, 8], distractors: ['hsl(22,88%,54%)', 'hsl(30,85%,54%)', '#3B82F6', '#10B981', '#8B5CF6'], time: 2600 },
  { total: 16, reds: [0, 358, 5], distractors: ['hsl(18,85%,54%)', 'hsl(25,83%,54%)', 'hsl(30,80%,55%)', '#3B82F6', '#8B5CF6'], time: 2500 },
  { total: 20, reds: [355, 0, 8, 352], distractors: ['hsl(20,82%,54%)', 'hsl(15,85%,54%)', 'hsl(25,80%,55%)', '#3B82F6'], time: 2400 },
  { total: 20, reds: [0, 5, 355], distractors: ['hsl(15,84%,54%)', 'hsl(20,82%,54%)', 'hsl(25,80%,55%)', 'hsl(12,83%,54%)', '#3B82F6'], time: 2200 },
  { total: 20, reds: [2, 358, 7, 353], distractors: ['hsl(15,82%,54%)', 'hsl(18,80%,54%)', 'hsl(22,80%,55%)', 'hsl(12,82%,54%)', 'hsl(10,78%,55%)'], time: 2000 }
];

const CP2_TOTAL_REDS = CP2_ROUNDS.reduce((sum, round) => sum + round.reds.length, 0);
const CP2_TOTAL_DISTR = CP2_ROUNDS.reduce((sum, round) => sum + (round.total - round.reds.length), 0);

const CP2 = {
  round: 0,
  hits: 0,
  falseClicks: 0,
  missed: 0,
  roundTimes: [],
  targets: [],
  clicked: new Set(),
  roundStart: 0,
  timerRaf: null,
  timerDeadline: 0
};

function startColorP2() {
  CP2.round = 0;
  CP2.hits = 0;
  CP2.falseClicks = 0;
  CP2.missed = 0;
  CP2.roundTimes = [];
  CP2.targets = [];
  CP2.clicked = new Set();
  CP2.timerRaf = null;
  showScreen('s-color-p2');
  renderCP2Round();
}

function renderCP2Round() {
  const cfg = CP2_ROUNDS[CP2.round];
  document.getElementById('cp2-round').textContent = CP2.round + 1;
  document.getElementById('cp2-feedback').textContent = '';
  document.getElementById('cp2-feedback').className = 'vision-feedback';
  CP2.clicked = new Set();
  CP2.targets = [];

  cfg.reds.forEach(hue => CP2.targets.push({ isRed: true, color: `hsl(${hue},82%,54%)` }));
  const distractorCount = cfg.total - cfg.reds.length;
  for (let i = 0; i < distractorCount; i += 1) {
    CP2.targets.push({ isRed: false, color: cfg.distractors[i % cfg.distractors.length] });
  }

  for (let i = CP2.targets.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [CP2.targets[i], CP2.targets[j]] = [CP2.targets[j], CP2.targets[i]];
  }

  const cols = cfg.total <= 12 ? 4 : 5;
  const grid = document.getElementById('cp2-grid');
  grid.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  grid.innerHTML = CP2.targets
    .map((target, index) => `<div class="cp2-dot" id="cp2d${index}" style="background:${target.color}" onclick="cp2Click(${index})"></div>`)
    .join('');

  CP2.roundStart = performance.now();
  CP2.timerDeadline = CP2.roundStart + cfg.time;
  if (CP2.timerRaf) cancelAnimationFrame(CP2.timerRaf);
  tickCP2Timer();
}

function tickCP2Timer() {
  const now = performance.now();
  const pct = Math.max(0, (CP2.timerDeadline - now) / (CP2_ROUNDS[CP2.round]?.time || 2500));
  const bar = document.getElementById('cp2-timer-bar');
  if (bar) {
    bar.style.width = pct * 100 + '%';
    bar.style.background = pct > 0.4 ? '#EF4444' : pct > 0.2 ? '#F97316' : '#FCD34D';
  }
  if (pct <= 0) {
    finishCP2Round(true);
    return;
  }
  CP2.timerRaf = requestAnimationFrame(tickCP2Timer);
}

function cp2Click(index) {
  if (CP2.clicked.has(index)) return;
  CP2.clicked.add(index);

  const target = CP2.targets[index];
  const dot = document.getElementById('cp2d' + index);
  if (target.isRed) {
    CP2.hits += 1;
    dot.classList.add('hit');
    const redIndexes = CP2.targets.map((item, idx) => item.isRed ? idx : -1).filter(idx => idx >= 0);
    if (redIndexes.every(idx => CP2.clicked.has(idx))) {
      CP2.roundTimes.push(Math.round(performance.now() - CP2.roundStart));
      cancelAnimationFrame(CP2.timerRaf);
      setTimeout(() => finishCP2Round(false), 400);
    }
  } else {
    CP2.falseClicks += 1;
    dot.classList.add('wrong');
  }
}

function finishCP2Round(timeUp) {
  cancelAnimationFrame(CP2.timerRaf);
  const redIndexes = CP2.targets.map((item, idx) => item.isRed ? idx : -1).filter(idx => idx >= 0);
  const missedThisRound = redIndexes.filter(idx => !CP2.clicked.has(idx)).length;
  CP2.missed += missedThisRound;

  const feedback = document.getElementById('cp2-feedback');
  if (timeUp && missedThisRound > 0) {
    feedback.textContent = `⏱ 时间到！漏了 ${missedThisRound} 个目标`;
    feedback.className = 'vision-feedback wrong';
  } else if (CP2.falseClicks > 0) {
    feedback.textContent = '✓ 完成！但误触了非红色目标';
    feedback.className = 'vision-feedback';
  } else {
    feedback.textContent = '✓ 全部识别！';
    feedback.className = 'vision-feedback correct';
  }

  CP2.round += 1;
  if (CP2.round >= 8) {
    setTimeout(finishColor, 800);
  } else {
    setTimeout(renderCP2Round, 800);
  }
}

function finishColor() {
  rawData.colorP2Hits = CP2.hits;
  rawData.colorP2Missed = CP2.missed;
  rawData.colorP2FalseClicks = CP2.falseClicks;
  rawData.colorP2Total = CP2_TOTAL_REDS;
  rawData.colorP2Correct = CP2.hits;
  rawData.colorP2AvgRT = CP2.roundTimes.length
    ? Math.round(CP2.roundTimes.reduce((sum, time) => sum + time, 0) / CP2.roundTimes.length)
    : 9999;

  const p1HitRate = CP1.hits / 8;
  const p1FaRate = CP1.falseAlarms / 12;
  let p1Score = p1HitRate * 80 - p1FaRate * 40;
  if (rawData.colorP1AvgRT < 350) p1Score = Math.min(100, p1Score + 15);
  else if (rawData.colorP1AvgRT < 500) p1Score = Math.min(100, p1Score + 7);
  p1Score = Math.max(0, p1Score);

  const hitRate = CP2_TOTAL_REDS > 0 ? CP2.hits / CP2_TOTAL_REDS : 0;
  const falseRate = CP2_TOTAL_DISTR > 0 ? CP2.falseClicks / CP2_TOTAL_DISTR : 0;
  let p2Score = hitRate * 80 - falseRate * 40;
  if (rawData.colorP2AvgRT < 1200) p2Score = Math.min(100, p2Score + 20);
  else if (rawData.colorP2AvgRT < 1800) p2Score = Math.min(100, p2Score + 10);
  p2Score = Math.max(0, p2Score);

  scores.color = clamp(Math.round(p1Score * 0.6 + p2Score * 0.4), 0, 100);
  openAimIntro(2);
}
