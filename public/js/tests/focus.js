const RT2 = {
  round: 0,
  total: 8,
  times: [],
  state: 'idle',
  timer: null,
  startTime: 0
};

function startReaction2() {
  setProgress(9);
  RT2.round = 0;
  RT2.times = [];
  RT2.state = 'idle';
  document.getElementById('reaction2-results').innerHTML = '';
  showScreen('s-reaction2-test');
  nextReaction2Round();
}

function nextReaction2Round() {
  if (RT2.round >= RT2.total) {
    finishReaction2();
    return;
  }

  RT2.round += 1;
  document.getElementById('rt2-round').textContent = RT2.round;

  const arena = document.getElementById('reaction2-arena');
  arena.className = 'wait';
  document.getElementById('arena2-text').textContent = '等待...';
  document.getElementById('arena2-text').style.color = '';
  document.getElementById('arena2-sub').textContent = '不要点击';
  RT2.state = 'waiting';

  const delay = 1500 + Math.random() * 3000;
  RT2.timer = setTimeout(() => {
    if (RT2.state !== 'waiting') return;
    RT2.state = 'go';
    arena.className = 'go';
    document.getElementById('arena2-text').textContent = '现在！';
    document.getElementById('arena2-text').style.color = 'var(--cyan)';
    document.getElementById('arena2-sub').textContent = '点击！';
    RT2.startTime = performance.now();
    RT2.timer = setTimeout(() => {
      if (RT2.state !== 'go') return;
      RT2.times.push(null);
      addRT2Chip('超时', 'err');
      RT2.state = 'idle';
      setTimeout(nextReaction2Round, 800);
    }, 2000);
  }, delay);
}

function handleReaction2Click() {
  if (RT2.state === 'waiting') {
    clearTimeout(RT2.timer);
    document.getElementById('reaction2-arena').className = 'early';
    document.getElementById('arena2-text').textContent = '抢跑！';
    document.getElementById('arena2-text').style.color = 'var(--red)';
    document.getElementById('arena2-sub').textContent = '请等待信号变亮';
    addRT2Chip('抢跑', 'err');
    RT2.state = 'idle';
    setTimeout(nextReaction2Round, 1200);
  } else if (RT2.state === 'go') {
    clearTimeout(RT2.timer);
    const time = Math.round(performance.now() - RT2.startTime);
    RT2.times.push(time);
    const quality = time < 200 ? 'good' : time < 280 ? 'ok' : 'slow';
    addRT2Chip(time + 'ms', quality);
    document.getElementById('reaction2-arena').className = 'ready';
    document.getElementById('arena2-text').textContent = time + ' ms';
    document.getElementById('arena2-sub').textContent = time < 200 ? '极快！' : time < 280 ? '不错' : '继续加油';
    RT2.state = 'idle';
    setTimeout(nextReaction2Round, 900);
  }
}

function addRT2Chip(text, cls) {
  const wrap = document.getElementById('reaction2-results');
  const existing = wrap.querySelectorAll('.rt-chip');
  if (existing.length >= 3) existing[0].remove();
  const chip = document.createElement('div');
  chip.className = 'rt-chip ' + cls;
  chip.textContent = text;
  wrap.appendChild(chip);
}

function finishReaction2() {
  const valid1 = rawData.reactionTimes; // 已在一测时完成过滤
  const valid2 = filterRTOutliers(RT2.times.filter(time => time !== null));
  rawData.rt2Times = valid2;
  rawData.rt2TimesRaw = RT2.times.filter(time => time !== null);
  updateReactionScoreFromRawData();

  let rtStability = 50;
  if (valid1.length >= 4 && valid2.length >= 2) {
    const avg1 = valid1.reduce((sum, time) => sum + time, 0) / valid1.length;
    const avg2 = valid2.reduce((sum, time) => sum + time, 0) / valid2.length;
    const var1 = valid1.reduce((sum, time) => sum + (time - avg1) ** 2, 0) / valid1.length;
    const var2 = valid2.reduce((sum, time) => sum + (time - avg2) ** 2, 0) / valid2.length;
    const avgStd = (Math.sqrt(var1) + Math.sqrt(var2)) / 2;
    const drift = Math.max(0, avg2 - avg1);
    rtStability = 100 - avgStd / 28 * 45 - drift / 100 * 40;
  } else if (valid1.length >= 4) {
    const avg = valid1.reduce((sum, time) => sum + time, 0) / valid1.length;
    const variance = valid1.reduce((sum, time) => sum + (time - avg) ** 2, 0) / valid1.length;
    rtStability = 100 - Math.sqrt(variance) / 28 * 45;
  }

  const rtScore = clamp(Math.round(rtStability), 0, 100);
  const aimConsistency = rawData.aimConsistency ? rawData.aimConsistency.score : 50;
  rawData.focusBreakdown = {
    rtStability: rtScore,
    aimConsistency
  };

  const finalFocus = rawData.aimConsistency
    ? Math.round(rtScore * 0.7 + aimConsistency * 0.3)
    : rtScore;

  scores.focus = clamp(finalFocus, 0, 100);
  showFinalScreen();
}
