const AIM_PHASES = {
  1: {
    step: 5,
    introIndex: 'TEST 05 / 09',
    sensitivityIndex: 'TEST 05 / 09 — 灵敏度校准',
    introTitle: '手眼协调测试（一测）',
    introDesc: '第一轮先测基础瞄准效率。本轮持续 30 秒，记录你的基础命中率、KPM 和响应速度。',
    roundRule: '这是第一轮，第二轮会在后面再次出现，系统会比较两次的前后稳定性。',
    resultIndex: 'TEST 05 — 手眼协调（一测）· 本轮结果',
    resultNote: '这是第一轮表现。后面还会再做一次同样的测试，用来判断你的瞄准稳定性。',
    resultButton: '下一项测试 →',
    nextScreen: 's-grid-intro'
  },
  2: {
    step: 8,
    introIndex: 'TEST 08 / 09',
    sensitivityIndex: 'TEST 08 / 09 — 灵敏度校准',
    introTitle: '手眼协调测试（二测）',
    introDesc: '第二轮仍然是 30 秒 Gridshot。系统会把这轮和第一轮对比，用来衡量你在后程的专注稳定性。',
    roundRule: '这轮结束后，系统会把两次 aim 的差值纳入「专注稳定性」评分。',
    resultIndex: 'TEST 08 — 手眼协调（二测）· 对比结果',
    resultNote: '',
    resultButton: '最后一项测试 →',
    nextScreen: 's-reaction2-intro'
  }
};

let AIM_SENSITIVITY = 5;
const AIM_GRID = {
  desktop: { cols: 8, rows: 5 },
  mobile: { cols: 6, rows: 4 }
};

const aimOccupied = new Set();
const JOY = { raf: null };
const CH = { x: 0, y: 0 };

const AIM = {
  currentPhase: 1,
  rounds: [],
  hits: 0,
  shots: 0,
  expired: 0,
  hitTimes: [],
  streak: 0,
  bestStreak: 0,
  duration: 30000,
  endTime: 0,
  targetSize: isMobile ? 52 : 44,
  timerInterval: null,
  finished: false,
  activeTargets: 0,
  _cleanLook: null,
  _cleanFire: null
};

const SENS = {
  ch: { x: 0, y: 0 },
  raf: null,
  hits: 0,
  _cleanArena: null,
  _cleanFire: null
};

let sensTargetTimer = null;

function getAimMeta() {
  return AIM_PHASES[AIM.currentPhase];
}

function openAimIntro(phase) {
  AIM.currentPhase = phase;
  syncAimUI();
  setProgress(getAimMeta().step);
  showScreen('s-aim-intro');
}

function syncAimUI() {
  const meta = getAimMeta();

  document.getElementById('aim-sens-index').textContent = meta.sensitivityIndex;
  document.getElementById('aim-intro-index').textContent = meta.introIndex;
  document.getElementById('aim-intro-title').textContent = meta.introTitle;
  document.getElementById('aim-intro-desc').textContent = meta.introDesc;
  document.getElementById('aim-round-rule').textContent = meta.roundRule;

  const startBtn = document.getElementById('aim-start-btn');
  startBtn.textContent = '开始测试';
  startBtn.dataset.originalText = '开始测试';

  const sensBtn = document.getElementById('sens-start-btn');
  sensBtn.textContent = AIM.currentPhase === 1 ? '确认灵敏度，开始第一轮' : '确认灵敏度，开始第二轮';
  sensBtn.dataset.originalText = sensBtn.textContent;

  document.getElementById('aim-result-index').textContent = meta.resultIndex;
  document.getElementById('aim-result-next').textContent = meta.resultButton;
  document.getElementById('aim-result-note').style.display = 'none';
  document.getElementById('aim-result-note').textContent = '';
}

function startAimEntry() {
  if (isMobile) {
    startSensitivityCal();
  } else {
    startAim();
  }
}

function startAim() {
  resetAimRoundState();
  setProgress(getAimMeta().step);
  showScreen('s-aim-test');

  document.getElementById('aim-test-index').textContent =
    `TEST ${AIM.currentPhase === 1 ? '05' : '08'} — GRIDSHOT · 第 ${AIM.currentPhase} 轮 / 30 秒`;
  document.getElementById('aim-time').textContent = Math.ceil(AIM.duration / 1000);
  document.getElementById('aim-accuracy').textContent = '—';
  document.getElementById('aim-kpm').textContent = '—';
  document.getElementById('aim-hits').textContent = '0';
  document.getElementById('aim-timer-bar').style.width = '100%';

  const arena = document.getElementById('aim-arena');
  AIM.endTime = Date.now() + AIM.duration;

  if (isMobile) {
    arena.onclick = null;
    arena.ontouchstart = null;
    initJoystick();
  } else {
    arena.onclick = handleAimArenaClick;
    arena.ontouchstart = null;
    document.getElementById('aim-crosshair').style.display = 'none';
    document.getElementById('fire-btn').style.display = 'none';
  }

  for (let i = 0; i < 3; i += 1) {
    setTimeout(spawnOneTarget, i * 80);
  }

  AIM.timerInterval = setInterval(updateAimTimer, 80);
}

function resetAimRoundState() {
  clearInterval(AIM.timerInterval);
  if (JOY.raf) cancelAnimationFrame(JOY.raf);
  cleanupAimMobileControls();
  aimOccupied.clear();
  document.querySelectorAll('.aim-target').forEach(target => target.remove());

  AIM.hits = 0;
  AIM.shots = 0;
  AIM.expired = 0;
  AIM.hitTimes = [];
  AIM.streak = 0;
  AIM.bestStreak = 0;
  AIM.finished = false;
  AIM.activeTargets = 0;
}

function getAimGridConfig(rect, size) {
  const preset = isMobile ? AIM_GRID.mobile : AIM_GRID.desktop;
  const padX = Math.max(size / 2 + 8, 18);
  const padY = Math.max(size / 2 + 8, 18);
  const usableW = Math.max(rect.width - padX * 2, 1);
  const usableH = Math.max(rect.height - padY * 2, 1);
  return {
    cols: preset.cols,
    rows: preset.rows,
    padX,
    padY,
    stepX: preset.cols > 1 ? usableW / (preset.cols - 1) : usableW,
    stepY: preset.rows > 1 ? usableH / (preset.rows - 1) : usableH
  };
}

function spawnOneTarget() {
  if (AIM.finished || Date.now() >= AIM.endTime) return;

  const arena = document.getElementById('aim-arena');
  const rect = arena.getBoundingClientRect();
  const size = AIM.targetSize;
  const grid = getAimGridConfig(rect, size);
  const totalCells = grid.cols * grid.rows;

  let cellId;
  let attempts = 0;
  do {
    cellId = Math.floor(Math.random() * totalCells);
    attempts += 1;
  } while (aimOccupied.has(cellId) && attempts < 30);

  aimOccupied.add(cellId);
  const col = cellId % grid.cols;
  const row = Math.floor(cellId / grid.cols);
  const targetX = grid.padX + col * grid.stepX;
  const targetY = grid.padY + row * grid.stepY;

  const target = document.createElement('div');
  target.className = 'aim-target';
  target.style.width = size + 'px';
  target.style.height = size + 'px';
  target.style.left = targetX + 'px';
  target.style.top = targetY + 'px';

  const spawnTime = Date.now();
  AIM.activeTargets += 1;

  const expireTimer = setTimeout(() => {
    if (!target.isConnected) return;
    aimOccupied.delete(cellId);
    target.style.opacity = '0';
    target.style.transform = 'translate(-50%,-50%) scale(0.5)';
    setTimeout(() => {
      if (target.isConnected) target.remove();
    }, 200);
    AIM.expired += 1;
    AIM.activeTargets -= 1;
    AIM.streak = 0;
    updateAimHUD();
    setTimeout(spawnOneTarget, 250);
  }, 2800);

  const onHit = event => {
    event.stopPropagation();
    if (!target.isConnected) return;
    clearTimeout(expireTimer);
    aimOccupied.delete(cellId);
    const hitTime = Date.now() - spawnTime;
    AIM.hits += 1;
    AIM.shots += 1;
    AIM.hitTimes.push(hitTime);
    AIM.streak += 1;
    if (AIM.streak > AIM.bestStreak) AIM.bestStreak = AIM.streak;
    AIM.activeTargets -= 1;
    target.style.transition = 'transform .12s, opacity .12s';
    target.style.transform = 'translate(-50%,-50%) scale(0)';
    target.style.opacity = '0';
    setTimeout(() => {
      if (target.isConnected) target.remove();
    }, 130);
    updateAimHUD();
    setTimeout(spawnOneTarget, 80);
  };

  if (isMobile) {
    target.addEventListener('mobileHit', onHit);
  } else {
    target.addEventListener('click', onHit);
    target.addEventListener('touchstart', event => {
      event.preventDefault();
      onHit(event);
    }, { passive: false });
  }

  arena.appendChild(target);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => target.classList.add('spawned'));
  });
}

function handleAimArenaClick(event) {
  if (event.target !== document.getElementById('aim-arena')) return;
  AIM.shots += 1;
  AIM.streak = 0;
  updateAimHUD();
  flashAimMiss();
}

function flashAimMiss() {
  const flash = document.getElementById('aim-miss-flash');
  flash.style.opacity = '1';
  setTimeout(() => {
    flash.style.opacity = '0';
  }, 120);
}

function updateAimHUD() {
  document.getElementById('aim-hits').textContent = AIM.hits;
  const accuracy = AIM.shots > 0 ? Math.round(AIM.hits / AIM.shots * 100) : 100;
  document.getElementById('aim-accuracy').textContent = accuracy + '%';
  const elapsed = (AIM.duration - Math.max(0, AIM.endTime - Date.now())) / 60000;
  const kpm = elapsed > 0.05 ? Math.round(AIM.hits / elapsed) : 0;
  document.getElementById('aim-kpm').textContent = kpm || '—';
}

function updateAimTimer() {
  const remaining = Math.max(0, AIM.endTime - Date.now());
  document.getElementById('aim-time').textContent = Math.ceil(remaining / 1000);
  document.getElementById('aim-timer-bar').style.width = remaining / AIM.duration * 100 + '%';
  updateAimHUD();
  if (remaining <= 0) {
    clearInterval(AIM.timerInterval);
    finishAim();
  }
}

function computeAimScore(accuracy, kpm, avgHitTime) {
  const accScore = clamp(accuracy * 100, 0, 100);
  const kpmScore = kpm >= 100 ? 100 : kpm >= 80 ? 82 : kpm >= 60 ? 65 : kpm >= 44 ? 50 : kpm >= 30 ? 35 : kpm >= 20 ? 22 : 10;
  const timeScore = avgHitTime < 300 ? 100 : avgHitTime < 500 ? 78 : avgHitTime < 750 ? 55 : avgHitTime < 1000 ? 32 : 15;
  return clamp(Math.round(accScore * 0.4 + kpmScore * 0.4 + timeScore * 0.2), 0, 100);
}

function buildAimRoundSummary() {
  const totalShots = AIM.shots;
  const accuracy = totalShots > 0 ? AIM.hits / totalShots : 0;
  const kpm = Math.round(AIM.hits / (AIM.duration / 60000));
  const avgHitTime = AIM.hitTimes.length
    ? Math.round(AIM.hitTimes.reduce((sum, time) => sum + time, 0) / AIM.hitTimes.length)
    : 999;
  const misses = AIM.expired + (totalShots - AIM.hits);

  return {
    phase: AIM.currentPhase,
    duration: AIM.duration,
    hits: AIM.hits,
    shots: totalShots,
    accuracy: Math.round(accuracy * 100),
    kpm,
    avgHitTime,
    bestStreak: AIM.bestStreak,
    misses,
    score: computeAimScore(accuracy, kpm, avgHitTime)
  };
}

function buildAimConsistency(round1, round2) {
  if (!round1 || !round2) {
    return { score: 50, accuracyDelta: 0, kpmDelta: 0, avgTimeDelta: 0 };
  }

  const accuracyGap = Math.abs(round2.accuracy - round1.accuracy);
  const kpmGap = Math.abs(round2.kpm - round1.kpm);
  const avgTimeGap = Math.abs(round2.avgHitTime - round1.avgHitTime);

  let score = 100 - accuracyGap * 1.4 - kpmGap * 0.8 - avgTimeGap / 18;
  if (round2.accuracy < round1.accuracy) {
    score -= (round1.accuracy - round2.accuracy) * 0.4;
  }
  if (round2.kpm < round1.kpm) {
    score -= (round1.kpm - round2.kpm) * 0.4;
  }
  if (round2.avgHitTime > round1.avgHitTime) {
    score -= (round2.avgHitTime - round1.avgHitTime) / 30;
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    accuracyDelta: round2.accuracy - round1.accuracy,
    kpmDelta: round2.kpm - round1.kpm,
    avgTimeDelta: round2.avgHitTime - round1.avgHitTime
  };
}

function finalizeAimTotals() {
  const rounds = AIM.rounds.filter(Boolean);
  const totalDuration = rounds.reduce((sum, round) => sum + round.duration, 0);
  const totalHits = rounds.reduce((sum, round) => sum + round.hits, 0);
  const totalShots = rounds.reduce((sum, round) => sum + round.shots, 0);
  const totalHitCount = rounds.reduce((sum, round) => sum + round.hits, 0);
  const totalHitTime = rounds.reduce((sum, round) => sum + round.avgHitTime * round.hits, 0);
  const accuracy = totalShots > 0 ? totalHits / totalShots : 0;
  const kpm = totalDuration > 0 ? Math.round(totalHits / (totalDuration / 60000)) : 0;
  const avgHitTime = totalHitCount > 0 ? Math.round(totalHitTime / totalHitCount) : 999;
  const bestStreak = rounds.reduce((best, round) => Math.max(best, round.bestStreak), 0);
  const misses = rounds.reduce((sum, round) => sum + round.misses, 0);
  const score = computeAimScore(accuracy, kpm, avgHitTime);

  scores.aim = score;
  rawData.aimRounds = rounds;
  rawData.aimHits = totalHits;
  rawData.aimShots = totalShots;
  rawData.aimKpm = kpm;
  rawData.aimAccuracy = Math.round(accuracy * 100);
  rawData.aimAvgTime = avgHitTime;
  rawData.aimBestStreak = bestStreak;
  rawData.aimMisses = misses;
  rawData.aimConsistency = buildAimConsistency(rounds[0], rounds[1]);

  return {
    hits: totalHits,
    accuracy: Math.round(accuracy * 100),
    kpm,
    avgHitTime,
    bestStreak,
    misses,
    score
  };
}

function renderAimResult(stats, isFinal) {
  const meta = getAimMeta();
  document.getElementById('aim-result-index').textContent = meta.resultIndex;
  document.getElementById('aim-final-score').textContent = stats.score;
  document.getElementById('aim-score-caption').textContent = isFinal ? '两轮综合分 / 100' : '本轮分数 / 100';
  document.getElementById('ar-hits').textContent = stats.hits;
  document.getElementById('ar-accuracy').textContent = stats.accuracy + '%';
  document.getElementById('ar-kpm').textContent = stats.kpm;
  document.getElementById('ar-avgtime').textContent = stats.avgHitTime + 'ms';
  document.getElementById('ar-streak').textContent = stats.bestStreak;
  document.getElementById('ar-misses').textContent = stats.misses;

  const note = document.getElementById('aim-result-note');
  note.style.display = 'block';
  if (isFinal && rawData.aimConsistency) {
    const compare = rawData.aimConsistency;
    const accText = compare.accuracyDelta === 0 ? '0%' : `${compare.accuracyDelta > 0 ? '+' : ''}${compare.accuracyDelta}%`;
    const kpmText = compare.kpmDelta === 0 ? '0' : `${compare.kpmDelta > 0 ? '+' : ''}${compare.kpmDelta}`;
    const timeText = compare.avgTimeDelta === 0 ? '0ms' : `${compare.avgTimeDelta > 0 ? '+' : ''}${compare.avgTimeDelta}ms`;
    note.textContent = `第二轮较第一轮：命中率 ${accText}，KPM ${kpmText}，平均命中时间 ${timeText}。该差值已纳入专注稳定性评分。`;
  } else {
    note.textContent = meta.resultNote;
  }
}

function finishAim() {
  if (AIM.finished) return;
  AIM.finished = true;
  clearInterval(AIM.timerInterval);
  document.querySelectorAll('.aim-target').forEach(target => target.remove());
  cleanupAimMobileControls();

  const roundStats = buildAimRoundSummary();
  AIM.rounds[AIM.currentPhase - 1] = roundStats;
  rawData.aimRounds = AIM.rounds.filter(Boolean);

  if (AIM.currentPhase === 2) {
    renderAimResult(finalizeAimTotals(), true);
  } else {
    renderAimResult(roundStats, false);
  }

  showScreen('s-aim-result');
}

function continueAfterAim() {
  showScreen(getAimMeta().nextScreen);
}

function cleanupAimMobileControls() {
  if (AIM._cleanLook) {
    AIM._cleanLook();
    AIM._cleanLook = null;
  }
  if (AIM._cleanFire) {
    AIM._cleanFire();
    AIM._cleanFire = null;
  }
  document.getElementById('aim-crosshair').style.display = 'none';
  document.getElementById('fire-btn').style.display = 'none';
}

function updateCH() {
  const ch = document.getElementById('aim-crosshair');
  ch.style.left = CH.x + 'px';
  ch.style.top = CH.y + 'px';
  document.querySelectorAll('.aim-target').forEach(target => {
    const tx = parseFloat(target.style.left);
    const ty = parseFloat(target.style.top);
    const radius = parseInt(target.style.width, 10) / 2;
    target.classList.toggle('aim-target-lit', Math.hypot(CH.x - tx, CH.y - ty) < radius + 8);
  });
}

function initJoystick() {
  const arena = document.getElementById('aim-arena');
  let rect = arena.getBoundingClientRect();
  CH.x = rect.width / 2;
  CH.y = rect.height / 2;

  const ch = document.getElementById('aim-crosshair');
  ch.style.display = 'block';
  updateCH();
  document.getElementById('mobile-joy-wrap').style.display = 'none';

  let lookId = null;
  let lastLX = 0;
  let lastLY = 0;

  const onLookStart = event => {
    event.preventDefault();
    if (lookId !== null) return;
    const touch = event.changedTouches[0];
    lookId = touch.identifier;
    lastLX = touch.clientX;
    lastLY = touch.clientY;
  };

  const onLookMove = event => {
    event.preventDefault();
    rect = arena.getBoundingClientRect();
    for (const touch of event.changedTouches) {
      if (touch.identifier !== lookId) continue;
      const dx = touch.clientX - lastLX;
      const dy = touch.clientY - lastLY;
      lastLX = touch.clientX;
      lastLY = touch.clientY;
      const speed = AIM_SENSITIVITY * 0.18;
      CH.x = clamp(CH.x + dx * speed, 0, rect.width);
      CH.y = clamp(CH.y + dy * speed, 0, rect.height);
      updateCH();
    }
  };

  const onLookEnd = event => {
    for (const touch of event.changedTouches) {
      if (touch.identifier === lookId) lookId = null;
    }
  };

  arena.addEventListener('touchstart', onLookStart, { passive: false });
  arena.addEventListener('touchmove', onLookMove, { passive: false });
  arena.addEventListener('touchend', onLookEnd);
  arena.addEventListener('touchcancel', onLookEnd);

  AIM._cleanLook = () => {
    arena.removeEventListener('touchstart', onLookStart);
    arena.removeEventListener('touchmove', onLookMove);
    arena.removeEventListener('touchend', onLookEnd);
    arena.removeEventListener('touchcancel', onLookEnd);
  };

  const fireBtn = document.getElementById('fire-btn');
  fireBtn.style.display = 'flex';

  let fireId = null;
  let firePX = 0;
  let firePY = 0;
  let fireAX = 0;
  let fireAY = 0;
  let fireDrag = false;
  let fireStartTime = 0;

  const onFireStart = event => {
    event.preventDefault();
    event.stopPropagation();
    if (fireId !== null) return;
    const touch = event.changedTouches[0];
    fireId = touch.identifier;
    firePX = touch.clientX;
    firePY = touch.clientY;
    fireAX = touch.clientX;
    fireAY = touch.clientY;
    fireDrag = false;
    fireStartTime = Date.now();
    if (lookId === null) {
      lookId = touch.identifier;
      lastLX = touch.clientX;
      lastLY = touch.clientY;
    }
  };

  const onFireMove = event => {
    event.preventDefault();
    event.stopPropagation();
    rect = arena.getBoundingClientRect();
    for (const touch of event.changedTouches) {
      if (touch.identifier !== fireId) continue;
      if (Math.hypot(touch.clientX - fireAX, touch.clientY - fireAY) > 8) {
        fireDrag = true;
      }
      if (fireDrag) {
        const dx = touch.clientX - firePX;
        const dy = touch.clientY - firePY;
        const speed = AIM_SENSITIVITY * 0.18;
        CH.x = clamp(CH.x + dx * speed, 0, rect.width);
        CH.y = clamp(CH.y + dy * speed, 0, rect.height);
        updateCH();
      }
      firePX = touch.clientX;
      firePY = touch.clientY;
    }
  };

  const onFireEnd = event => {
    event.preventDefault();
    event.stopPropagation();
    for (const touch of event.changedTouches) {
      if (touch.identifier !== fireId) continue;
      fireId = null;
      if (lookId === touch.identifier) lookId = null;
      if (!fireDrag && Date.now() - fireStartTime < 200) {
        fireTap(event);
      }
      fireDrag = false;
    }
  };

  fireBtn.addEventListener('touchstart', onFireStart, { passive: false });
  fireBtn.addEventListener('touchmove', onFireMove, { passive: false });
  fireBtn.addEventListener('touchend', onFireEnd, { passive: false });
  fireBtn.addEventListener('touchcancel', onFireEnd, { passive: false });

  AIM._cleanFire = () => {
    fireBtn.removeEventListener('touchstart', onFireStart);
    fireBtn.removeEventListener('touchmove', onFireMove);
    fireBtn.removeEventListener('touchend', onFireEnd);
    fireBtn.removeEventListener('touchcancel', onFireEnd);
    fireBtn.style.display = 'none';
  };

  JOY.raf = requestAnimationFrame(animateCH);
}

function animateCH() {
  if (!AIM.finished) {
    JOY.raf = requestAnimationFrame(animateCH);
  }
}

function fireTap(event) {
  event.preventDefault();
  if (AIM.finished) return;

  let hit = false;
  document.querySelectorAll('.aim-target').forEach(target => {
    if (hit) return;
    const tx = parseFloat(target.style.left);
    const ty = parseFloat(target.style.top);
    const radius = parseInt(target.style.width, 10) / 2;
    if (Math.hypot(CH.x - tx, CH.y - ty) < radius + 6) {
      target.dispatchEvent(new Event('mobileHit'));
      hit = true;
    }
  });

  if (!hit) {
    AIM.shots += 1;
    AIM.streak = 0;
    updateAimHUD();
    flashAimMiss();
  }

  const btn = document.getElementById('fire-btn');
  btn.style.background = 'rgba(239,68,68,.5)';
  setTimeout(() => {
    btn.style.background = 'rgba(239,68,68,.2)';
  }, 100);
}

function startSensitivityCal() {
  setProgress(getAimMeta().step);
  cleanupSensitivity();

  SENS.hits = 0;
  document.getElementById('sens-hits-count').textContent = '0';
  document.getElementById('sens-value').textContent = AIM_SENSITIVITY;
  document.getElementById('sens-slider').value = AIM_SENSITIVITY;
  document.getElementById('sens-start-btn').disabled = true;
  showScreen('s-aim-sensitivity');

  const arena = document.getElementById('sens-arena');
  const rect = arena.getBoundingClientRect();
  SENS.ch.x = rect.width / 2;
  SENS.ch.y = rect.height / 2;

  const ch = document.getElementById('sens-crosshair');
  ch.style.display = 'block';
  ch.style.left = SENS.ch.x + 'px';
  ch.style.top = SENS.ch.y + 'px';
  document.getElementById('sens-joy-wrap').style.display = 'none';

  let sensLookId = null;
  let sensLX = 0;
  let sensLY = 0;

  const onSensStart = event => {
    event.preventDefault();
    if (sensLookId !== null) return;
    const touch = event.changedTouches[0];
    sensLookId = touch.identifier;
    sensLX = touch.clientX;
    sensLY = touch.clientY;
  };

  const onSensMove = event => {
    event.preventDefault();
    const currentRect = arena.getBoundingClientRect();
    for (const touch of event.changedTouches) {
      if (touch.identifier !== sensLookId) continue;
      const dx = touch.clientX - sensLX;
      const dy = touch.clientY - sensLY;
      sensLX = touch.clientX;
      sensLY = touch.clientY;
      const speed = AIM_SENSITIVITY * 0.18;
      SENS.ch.x = clamp(SENS.ch.x + dx * speed, 0, currentRect.width);
      SENS.ch.y = clamp(SENS.ch.y + dy * speed, 0, currentRect.height);
      ch.style.left = SENS.ch.x + 'px';
      ch.style.top = SENS.ch.y + 'px';

      const target = document.getElementById('sens-target');
      if (target) {
        const dist = Math.hypot(SENS.ch.x - parseFloat(target.style.left), SENS.ch.y - parseFloat(target.style.top));
        target.style.boxShadow = dist < 35 ? '0 0 0 4px rgba(239,68,68,.5)' : '';
      }
    }
  };

  const onSensEnd = event => {
    for (const touch of event.changedTouches) {
      if (touch.identifier === sensLookId) sensLookId = null;
    }
  };

  arena.addEventListener('touchstart', onSensStart, { passive: false });
  arena.addEventListener('touchmove', onSensMove, { passive: false });
  arena.addEventListener('touchend', onSensEnd);
  arena.addEventListener('touchcancel', onSensEnd);

  SENS._cleanArena = () => {
    arena.removeEventListener('touchstart', onSensStart);
    arena.removeEventListener('touchmove', onSensMove);
    arena.removeEventListener('touchend', onSensEnd);
    arena.removeEventListener('touchcancel', onSensEnd);
  };

  const fireBtn = document.getElementById('fire-btn');
  fireBtn.style.display = 'flex';

  let sensFireId = null;
  let sensFPX = 0;
  let sensFPY = 0;
  let sensFAX = 0;
  let sensFAY = 0;
  let sensDrag = false;
  let sensStartTime = 0;

  const onSensFireStart = event => {
    event.preventDefault();
    event.stopPropagation();
    if (sensFireId !== null) return;
    const touch = event.changedTouches[0];
    sensFireId = touch.identifier;
    sensFPX = touch.clientX;
    sensFPY = touch.clientY;
    sensFAX = touch.clientX;
    sensFAY = touch.clientY;
    sensDrag = false;
    sensStartTime = Date.now();
    if (sensLookId === null) {
      sensLookId = touch.identifier;
      sensLX = touch.clientX;
      sensLY = touch.clientY;
    }
  };

  const onSensFireMove = event => {
    event.preventDefault();
    event.stopPropagation();
    const currentRect = arena.getBoundingClientRect();
    for (const touch of event.changedTouches) {
      if (touch.identifier !== sensFireId) continue;
      if (Math.hypot(touch.clientX - sensFAX, touch.clientY - sensFAY) > 8) {
        sensDrag = true;
      }
      if (sensDrag) {
        const dx = touch.clientX - sensFPX;
        const dy = touch.clientY - sensFPY;
        const speed = AIM_SENSITIVITY * 0.18;
        SENS.ch.x = clamp(SENS.ch.x + dx * speed, 0, currentRect.width);
        SENS.ch.y = clamp(SENS.ch.y + dy * speed, 0, currentRect.height);
        ch.style.left = SENS.ch.x + 'px';
        ch.style.top = SENS.ch.y + 'px';
      }
      sensFPX = touch.clientX;
      sensFPY = touch.clientY;
    }
  };

  const onSensFireEnd = event => {
    event.preventDefault();
    event.stopPropagation();
    for (const touch of event.changedTouches) {
      if (touch.identifier !== sensFireId) continue;
      sensFireId = null;
      if (sensLookId === touch.identifier) sensLookId = null;
      if (!sensDrag && Date.now() - sensStartTime < 200) {
        sensFire();
      }
      sensDrag = false;
    }
  };

  fireBtn.addEventListener('touchstart', onSensFireStart, { passive: false });
  fireBtn.addEventListener('touchmove', onSensFireMove, { passive: false });
  fireBtn.addEventListener('touchend', onSensFireEnd, { passive: false });
  fireBtn.addEventListener('touchcancel', onSensFireEnd, { passive: false });

  SENS._cleanFire = () => {
    fireBtn.removeEventListener('touchstart', onSensFireStart);
    fireBtn.removeEventListener('touchmove', onSensFireMove);
    fireBtn.removeEventListener('touchend', onSensFireEnd);
    fireBtn.removeEventListener('touchcancel', onSensFireEnd);
    fireBtn.style.display = 'none';
  };

  SENS.raf = requestAnimationFrame(animateSensCH);
  moveSensTarget();
}

function cleanupSensitivity() {
  if (SENS.raf) cancelAnimationFrame(SENS.raf);
  if (sensTargetTimer) clearTimeout(sensTargetTimer);
  if (SENS._cleanArena) {
    SENS._cleanArena();
    SENS._cleanArena = null;
  }
  if (SENS._cleanFire) {
    SENS._cleanFire();
    SENS._cleanFire = null;
  }
  document.getElementById('sens-crosshair').style.display = 'none';
  document.getElementById('fire-btn').style.display = 'none';
}

function updateSensitivity(value) {
  AIM_SENSITIVITY = parseInt(value, 10);
  document.getElementById('sens-value').textContent = AIM_SENSITIVITY;
}

function animateSensCH() {
  SENS.raf = requestAnimationFrame(animateSensCH);
}

function moveSensTarget() {
  if (sensTargetTimer) clearTimeout(sensTargetTimer);
  const arena = document.getElementById('sens-arena');
  const rect = arena.getBoundingClientRect();
  const margin = 36;
  const tx = margin + Math.random() * (rect.width - margin * 2);
  const ty = margin + Math.random() * (rect.height - margin * 2);
  const target = document.getElementById('sens-target');
  target.style.left = tx + 'px';
  target.style.top = ty + 'px';
  sensTargetTimer = setTimeout(moveSensTarget, 4000);
}

function sensFire() {
  const target = document.getElementById('sens-target');
  if (!target) return;
  const tx = parseFloat(target.style.left);
  const ty = parseFloat(target.style.top);
  if (Math.hypot(SENS.ch.x - tx, SENS.ch.y - ty) < 35) {
    SENS.hits += 1;
    document.getElementById('sens-hits-count').textContent = SENS.hits;
    if (SENS.hits >= 3) {
      document.getElementById('sens-start-btn').disabled = false;
    }
    target.style.transform = 'translate(-50%,-50%) scale(0.4)';
    setTimeout(() => {
      target.style.transform = 'translate(-50%,-50%) scale(1)';
      moveSensTarget();
    }, 180);
  }
}

function startAimFromSensitivity() {
  cleanupSensitivity();
  startAim();
}
