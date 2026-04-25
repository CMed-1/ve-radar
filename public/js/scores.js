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

/**
 * 剔除反应时中的离群数据，返回清洗后的数组（原数组不变）
 *
 * 两步策略：
 *  1. 硬性下限 100ms：人体视觉简单 RT 的生理极限，低于此值为误触/噪声
 *  2. IQR × 2 上下界：在通过下限的数据里统计离群点（2× 比 1.5× 更保守，
 *     防止把真实的极快反应也删掉）
 *
 * 安全条件：
 *  - 剩余样本 < 3 时跳过 IQR 步，避免小样本过度删除
 *  - IQR 过窄（< 15ms）时跳过，说明本身已经高度集中
 */
function filterRTOutliers(times) {
  if (!times || times.length < 2) return times || [];

  // 步骤 1：剔除生理不可能值（< 100ms）
  const plausible = times.filter(t => t >= 100);
  if (plausible.length === 0) return times; // 全部不合理则保留原始数据兜底
  if (plausible.length < 3) return plausible;

  // 步骤 2：IQR 离群剔除
  const sorted = [...plausible].sort((a, b) => a - b);
  const n = sorted.length;

  function lerp(arr, p) {
    const pos = p * (arr.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return arr[lo] + (pos - lo) * (arr[hi] - arr[lo]);
  }

  const q1 = lerp(sorted, 0.25);
  const q3 = lerp(sorted, 0.75);
  const iqr = q3 - q1;

  if (iqr < 15) return plausible; // 数据已经高度集中，无需再剔除

  const loFence = q1 - 2 * iqr;
  const hiFence = q3 + 2 * iqr;
  const filtered = plausible.filter(t => t >= loFence && t <= hiFence);

  // 只有保留足够样本时才采纳 IQR 结果（至少 3 个且不低于总量的一半）
  const minKeep = Math.max(3, Math.ceil(plausible.length * 0.5));
  return filtered.length >= minKeep ? filtered : plausible;
}

function setProgress(step) {
  const pct = step / TOTAL_TESTS * 100;
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-text').textContent = `测试 ${step}/${TOTAL_TESTS}`;
}

const LANDSCAPE_SCREENS = new Set(['s-aim-sensitivity', 's-aim-test']);

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

window.addEventListener('resize', () => {
  const active = document.querySelector('.screen.active');
  if (active && isMobile && LANDSCAPE_SCREENS.has(active.id)) {
    checkLandscape();
  }
});

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
