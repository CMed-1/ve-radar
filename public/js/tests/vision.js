const VIS = {
  round: 0,
  total: 10,
  correct: 0,
  currentDigits: '',
  state: 'idle'
};

const VIS_CONFIG = [
  [4, 350],
  [4, 300],
  [5, 300],
  [5, 250],
  [6, 250],
  [6, 220],
  [6, 200],
  [6, 180],
  [6, 160],
  [7, 200]
];

function startVision() {
  setProgress(3);
  VIS.round = 0;
  VIS.correct = 0;
  VIS.state = 'idle';
  showScreen('s-vision-test');
  updateVisionUI();
}

function updateVisionUI() {
  document.getElementById('vision-round').textContent = VIS.round + 1;
  document.getElementById('vision-info').textContent = `第 ${VIS.round + 1} 轮，共 ${VIS_CONFIG[VIS.round][0]} 位数字`;
  document.getElementById('vision-display').textContent = '···';
  document.getElementById('vision-input').value = '';
  document.getElementById('vision-input').disabled = true;
  document.getElementById('vision-feedback').textContent = '';
  document.getElementById('vision-feedback').className = 'vision-feedback';
  document.getElementById('vision-btn').textContent = '显示数字';
  document.getElementById('vision-btn').disabled = false;
  document.getElementById('vision-btn').onclick = showVisionDigits;
}

function showVisionDigits() {
  if (VIS.state !== 'idle') return;
  VIS.state = 'showing';

  const [digits, duration] = VIS_CONFIG[VIS.round];
  const num = generateDigits(digits);
  VIS.currentDigits = num;
  document.getElementById('vision-btn').disabled = true;
  document.getElementById('vision-btn').textContent = '观察中...';
  document.getElementById('vision-display').textContent = num;

  setTimeout(() => {
    document.getElementById('vision-display').textContent = '?????'.slice(0, digits);
    document.getElementById('vision-input').disabled = false;
    document.getElementById('vision-input').focus();
    VIS.state = 'answering';
    document.getElementById('vision-btn').textContent = '确认答案';
    document.getElementById('vision-btn').disabled = false;
    document.getElementById('vision-btn').onclick = confirmVision;
  }, duration);
}

function confirmVision() {
  if (VIS.state !== 'answering') return;

  const answer = document.getElementById('vision-input').value.trim();
  const correct = answer === VIS.currentDigits;

  if (correct) {
    VIS.correct += 1;
    document.getElementById('vision-feedback').textContent = '✓ 正确！';
    document.getElementById('vision-feedback').className = 'vision-feedback correct';
  } else {
    document.getElementById('vision-feedback').textContent = `✗ 错误，正确答案是：${VIS.currentDigits}`;
    document.getElementById('vision-feedback').className = 'vision-feedback wrong';
  }

  VIS.state = 'idle';
  VIS.round += 1;
  if (VIS.round >= VIS.total) {
    setTimeout(finishVision, 1000);
  } else {
    setTimeout(updateVisionUI, 1200);
  }
}

document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && VIS.state === 'answering') {
    confirmVision();
  }
});

function generateDigits(count) {
  let digits = '';
  for (let i = 0; i < count; i += 1) {
    digits += Math.floor(Math.random() * 10);
  }
  return digits;
}

function finishVision() {
  rawData.visionCorrect = VIS.correct;
  rawData.visionTotal = VIS.total;
  scores.vision = Math.round(VIS.correct / VIS.total * 100);
  showScreen('s-nback-intro');
}
