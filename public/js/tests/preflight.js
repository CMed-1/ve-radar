const PREFLIGHT = {
  stage: 'idle',
  frameMs: null,
  networkRttMs: null,
  connectionRttMs: null,
  tapCount: 0,
  dispatchDelays: []
};

function setPreflightStatus(text, tone = 'sub') {
  const status = document.getElementById('preflight-status');
  if (!status) return;
  status.textContent = text;
  status.style.color = tone === 'good'
    ? 'var(--cyan)'
    : tone === 'warn'
      ? 'var(--yellow)'
      : tone === 'bad'
        ? 'var(--red)'
        : 'var(--sub)';
}

function formatLatency(value) {
  return Number.isFinite(value) ? `${Math.round(value)}ms` : '—';
}

function median(values) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function setPreflightMetric(id, value, sub = '') {
  const num = document.getElementById(id);
  const desc = document.getElementById(`${id}-sub`);
  if (num) num.textContent = value;
  if (desc) desc.textContent = sub;
}

function setPreflightTapStage(active) {
  const zone = document.getElementById('preflight-tap-zone');
  if (!zone) return;
  zone.style.display = active ? 'flex' : 'none';
  zone.classList.toggle('armed', active);
}

function updatePreflightTapCount() {
  const count = document.getElementById('preflight-tap-count');
  if (count) count.textContent = `${PREFLIGHT.tapCount}/5`;
}

function estimateConnectionRtt() {
  const rtt = Number(navigator.connection?.rtt);
  return Number.isFinite(rtt) ? rtt : null;
}

function sampleFrameMs(frames = 18) {
  return new Promise(resolve => {
    const deltas = [];
    let prev = null;
    const tick = now => {
      if (prev !== null) {
        deltas.push(now - prev);
      }
      prev = now;
      if (deltas.length >= frames) {
        resolve(median(deltas));
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function sampleNetworkRtt(attempts = 3) {
  const values = [];
  for (let i = 0; i < attempts; i += 1) {
    const start = performance.now();
    try {
      await fetch(`/api/ping?ts=${Date.now()}_${i}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' }
      });
      values.push(performance.now() - start);
    } catch (_) {
      // ignore single failure
    }
  }
  return median(values);
}

async function beginPreflight() {
  const runBtn = document.getElementById('preflight-run-btn');
  const continueBtn = document.getElementById('preflight-continue-btn');
  if (runBtn) runBtn.disabled = true;
  if (continueBtn) continueBtn.disabled = true;

  PREFLIGHT.stage = 'network';
  PREFLIGHT.tapCount = 0;
  PREFLIGHT.dispatchDelays = [];
  updatePreflightTapCount();
  setPreflightTapStage(false);
  setPreflightStatus('正在检测网络与设备刷新率…');
  setPreflightMetric('preflight-device-num', '检测中', '估算浏览器输入 / 刷新延迟');
  setPreflightMetric('preflight-network-num', '检测中', '估算当前网络 RTT');

  const [frameMs, networkRttMs] = await Promise.all([
    sampleFrameMs(),
    sampleNetworkRtt()
  ]);

  PREFLIGHT.frameMs = frameMs;
  PREFLIGHT.networkRttMs = networkRttMs;
  PREFLIGHT.connectionRttMs = estimateConnectionRtt();

  setPreflightMetric(
    'preflight-network-num',
    formatLatency(networkRttMs),
    PREFLIGHT.connectionRttMs !== null
      ? `连接接口 RTT ${Math.round(PREFLIGHT.connectionRttMs)}ms（兼容性有限）`
      : '已用真实请求往返测量'
  );

  PREFLIGHT.stage = 'device';
  setPreflightTapStage(true);
  setPreflightStatus('请连续点击下方区域 5 次，用来估算设备输入延迟。', 'good');
}

function finishPreflight() {
  const inputDelayMs = median(PREFLIGHT.dispatchDelays);
  const frameMs = PREFLIGHT.frameMs || 16;
  const deviceLatencyMs = Number.isFinite(inputDelayMs)
    ? Math.min(50, Math.round(inputDelayMs + frameMs))
    : Math.min(50, Math.round(frameMs));
  const correctionMs = Math.min(35, deviceLatencyMs);

  rawData.preflight = {
    frameMs: Math.round(frameMs),
    inputDelayMs: Number.isFinite(inputDelayMs) ? Math.round(inputDelayMs) : null,
    deviceLatencyMs,
    deviceLatencyCorrectionMs: correctionMs,
    networkRttMs: Number.isFinite(PREFLIGHT.networkRttMs) ? Math.round(PREFLIGHT.networkRttMs) : null,
    connectionRttMs: Number.isFinite(PREFLIGHT.connectionRttMs) ? Math.round(PREFLIGHT.connectionRttMs) : null,
    completedAt: new Date().toISOString()
  };

  setPreflightMetric(
    'preflight-device-num',
    formatLatency(deviceLatencyMs),
    `评分修正最多扣除 ${correctionMs}ms，避免高估`
  );
  setPreflightStatus('环境预检完成。网络 RTT 仅记录；反应分只按设备延迟做修正。', 'good');
  setPreflightTapStage(false);
  PREFLIGHT.stage = 'done';
  const continueBtn = document.getElementById('preflight-continue-btn');
  if (continueBtn) continueBtn.disabled = false;
}

function handlePreflightTap(event) {
  if (PREFLIGHT.stage !== 'device') return;
  event.preventDefault();
  const zone = document.getElementById('preflight-tap-zone');
  if (zone) {
    zone.classList.remove('hit');
    void zone.offsetWidth;
    zone.classList.add('hit');
  }

  const delay = clamp(Math.round(performance.now() - event.timeStamp), 0, 120);
  PREFLIGHT.dispatchDelays.push(delay);
  PREFLIGHT.tapCount += 1;
  updatePreflightTapCount();

  if (PREFLIGHT.tapCount >= 5) {
    finishPreflight();
  }
}

function continueAfterPreflight() {
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-text').textContent = '测试 1/9';
  showScreen('s-reaction-intro');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-text').textContent = '环境预检';
  updatePreflightTapCount();
  setPreflightMetric('preflight-device-num', '—', '开始后会检测浏览器输入 / 刷新延迟');
  setPreflightMetric('preflight-network-num', '—', '开始后会检测真实网络 RTT');
});
