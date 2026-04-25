const TOTAL_TESTS = 9;
const device = sessionStorage.getItem('ve_device') || 'pc';
const isMobile = device === 'mobile';

if (!sessionStorage.getItem('ve_device')) {
  window.location.href = '/';
}

if (isMobile) {
  document.body.classList.add('mobile-device');
}

const scores = {
  reaction: 0,
  impulse: 0,
  vision: 0,
  cognition: 0,
  aim: 0,
  focus: 0,
  color: 0
};

const rawData = {
  preflight: null,
  reactionTimes: [],
  gngFalseAlarms: 0,
  gngMisses: 0,
  gngHits: 0,
  visionCorrect: 0,
  visionTotal: 0,
  gridTimes: [],
  gridErrors: 0,
  aimRounds: []
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function filterRTOutliers(times) {
  return VEScoreModel.filterRTOutliers(times);
}

function updateReactionScoreFromRawData() {
  const details = VEScoreModel.calcReactionScoreDetails(rawData);
  rawData.reactionBreakdown = {
    correctionMs: details.correctionMs,
    compositeAvgMs: details.compositeAvg,
    reaction1AvgMs: details.sources.reaction1?.observedAvg ?? null,
    reaction1CorrectedAvgMs: details.sources.reaction1?.correctedAvg ?? null,
    reaction2AvgMs: details.sources.reaction2?.observedAvg ?? null,
    reaction2CorrectedAvgMs: details.sources.reaction2?.correctedAvg ?? null,
    gngGoAvgMs: details.sources.gngGo?.observedAvg ?? null,
    gngGoCorrectedAvgMs: details.sources.gngGo?.correctedAvg ?? null
  };
  scores.reaction = clamp(details.score, 0, 100);
  return details;
}

function setProgress(step) {
  const pct = step / TOTAL_TESTS * 100;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-text').textContent = `测试 ${step}/${TOTAL_TESTS}`;
}

const LANDSCAPE_SCREENS = new Set(['s-aim-sensitivity', 's-aim-test']);

function updateVisualViewportVars() {
  const viewport = window.visualViewport;
  const width = viewport ? viewport.width : window.innerWidth;
  const height = viewport ? viewport.height : window.innerHeight;
  const offsetLeft = viewport ? viewport.offsetLeft : 0;
  const offsetTop = viewport ? viewport.offsetTop : 0;
  document.documentElement.style.setProperty('--vvw', `${Math.round(width)}px`);
  document.documentElement.style.setProperty('--vvh', `${Math.round(height)}px`);
  document.documentElement.style.setProperty('--vv-left', `${Math.round(offsetLeft)}px`);
  document.documentElement.style.setProperty('--vv-top', `${Math.round(offsetTop)}px`);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  const screen = document.getElementById(id);
  if (!screen) return;
  screen.classList.add('active');

  if (isMobile && LANDSCAPE_SCREENS.has(id)) {
    checkLandscape();
  } else {
    document.getElementById('landscape-prompt').style.display = 'none';
  }

  const aimTip = document.getElementById('aim-landscape-tip');
  if (aimTip) {
    aimTip.style.display = isMobile && id === 's-aim-intro' ? 'block' : 'none';
  }

  if (id.endsWith('-intro')) {
    const btn = screen.querySelector('.btn-start:not([disabled])');
    if (btn) startReadCountdown(btn);
  }
}

function checkLandscape() {
  const isPortrait = window.innerWidth <= window.innerHeight;
  document.getElementById('landscape-prompt').style.display = isPortrait ? 'flex' : 'none';
}

updateVisualViewportVars();
window.addEventListener('resize', () => {
  updateVisualViewportVars();
  const active = document.querySelector('.screen.active');
  if (active && isMobile && LANDSCAPE_SCREENS.has(active.id)) {
    checkLandscape();
  }
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateVisualViewportVars);
  window.visualViewport.addEventListener('scroll', updateVisualViewportVars);
}

function startReadCountdown(btn) {
  const originalText = btn.dataset.originalText || btn.textContent;
  btn.dataset.originalText = originalText;
  btn.disabled = true;

  let secs = 5;
  btn.textContent = `请先阅读说明… ${secs}s`;

  const timer = setInterval(() => {
    secs -= 1;
    if (secs <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = originalText;
    } else {
      btn.textContent = `请先阅读说明… ${secs}s`;
    }
  }, 1000);
}

function saveAnonymousResult() {
  const inviteCode = sessionStorage.getItem('ve_invited') === 'true'
    ? (sessionStorage.getItem('ve_code') || '')
    : '';
  fetch('/api/test-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scores, rawData, device, inviteCode })
  }).catch(() => {});
}

function showFinalScreen() {
  showScreen('s-final');
  sessionStorage.setItem('ve_scores', JSON.stringify(scores));
  sessionStorage.setItem('ve_rawdata', JSON.stringify(rawData));
  saveAnonymousResult();
  setTimeout(() => {
    window.location.href = '/preview.html';
  }, 2000);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
