const RT = {
  round: 0,
  total: 10,
  times: [],
  state: 'idle',
  timer: null,
  startTime: 0
};

function startReaction() {
  setProgress(1);
  showScreen('s-reaction-test');
  RT.round = 0;
  RT.times = [];
  RT.state = 'idle';
  nextReactionRound();
}

function nextReactionRound() {
  if (RT.round >= RT.total) {
    finishReaction();
    return;
  }

  RT.round += 1;
  document.getElementById('rt-round').textContent = RT.round;

  const arena = document.getElementById('reaction-arena');
  const text = document.getElementById('arena-text');
  const sub = document.getElementById('arena-sub');

  arena.className = 'wait';
  text.textContent = '等待...';
  text.style.color = '';
  sub.textContent = '不要点击';
  RT.state = 'waiting';

  const delay = 1500 + Math.random() * 3000;
  RT.timer = setTimeout(() => {
    if (RT.state !== 'waiting') return;
    RT.state = 'go';
    arena.className = 'go';
    text.textContent = '现在！';
    text.style.color = 'var(--cyan)';
    sub.textContent = '点击！';
    RT.startTime = performance.now();
    RT.timer = setTimeout(() => {
      if (RT.state !== 'go') return;
      RT.times.push(null);
      addRTChip('超时', 'err');
      RT.state = 'idle';
      setTimeout(nextReactionRound, 800);
    }, 2000);
  }, delay);
}

function handleReactionClick() {
  if (RT.state === 'waiting') {
    clearTimeout(RT.timer);
    const arena = document.getElementById('reaction-arena');
    arena.className = 'early';
    document.getElementById('arena-text').textContent = '抢跑！';
    document.getElementById('arena-text').style.color = 'var(--red)';
    document.getElementById('arena-sub').textContent = '请等待信号变亮';
    addRTChip('抢跑', 'err');
    RT.state = 'idle';
    setTimeout(nextReactionRound, 1200);
  } else if (RT.state === 'go') {
    clearTimeout(RT.timer);
    const time = Math.round(performance.now() - RT.startTime);
    RT.times.push(time);
    const quality = time < 200 ? 'good' : time < 280 ? 'ok' : 'slow';
    addRTChip(time + 'ms', quality);
    document.getElementById('reaction-arena').className = 'ready';
    document.getElementById('arena-text').textContent = time + ' ms';
    document.getElementById('arena-sub').textContent = time < 200 ? '极快！' : time < 280 ? '不错' : '继续加油';
    RT.state = 'idle';
    setTimeout(nextReactionRound, 900);
  }
}

function addRTChip(text, cls) {
  const wrap = document.getElementById('reaction-results');
  const existing = wrap.querySelectorAll('.rt-chip');
  if (existing.length >= 3) existing[0].remove();
  const chip = document.createElement('div');
  chip.className = 'rt-chip ' + cls;
  chip.textContent = text;
  wrap.appendChild(chip);
}

function finishReaction() {
  const valid = RT.times.filter(time => time !== null);
  const filtered = filterRTOutliers(valid);
  rawData.reactionTimes = filtered;
  rawData.reactionTimesRaw = valid; // 原始数据保留供调试
  const avg = filtered.length ? filtered.reduce((sum, time) => sum + time, 0) / filtered.length : 400;

  let score;
  if (avg < 190) score = 100;
  else if (avg < 210) score = Math.round(90 + (210 - avg) / 20 * 10);
  else if (avg < 260) score = Math.round(50 + (260 - avg) / 50 * 40);
  else if (avg < 350) score = Math.round(15 + (350 - avg) / 90 * 35);
  else score = Math.max(0, Math.round(15 - (avg - 350) / 150 * 15));

  scores.reaction = clamp(score, 0, 100);
  showScreen('s-gng-intro');
}
