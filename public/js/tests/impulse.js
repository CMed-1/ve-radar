const GNG = {
  round: 0,
  total: 24,
  state: 'idle',
  hits: 0,
  falseAlarms: 0,
  misses: 0,
  isGo: false,
  timer: null,
  startTime: 0,
  rtTimes: []
};

let gngSequence = [];

function startGNG() {
  setProgress(2);
  gngSequence = shuffle([...Array(17).fill(true), ...Array(7).fill(false)]);
  GNG.round = 0;
  GNG.hits = 0;
  GNG.falseAlarms = 0;
  GNG.misses = 0;
  GNG.rtTimes = [];
  showScreen('s-gng-test');
  setTimeout(nextGNGRound, 800);
}

function nextGNGRound() {
  if (GNG.round >= GNG.total) {
    finishGNG();
    return;
  }

  const arena = document.getElementById('gng-arena');
  GNG.isGo = gngSequence[GNG.round];
  GNG.round += 1;
  document.getElementById('gng-round').textContent = GNG.round;
  arena.className = 'blank';
  arena.textContent = '···';
  GNG.state = 'blank';

  setTimeout(() => {
    arena.className = GNG.isGo ? 'go-signal' : 'nogo-signal';
    arena.textContent = GNG.isGo ? 'GO!' : 'STOP';
    GNG.state = 'active';
    GNG.startTime = performance.now();
    GNG.timer = setTimeout(() => {
      if (GNG.state !== 'active') return;
      GNG.state = 'idle';
      if (GNG.isGo) {
        GNG.misses += 1;
        document.getElementById('gng-miss').textContent = GNG.misses;
      }
      setTimeout(nextGNGRound, 300);
    }, 800);
  }, 400 + Math.random() * 200);
}

function handleGNG() {
  if (GNG.state !== 'active') return;
  clearTimeout(GNG.timer);

  const rt = performance.now() - GNG.startTime;
  GNG.state = 'idle';
  const arena = document.getElementById('gng-arena');

  if (GNG.isGo) {
    GNG.hits += 1;
    GNG.rtTimes.push(rt);
    document.getElementById('gng-hits').textContent = GNG.hits;
    arena.style.transform = 'scale(0.95)';
    setTimeout(() => {
      arena.style.transform = '';
    }, 150);
  } else {
    GNG.falseAlarms += 1;
    document.getElementById('gng-false').textContent = GNG.falseAlarms;
    arena.style.boxShadow = '0 0 40px rgba(239,68,68,0.6)';
    setTimeout(() => {
      arena.style.boxShadow = '';
    }, 300);
  }

  setTimeout(nextGNGRound, 350);
}

function finishGNG() {
  rawData.gngHits = GNG.hits;
  rawData.gngFalseAlarms = GNG.falseAlarms;
  rawData.gngMisses = GNG.misses;

  let score = 85 - GNG.falseAlarms * 32 - GNG.misses * 7;
  if (GNG.rtTimes.length) {
    const avgRT = GNG.rtTimes.reduce((sum, time) => sum + time, 0) / GNG.rtTimes.length;
    if (avgRT < 260) {
      score = Math.min(100, score + 3);
    }
  }

  scores.impulse = clamp(Math.round(score), 0, 100);
  showScreen('s-vision-intro');
}
