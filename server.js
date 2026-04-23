require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const {
  initDB,
  generateCode,
  verifyCode,
  getAllCodes,
  saveContact,
  getAllContacts,
  recordReferralClick,
  recordReferralConversion,
  getReferralStats,
  saveTestResult,
  getAllTestResults,
  createPayment,
  getPaymentByOrderNo,
  getPaymentByToken,
  markPaymentPending,
  markPaymentPaid
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

initDB();

const APP_BASE_URL = String(process.env.APP_BASE_URL || '').replace(/\/+$/, '');
const EASYPAY_API_BASE = String(process.env.EASYPAY_API_BASE || 'https://www.liuhao.net').replace(/\/+$/, '');
const EASYPAY_PID = String(process.env.EASYPAY_PID || '').trim();
const EASYPAY_KEY = String(process.env.EASYPAY_KEY || '').trim();
const PAY_BASIC_PRICE = (parseFloat(process.env.PAY_BASIC_PRICE || '6.98') || 6.98).toFixed(2);
const PAY_ADVANCED_PRICE = (parseFloat(process.env.PAY_ADVANCED_PRICE || '19.98') || 19.98).toFixed(2);
const PAY_BASIC_NAME = process.env.PAY_BASIC_NAME || 'VE天赋雷达基础版报告';
const PAY_ADVANCED_NAME = process.env.PAY_ADVANCED_NAME || 'VE天赋雷达进阶版报告';

function hasEasyPayConfig() {
  return Boolean(APP_BASE_URL && EASYPAY_API_BASE && EASYPAY_PID && EASYPAY_KEY);
}

function getPayProduct(mode) {
  if (mode === 'advanced') {
    return { mode: 'advanced', amount: PAY_ADVANCED_PRICE, name: PAY_ADVANCED_NAME };
  }
  return { mode: 'basic', amount: PAY_BASIC_PRICE, name: PAY_BASIC_NAME };
}

function buildEasyPaySign(params) {
  const text = Object.keys(params)
    .filter(key => !['sign', 'sign_type'].includes(key) && params[key] !== '' && params[key] !== null && params[key] !== undefined)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('md5').update(text + EASYPAY_KEY, 'utf8').digest('hex');
}

function verifyEasyPaySign(payload) {
  if (!payload || !payload.sign) return false;
  return buildEasyPaySign(payload) === String(payload.sign).toLowerCase();
}

function normalizeChannel(channel) {
  return channel === 'wxpay' ? 'wxpay' : 'alipay';
}

function buildOrderNo(mode) {
  return `VE${mode === 'advanced' ? 'A' : 'B'}${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function parseCookies(req) {
  const jar = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx <= 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    jar[key] = decodeURIComponent(value);
  });
  return jar;
}

function setPaymentCookie(res, token) {
  res.cookie('ve_pay_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: APP_BASE_URL.startsWith('https://'),
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/'
  });
}

function clearPaymentCookie(res) {
  res.clearCookie('ve_pay_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: APP_BASE_URL.startsWith('https://'),
    path: '/'
  });
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const rawIp = forwarded || req.socket.remoteAddress || '';
  const ip = rawIp.replace(/^::ffff:/, '');
  return ip.includes(':') ? '127.0.0.1' : (ip || '127.0.0.1');
}

function detectEasyPayDevice(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('micromessenger')) return 'wechat';
  if (ua.includes('alipayclient')) return 'alipay';
  if (/iphone|ipad|android|mobile/.test(ua)) return 'mobile';
  return 'pc';
}

function markPaymentAsPaid(orderNo, providerTradeNo, rawPayload) {
  const result = markPaymentPaid({ orderNo, providerTradeNo, rawNotify: rawPayload });
  if (result.updated && result.row?.ref_code) {
    recordReferralConversion(result.row.ref_code, result.row.mode);
  }
  return result.row;
}

async function fetchEasyPayOrder(orderNo) {
  const response = await axios.get(`${EASYPAY_API_BASE}/api.php`, {
    params: { act: 'order', pid: EASYPAY_PID, key: EASYPAY_KEY, out_trade_no: orderNo },
    timeout: 12000
  });
  return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
}

async function syncPaymentStatus(orderNo) {
  const current = getPaymentByOrderNo(orderNo);
  if (!current) return null;
  if (current.status === 'PAID' || !hasEasyPayConfig()) return current;

  try {
    const remote = await fetchEasyPayOrder(orderNo);
    if (remote && String(remote.code) === '1' && String(remote.status) === '1') {
      const amountMatches = parseFloat(remote.money) === parseFloat(current.amount);
      if (amountMatches) {
        return markPaymentAsPaid(orderNo, remote.trade_no || current.provider_trade_no, remote);
      }
    }
  } catch (err) {
    console.warn('[pay/sync]', err.message);
  }

  return getPaymentByOrderNo(orderNo);
}

function parseStoredJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function getScoreRating(scores) {
  const keys = ['reaction', 'impulse', 'vision', 'cognition', 'aim', 'focus', 'color'];
  const values = keys.map(key => Number(scores?.[key]) || 0);
  const avg = values.reduce((sum, value) => sum + value, 0) / keys.length;
  const above90 = values.filter(value => value >= 90).length;
  const above80 = values.filter(value => value >= 80).length;
  const minVal = Math.min(...values);
  if (avg >= 90 && above90 >= 4 && minVal >= 78) return '职业级天才少年';
  if (avg >= 76 && above80 >= 3) return '有潜力的电竞职业玩家';
  if (avg >= 45) return '普通玩家水平';
  return '弱于普通人水平';
}

function summarizeRawData(rawData) {
  const parts = [];
  if (Array.isArray(rawData?.reactionTimes) && rawData.reactionTimes.length) {
    const valid = rawData.reactionTimes.map(Number).filter(Number.isFinite);
    if (valid.length) {
      const avg = Math.round(valid.reduce((sum, time) => sum + time, 0) / valid.length);
      parts.push(`RT均值${avg}ms`);
    }
  }
  if (rawData?.aimHits !== undefined) {
    const rawKpm = getAimRawKpm(rawData);
    const effectiveKpm = getAimEffectiveKpm(rawData);
    const kpmText = effectiveKpm !== null
      ? `有效KPM${effectiveKpm}${rawKpm !== null ? `/原始${rawKpm}` : ''}`
      : '';
    parts.push(`Aim ${rawData.aimHits}/${rawData.aimShots || 0} 命中${kpmText ? ` · ${kpmText}` : ''}`);
  } else if (Array.isArray(rawData?.aimRounds) && rawData.aimRounds.length) {
    const hits = rawData.aimRounds.reduce((sum, round) => sum + (Number(round.hits) || 0), 0);
    const shots = rawData.aimRounds.reduce((sum, round) => sum + (Number(round.shots) || 0), 0);
    if (shots > 0) {
      parts.push(`Aim ${hits}/${shots} 命中`);
    } else {
      const accValues = rawData.aimRounds.map(round => Number(round.accuracy)).filter(Number.isFinite);
      const kpmValues = rawData.aimRounds.map(round => Number(round.kpm)).filter(Number.isFinite);
      const accAvg = accValues.length ? Math.round(accValues.reduce((sum, value) => sum + value, 0) / accValues.length * (accValues.some(value => value <= 1) ? 100 : 1)) : null;
      const kpmAvg = kpmValues.length ? Math.round(kpmValues.reduce((sum, value) => sum + value, 0) / kpmValues.length) : null;
      parts.push(`Aim ${accAvg ?? '--'}% / 有效KPM ${kpmAvg ?? '--'}`);
    }
  }
  if (rawData?.gngFalseAlarms !== undefined) {
    parts.push(`GNG误触${rawData.gngFalseAlarms}`);
  }
  if (rawData?.visionCorrect !== undefined) {
    parts.push(`视力${rawData.visionCorrect}/${rawData.visionTotal || 0}`);
  }
  return parts.join(' · ') || '暂无摘要';
}

function computeAimEffectiveKpm(rawKpm, accuracyPct, avgHitTime) {
  const raw = finiteNumber(rawKpm);
  const acc = finiteNumber(accuracyPct);
  const time = finiteNumber(avgHitTime);
  if (raw === null) return null;
  const accuracy = acc === null ? 1 : Math.max(0, Math.min(1, acc / 100));
  const responseKpm = time && time > 0 ? Math.round(60000 / time) : raw;
  const responseAdjustedKpm = Math.round(raw * 0.45 + responseKpm * 0.55);
  const accuracyFactor = Math.max(0.85, Math.min(1, 0.85 + accuracy * 0.15));
  return Math.max(0, Math.min(200, Math.round(Math.min(raw, responseAdjustedKpm) * accuracyFactor)));
}

function getAimRawKpm(raw) {
  const rawKpm = finiteNumber(raw?.aimRawKpm);
  if (rawKpm !== null) return rawKpm;
  return finiteNumber(raw?.aimKpm);
}

function getAimEffectiveKpm(raw) {
  const stored = finiteNumber(raw?.aimEffectiveKpm);
  if (stored !== null) return stored;
  return computeAimEffectiveKpm(getAimRawKpm(raw), raw?.aimAccuracy, raw?.aimAvgTime);
}

const CALIBRATION_METRICS = [
  { key: 'avgScore', group: '总分/七维', label: '综合均分', unit: '分', direction: 'higher' },
  { key: 'scoreReaction', group: '总分/七维', label: '反应速度分', unit: '分', direction: 'higher' },
  { key: 'scoreImpulse', group: '总分/七维', label: '冲动抑制分', unit: '分', direction: 'higher' },
  { key: 'scoreVision', group: '总分/七维', label: '动态视力分', unit: '分', direction: 'higher' },
  { key: 'scoreCognition', group: '总分/七维', label: '认知处理分', unit: '分', direction: 'higher' },
  { key: 'scoreAim', group: '总分/七维', label: '手眼协调分', unit: '分', direction: 'higher' },
  { key: 'scoreFocus', group: '总分/七维', label: '专注稳定分', unit: '分', direction: 'higher' },
  { key: 'scoreColor', group: '总分/七维', label: '色觉感知分', unit: '分', direction: 'higher' },
  { key: 'reactionAvgMs', group: '反应速度', label: '一测平均反应', unit: 'ms', direction: 'lower' },
  { key: 'reactionBestMs', group: '反应速度', label: '最快反应', unit: 'ms', direction: 'lower' },
  { key: 'reactionStdMs', group: '反应速度', label: '一测反应波动', unit: 'ms', direction: 'lower' },
  { key: 'rt2AvgMs', group: '专注稳定', label: '二测平均反应', unit: 'ms', direction: 'lower' },
  { key: 'rtDriftMs', group: '专注稳定', label: '二测-一测反应差', unit: 'ms', direction: 'lower' },
  { key: 'focusRtStability', group: '专注稳定', label: 'RT稳定性子分', unit: '分', direction: 'higher' },
  { key: 'focusAimConsistency', group: '专注稳定', label: 'Aim一致性子分', unit: '分', direction: 'higher' },
  { key: 'gngFalseAlarms', group: '冲动抑制', label: 'GNG误触', unit: '次', direction: 'lower' },
  { key: 'gngMisses', group: '冲动抑制', label: 'GNG漏触', unit: '次', direction: 'lower' },
  { key: 'gngHits', group: '冲动抑制', label: 'GNG正确命中', unit: '次', direction: 'higher' },
  { key: 'visionCorrect', group: '动态视力', label: '动态视力正确数', unit: '题', direction: 'higher' },
  { key: 'visionAccuracyPct', group: '动态视力', label: '动态视力正确率', unit: '%', direction: 'higher' },
  { key: 'gridAvgTimeSec', group: '认知处理', label: 'Grid平均耗时', unit: '秒', direction: 'lower' },
  { key: 'gridErrors', group: '认知处理', label: 'Grid错误数', unit: '次', direction: 'lower' },
  { key: 'nbackScore', group: '认知处理', label: 'N-back分数', unit: '分', direction: 'higher' },
  { key: 'nbackFalseAlarms', group: '认知处理', label: 'N-back误触', unit: '次', direction: 'lower' },
  { key: 'aimHits', group: 'Aim', label: '两轮总命中', unit: '次', direction: 'higher' },
  { key: 'aimKpm', group: 'Aim', label: '有效KPM', unit: '次/分', direction: 'higher' },
  { key: 'aimRawKpm', group: 'Aim', label: '原始KPM', unit: '次/分', direction: 'higher' },
  { key: 'aimAccuracy', group: 'Aim', label: '命中率', unit: '%', direction: 'higher' },
  { key: 'aimAvgTime', group: 'Aim', label: '平均命中时间', unit: 'ms', direction: 'lower' },
  { key: 'aimRound1Kpm', group: 'Aim', label: 'Aim一测有效KPM', unit: '次/分', direction: 'higher' },
  { key: 'aimRound2Kpm', group: 'Aim', label: 'Aim二测有效KPM', unit: '次/分', direction: 'higher' },
  { key: 'aimKpmDelta', group: 'Aim', label: '二测-一测有效KPM', unit: '次/分', direction: 'higher' },
  { key: 'aimAccuracyDelta', group: 'Aim', label: '二测-一测命中率', unit: '%', direction: 'higher' },
  { key: 'colorP1AccuracyPct', group: '色觉感知', label: '红色识别正确率', unit: '%', direction: 'higher' },
  { key: 'colorP1AvgRT', group: '色觉感知', label: '红色识别反应', unit: 'ms', direction: 'lower' },
  { key: 'colorP1FalseAlarms', group: '色觉感知', label: '红色识别误触', unit: '次', direction: 'lower' },
  { key: 'colorP2Correct', group: '色觉感知', label: '色差辨别正确数', unit: '个', direction: 'higher' },
  { key: 'colorP2AccuracyPct', group: '色觉感知', label: '色差辨别正确率', unit: '%', direction: 'higher' },
  { key: 'colorP2AvgRT', group: '色觉感知', label: '色差辨别耗时', unit: 'ms', direction: 'lower' }
];

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function average(values) {
  const nums = values.map(finiteNumber).filter(value => value !== null);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(sortedValues, q) {
  if (!sortedValues.length) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const pos = (sortedValues.length - 1) * q;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const weight = pos - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function summarizeMetric(values) {
  const nums = values.map(finiteNumber).filter(value => value !== null).sort((a, b) => a - b);
  if (!nums.length) return null;
  return {
    n: nums.length,
    mean: average(nums),
    sd: stddev(nums),
    min: nums[0],
    p25: percentile(nums, 0.25),
    p50: percentile(nums, 0.50),
    p75: percentile(nums, 0.75),
    p90: percentile(nums, 0.90),
    p95: percentile(nums, 0.95),
    max: nums[nums.length - 1]
  };
}

function addMetric(metrics, key, value) {
  const num = finiteNumber(value);
  if (num !== null) metrics[key] = num;
}

function extractCalibrationMetrics(row) {
  const scores = parseStoredJson(row.scores, {});
  const raw = parseStoredJson(row.raw_data, {});
  const metrics = {};

  addMetric(metrics, 'avgScore', row.avg_score);
  addMetric(metrics, 'scoreReaction', scores.reaction);
  addMetric(metrics, 'scoreImpulse', scores.impulse);
  addMetric(metrics, 'scoreVision', scores.vision);
  addMetric(metrics, 'scoreCognition', scores.cognition);
  addMetric(metrics, 'scoreAim', scores.aim);
  addMetric(metrics, 'scoreFocus', scores.focus);
  addMetric(metrics, 'scoreColor', scores.color);

  const reactionTimes = Array.isArray(raw.reactionTimes) ? raw.reactionTimes.map(finiteNumber).filter(value => value !== null) : [];
  if (reactionTimes.length) {
    addMetric(metrics, 'reactionAvgMs', average(reactionTimes));
    addMetric(metrics, 'reactionBestMs', Math.min(...reactionTimes));
    addMetric(metrics, 'reactionStdMs', stddev(reactionTimes));
  }
  const rt2Times = Array.isArray(raw.rt2Times) ? raw.rt2Times.map(finiteNumber).filter(value => value !== null) : [];
  if (rt2Times.length) {
    addMetric(metrics, 'rt2AvgMs', average(rt2Times));
    if (reactionTimes.length) addMetric(metrics, 'rtDriftMs', average(rt2Times) - average(reactionTimes));
  }
  addMetric(metrics, 'focusRtStability', raw.focusBreakdown?.rtStability);
  addMetric(metrics, 'focusAimConsistency', raw.focusBreakdown?.aimConsistency);

  addMetric(metrics, 'gngFalseAlarms', raw.gngFalseAlarms);
  addMetric(metrics, 'gngMisses', raw.gngMisses);
  addMetric(metrics, 'gngHits', raw.gngHits);

  addMetric(metrics, 'visionCorrect', raw.visionCorrect);
  if (finiteNumber(raw.visionCorrect) !== null && finiteNumber(raw.visionTotal) > 0) {
    addMetric(metrics, 'visionAccuracyPct', Number(raw.visionCorrect) / Number(raw.visionTotal) * 100);
  }

  if (Array.isArray(raw.gridTimes) && raw.gridTimes.length) {
    const gridTimes = raw.gridTimes.map(item => finiteNumber(item?.time)).filter(value => value !== null);
    if (gridTimes.length) addMetric(metrics, 'gridAvgTimeSec', average(gridTimes));
  }
  addMetric(metrics, 'gridErrors', raw.gridErrors);
  addMetric(metrics, 'nbackScore', raw.nbScore);
  addMetric(metrics, 'nbackFalseAlarms', raw.nbFalseAlarms);

  addMetric(metrics, 'aimHits', raw.aimHits);
  addMetric(metrics, 'aimKpm', getAimEffectiveKpm(raw));
  addMetric(metrics, 'aimRawKpm', getAimRawKpm(raw));
  addMetric(metrics, 'aimAccuracy', raw.aimAccuracy);
  addMetric(metrics, 'aimAvgTime', raw.aimAvgTime);
  if (Array.isArray(raw.aimRounds) && raw.aimRounds.length >= 2) {
    const [round1, round2] = raw.aimRounds;
    const round1Kpm = finiteNumber(round1?.effectiveKpm) ?? computeAimEffectiveKpm(finiteNumber(round1?.rawKpm) ?? round1?.kpm, round1?.accuracy, round1?.avgHitTime);
    const round2Kpm = finiteNumber(round2?.effectiveKpm) ?? computeAimEffectiveKpm(finiteNumber(round2?.rawKpm) ?? round2?.kpm, round2?.accuracy, round2?.avgHitTime);
    addMetric(metrics, 'aimRound1Kpm', round1Kpm);
    addMetric(metrics, 'aimRound2Kpm', round2Kpm);
    addMetric(metrics, 'aimKpmDelta', round2Kpm !== null && round1Kpm !== null ? round2Kpm - round1Kpm : null);
    addMetric(metrics, 'aimAccuracyDelta', finiteNumber(round2?.accuracy) !== null && finiteNumber(round1?.accuracy) !== null ? Number(round2.accuracy) - Number(round1.accuracy) : null);
  } else {
    addMetric(metrics, 'aimKpmDelta', raw.aimConsistency?.kpmDelta);
    addMetric(metrics, 'aimAccuracyDelta', raw.aimConsistency?.accuracyDelta);
  }

  if (finiteNumber(raw.colorP1Hits) !== null && finiteNumber(raw.colorP1Total) > 0) {
    addMetric(metrics, 'colorP1AccuracyPct', Number(raw.colorP1Hits) / Number(raw.colorP1Total) * 100);
  }
  addMetric(metrics, 'colorP1AvgRT', raw.colorP1AvgRT);
  addMetric(metrics, 'colorP1FalseAlarms', raw.colorP1FalseAlarms);
  addMetric(metrics, 'colorP2Correct', raw.colorP2Correct);
  if (finiteNumber(raw.colorP2Correct) !== null && finiteNumber(raw.colorP2Total) > 0) {
    addMetric(metrics, 'colorP2AccuracyPct', Number(raw.colorP2Correct) / Number(raw.colorP2Total) * 100);
  }
  addMetric(metrics, 'colorP2AvgRT', raw.colorP2AvgRT);

  return metrics;
}

function getCalibrationStage(n) {
  if (n >= 500) return { key: 'empirical', label: '可切换经验分位', note: '样本量已达到建议阈值，可考虑让报告页引用站内经验分位。' };
  if (n >= 100) return { key: 'mixed', label: '可进入混合校准', note: '建议采用 70% 临时模型 + 30% 站内经验分位，继续观察异常值。' };
  return { key: 'observe', label: '观察期', note: '样本量不足 100，建议只在后台观察，不自动影响前台报告。' };
}

function buildCalibrationGroup(rows, key, label) {
  const buckets = {};
  CALIBRATION_METRICS.forEach(metric => { buckets[metric.key] = []; });

  rows.forEach(row => {
    const metrics = extractCalibrationMetrics(row);
    Object.entries(metrics).forEach(([metricKey, value]) => {
      if (buckets[metricKey]) buckets[metricKey].push(value);
    });
  });

  const metrics = CALIBRATION_METRICS.map(metric => {
    const summary = summarizeMetric(buckets[metric.key] || []);
    return summary ? { ...metric, ...summary } : null;
  }).filter(Boolean);

  return {
    key,
    label,
    total: rows.length,
    stage: getCalibrationStage(rows.length),
    metrics
  };
}

function buildCalibrationStats(rows) {
  const devices = rows.reduce((acc, row) => {
    const key = row.device || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const groups = {
    all: buildCalibrationGroup(rows, 'all', '全体样本')
  };
  Object.keys(devices).sort().forEach(device => {
    groups[device] = buildCalibrationGroup(rows.filter(row => (row.device || 'unknown') === device), device, device === 'pc' ? 'PC样本' : device === 'mobile' ? '手机样本' : `${device}样本`);
  });
  return {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    devices,
    groups
  };
}

// ─── 邀请码验证 ───────────────────────────────────────────────
app.post('/api/verify-code', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.json({ success: false, message: '请输入邀请码' });
    res.json(verifyCode(code.trim()));
  } catch (err) {
    console.error('[verify-code]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 管理员：生成邀请码 ───────────────────────────────────────
app.post('/api/admin/generate-codes', async (req, res) => {
  try {
    const { password, count = 1, note = '' } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.json({ success: false, message: '管理员密码错误' });
    }
    const num = Math.min(Math.max(parseInt(count) || 1, 1), 200);
    const codes = [];
    for (let i = 0; i < num; i++) {
      codes.push(generateCode(note));
    }
    res.json({ success: true, codes });
  } catch (err) {
    console.error('[generate-codes]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 管理员：查看所有邀请码 ───────────────────────────────────
app.post('/api/admin/codes', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.json({ success: false, message: '管理员密码错误' });
    }
    res.json({ success: true, codes: getAllCodes() });
  } catch (err) {
    console.error('[admin/codes]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 管理员：查看所有联系方式 ─────────────────────────────────
app.post('/api/admin/contacts', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.json({ success: false, message: '管理员密码错误' });
    }
    res.json({ success: true, contacts: getAllContacts() });
  } catch (err) {
    console.error('[admin/contacts]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 管理员：查看匿名测试结果 ─────────────────────────────────
app.post('/api/admin/test-results', async (req, res) => {
  try {
    const { password, limit = 300 } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.json({ success: false, message: '管理员密码错误' });
    }

    const results = getAllTestResults(limit).map(row => {
      const scores = parseStoredJson(row.scores, {});
      const rawData = parseStoredJson(row.raw_data, {});
      return {
        id: row.id,
        device: row.device || 'unknown',
        inviteCode: row.invite_code || '',
        avgScore: row.avg_score === null || row.avg_score === undefined ? null : Number(row.avg_score),
        rating: getScoreRating(scores),
        scores,
        rawSummary: summarizeRawData(rawData),
        rawData,
        createdAt: row.created_at
      };
    });

    res.json({ success: true, results });
  } catch (err) {
    console.error('[admin/test-results]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 管理员：样本校准统计 ─────────────────────────────────────
app.post('/api/admin/calibration-stats', async (req, res) => {
  try {
    const { password, limit = 10000 } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.json({ success: false, message: '管理员密码错误' });
    }

    const rows = getAllTestResults(limit);
    res.json({ success: true, calibration: buildCalibrationStats(rows) });
  } catch (err) {
    console.error('[admin/calibration-stats]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 推荐追踪：记录点击 ───────────────────────────────────────
app.post('/api/referral/click', (req, res) => {
  try {
    const { code } = req.body;
    if (code && typeof code === 'string' && code.length <= 32) {
      recordReferralClick(code.trim());
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[referral/click]', err.message);
    res.json({ ok: false });
  }
});

// ─── 推荐追踪：记录转化 ───────────────────────────────────────
app.post('/api/referral/convert', (req, res) => {
  try {
    const { code, mode } = req.body;
    if (code && typeof code === 'string' && code.length <= 32) {
      recordReferralConversion(code.trim(), mode);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[referral/convert]', err.message);
    res.json({ ok: false });
  }
});

// ─── 管理员：推荐统计 ─────────────────────────────────────────
app.post('/api/admin/referral-stats', (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.json({ success: false, message: '管理员密码错误' });
    }
    res.json({ success: true, stats: getReferralStats() });
  } catch (err) {
    console.error('[admin/referral-stats]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 管理员：重置预览访问态（仅用于后台调试）──────────────────
app.post('/api/admin/debug/reset-preview-access', (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.json({ success: false, message: '管理员密码错误' });
    }
    clearPaymentCookie(res);
    res.json({ success: true });
  } catch (err) {
    console.error('[admin/debug/reset-preview-access]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 提交联系方式 ─────────────────────────────────────────────
app.post('/api/submit-contact', async (req, res) => {
  try {
    const { name, contact, contactType, rating, scores } = req.body;
    if (!contact) return res.json({ success: false, message: '联系方式不能为空' });
    saveContact({ name, contact, contactType, rating, scores });
    res.json({ success: true });
  } catch (err) {
    console.error('[submit-contact]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 匿名记录完整测评结果（用于后续经验分位校准）──────────────
app.post('/api/test-result', (req, res) => {
  try {
    const { scores, rawData, device, inviteCode } = req.body;
    if (!scores || typeof scores !== 'object') {
      return res.json({ success: false });
    }
    saveTestResult({ scores, rawData, device, inviteCode });
    res.json({ success: true });
  } catch (err) {
    console.error('[test-result]', err.message);
    res.json({ success: false });
  }
});

// ─── 创建支付订单（易支付 V1）────────────────────────────────
app.post('/api/pay/create', async (req, res) => {
  try {
    if (!hasEasyPayConfig()) {
      return res.status(500).json({ success: false, message: '支付配置未完成' });
    }

    const mode = req.body?.mode === 'advanced' ? 'advanced' : 'basic';
    const channel = normalizeChannel(req.body?.channel);
    const refCode = typeof req.body?.refCode === 'string' ? req.body.refCode.trim().toUpperCase() : '';
    const product = getPayProduct(mode);
    const orderNo = buildOrderNo(mode);

    createPayment({
      orderNo,
      mode: product.mode,
      channel,
      amount: product.amount,
      productName: product.name,
      refCode
    });

    const payload = {
      pid: EASYPAY_PID,
      type: channel,
      out_trade_no: orderNo,
      notify_url: `${APP_BASE_URL}/api/pay/notify/easypay`,
      return_url: `${APP_BASE_URL}/pay.html?orderNo=${encodeURIComponent(orderNo)}`,
      name: product.name,
      money: product.amount,
      clientip: getClientIp(req),
      device: detectEasyPayDevice(req),
      param: product.mode
    };
    payload.sign = buildEasyPaySign(payload);
    payload.sign_type = 'MD5';

    const response = await axios.post(
      `${EASYPAY_API_BASE}/mapi.php`,
      new URLSearchParams(payload).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      }
    );

    const data = typeof response.data === 'string' ? JSON.parse(response.data) : (response.data || {});
    if (String(data.code) !== '1') {
      return res.status(400).json({ success: false, message: data.msg || '创建支付订单失败' });
    }

    const payment = markPaymentPending({
      orderNo,
      providerTradeNo: data.trade_no || null,
      rawResponse: data
    });

    res.json({
      success: true,
      orderNo,
      mode: payment.mode,
      channel: payment.channel,
      amount: payment.amount,
      productName: payment.product_name,
      payurl: data.payurl || '',
      qrcode: data.qrcode || '',
      urlscheme: data.urlscheme || ''
    });
  } catch (err) {
    console.error('[pay/create]', err.message);
    res.status(500).json({ success: false, message: '创建支付订单失败，请稍后再试' });
  }
});

// ─── 查询订单状态（前端轮询 + 回跳兜底）──────────────────────
app.get('/api/pay/status', async (req, res) => {
  try {
    const orderNo = String(req.query.orderNo || '').trim();
    if (!orderNo) {
      return res.status(400).json({ success: false, message: '缺少订单号' });
    }

    const payment = await syncPaymentStatus(orderNo);
    if (!payment) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    if (payment.status === 'PAID') {
      setPaymentCookie(res, payment.report_token);
    }

    res.json({
      success: true,
      orderNo: payment.order_no,
      status: payment.status,
      paid: payment.status === 'PAID',
      mode: payment.mode,
      channel: payment.channel,
      amount: payment.amount,
      productName: payment.product_name
    });
  } catch (err) {
    console.error('[pay/status]', err.message);
    res.status(500).json({ success: false, message: '查询订单状态失败' });
  }
});

// ─── 支付异步通知（易支付 V1）────────────────────────────────
app.all('/api/pay/notify/easypay', (req, res) => {
  try {
    const payload = req.method === 'POST' ? req.body : req.query;
    if (!hasEasyPayConfig() || !payload || !payload.out_trade_no) {
      return res.type('text/plain').send('fail');
    }

    const payment = getPaymentByOrderNo(String(payload.out_trade_no).trim());
    if (!payment) {
      return res.type('text/plain').send('fail');
    }

    const amountMatches = parseFloat(payload.money) === parseFloat(payment.amount);
    const pidMatches = String(payload.pid) === EASYPAY_PID;
    const statusOk = payload.trade_status === 'TRADE_SUCCESS';
    const signOk = verifyEasyPaySign(payload);

    if (!amountMatches || !pidMatches || !statusOk || !signOk) {
      return res.type('text/plain').send('fail');
    }

    markPaymentAsPaid(payment.order_no, payload.trade_no || payment.provider_trade_no, payload);
    return res.type('text/plain').send('success');
  } catch (err) {
    console.error('[pay/notify]', err.message);
    return res.type('text/plain').send('fail');
  }
});

// ─── 报告访问状态（服务端支付凭证）──────────────────────────
app.get('/api/report/access', (req, res) => {
  try {
    const cookies = parseCookies(req);
    const token = cookies.ve_pay_token;
    if (!token) {
      return res.json({ success: true, access: false });
    }

    const payment = getPaymentByToken(token);
    if (!payment || payment.status !== 'PAID') {
      clearPaymentCookie(res);
      return res.json({ success: true, access: false });
    }

    res.json({
      success: true,
      access: true,
      mode: payment.mode,
      orderNo: payment.order_no,
      channel: payment.channel
    });
  } catch (err) {
    console.error('[report/access]', err.message);
    res.status(500).json({ success: false, access: false });
  }
});

// ─── 生成 AI 报告文字 ─────────────────────────────────────────
app.post('/api/generate-report', async (req, res) => {
  try {
    const { scores, rating, device, rawData, mode = 'advanced' } = req.body;
    const text = mode === 'basic'
      ? await callMiniMaxBasic(scores, rating, rawData)
      : await callMiniMax(scores, rating, device, rawData);
    res.json({ success: true, text });
  } catch (err) {
    console.error('MiniMax API 错误:', err.message);
    const { scores, rating, mode = 'advanced' } = req.body;
    res.json({ success: true, text: fallbackReport(scores, rating, mode) });
  }
});

function weightedFit(weights, scores) {
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + (scores[key] || 0) * weight, 0);
}

function buildRoleReason(track, key, scores, avg, spread) {
  const { reaction=0, impulse=0, vision=0, cognition=0, aim=0, focus=0 } = scores;
  if (track === 'fps') {
    if (key === 'duelist') return `反应速度 ${reaction} 分和手眼协调 ${aim} 分是主驱动，更适合先手切入与抢第一枪。若要把这个位置真正打稳，还要继续看专注稳定性 ${focus} 分是否能撑住长局。`;
    if (key === 'sniper') return `手眼协调 ${aim} 分、专注稳定性 ${focus} 分和动态视力 ${vision} 分更适合守点、架枪和精准击发。这类位置看重的是高压下的稳定兑现。`;
    if (key === 'controller') return `认知处理 ${cognition} 分与冲动抑制 ${impulse} 分更突出，说明你对信息判断、技能时机和节奏控制更敏感，适合承担控场与指挥型职责。`;
    return `七维均分 ${avg.toFixed(1)} 分，能力离散度约 ${spread.toFixed(0)} 分，结构不算偏科。弹性位更适合你按队伍需求切换职责，而不是被单一分工锁死。`;
  }
  if (key === 'jungler') return `认知处理 ${cognition} 分、反应速度 ${reaction} 分和动态视力 ${vision} 分的组合，更适合打野这种需要找时机、看线权和快速切入的角色。`;
  if (key === 'adc') return `手眼协调 ${aim} 分与专注稳定性 ${focus} 分更适合持续输出位。ADC 更看重长团中的稳定手感与输出纪律。`;
  if (key === 'mid') return `认知处理 ${cognition} 分、动态视力 ${vision} 分和反应速度 ${reaction} 分组合较好，更适合需要快速读图、支援和切换资源判断的中路。`;
  if (key === 'support') return `冲动抑制 ${impulse} 分、认知处理 ${cognition} 分与专注稳定性 ${focus} 分更适合辅助位。你更像是先做正确判断、再执行协同的人。`;
  return `专注稳定性 ${focus} 分和冲动抑制 ${impulse} 分让你更适合独立对线、稳定换血和承担边路压力。上单位更看重对线耐心和后程抗压。`;
}

function calcRoleTracks(scores) {
  const keys = ['reaction','impulse','vision','cognition','aim','focus','color'];
  const values = keys.map(key => scores[key] || 0);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const spread = Math.max(...values) - Math.min(...values);
  const pickRole = (track, list) => {
    const ranked = list.map(item => {
      let fit = weightedFit(item.weights, scores);
      if (item.key === 'flex') fit += spread <= 16 ? 6 : spread <= 24 ? 2 : -4;
      return { ...item, fit: Math.round(fit), reason: buildRoleReason(track, item.key, scores, avg, spread) };
    }).sort((a, b) => b.fit - a.fit);
    return ranked[0];
  };
  const fps = pickRole('fps', [
    { key:'duelist', role:'突击手 · Duelist', gameName:'Valorant / CS2', weights:{ reaction:0.36, aim:0.34, vision:0.16, impulse:0.08, focus:0.06 } },
    { key:'sniper', role:'狙击手 · Sniper', gameName:'Valorant / CS2', weights:{ aim:0.34, focus:0.30, reaction:0.18, vision:0.18 } },
    { key:'controller', role:'控场 / 指挥 · Controller', gameName:'Valorant / CS2', weights:{ cognition:0.32, impulse:0.24, focus:0.18, vision:0.14, aim:0.12 } },
    { key:'flex', role:'弹性位 · Flex', gameName:'Valorant / CS2', weights:{ reaction:0.18, aim:0.18, cognition:0.20, impulse:0.18, focus:0.18, vision:0.08 } }
  ]);
  const moba = pickRole('moba', [
    { key:'jungler', role:'打野 · Jungler', gameName:'英雄联盟 / 王者荣耀', weights:{ cognition:0.30, reaction:0.22, vision:0.18, focus:0.16, impulse:0.14 } },
    { key:'adc', role:'ADC · 射手', gameName:'英雄联盟 / 王者荣耀', weights:{ aim:0.34, focus:0.24, reaction:0.18, impulse:0.12, vision:0.12 } },
    { key:'mid', role:'中单 · Mid Lane', gameName:'英雄联盟 / 王者荣耀', weights:{ cognition:0.34, vision:0.22, reaction:0.18, impulse:0.16, focus:0.10 } },
    { key:'support', role:'辅助 · Support', gameName:'英雄联盟 / 王者荣耀', weights:{ impulse:0.34, cognition:0.26, focus:0.20, vision:0.10, reaction:0.10 } },
    { key:'top', role:'上单 · Top Lane', gameName:'英雄联盟 / 王者荣耀', weights:{ focus:0.28, impulse:0.24, reaction:0.20, cognition:0.18, aim:0.10 } }
  ]);
  const fpsFit = Math.round(weightedFit({ reaction:0.28, aim:0.28, vision:0.16, focus:0.12, color:0.08, cognition:0.05, impulse:0.03 }, scores));
  const mobaFit = Math.round(weightedFit({ cognition:0.28, impulse:0.22, focus:0.18, vision:0.12, reaction:0.10, aim:0.06, color:0.04 }, scores));
  const diff = fpsFit - mobaFit;
  const primaryTrack = Math.abs(diff) <= 4 ? 'balanced' : (diff > 0 ? 'fps' : 'moba');
  const profileText = primaryTrack === 'balanced'
    ? `当前两条赛道的适配度接近，FPS 匹配度 ${fpsFit}，MOBA 匹配度 ${mobaFit}。更合理的做法不是只看单项高分，而是继续结合复测稳定性和真实对局反馈收敛方向。`
    : `当前更建议优先尝试 ${primaryTrack === 'fps' ? 'FPS / 射击类' : 'MOBA / 策略对抗类'}。原因是相关维度形成了更完整的能力链路：FPS 匹配度 ${fpsFit}，MOBA 匹配度 ${mobaFit}。`;
  return { fps, moba, fpsFit, mobaFit, primaryTrack, profileText };
}

// ─── MiniMax API 调用 ─────────────────────────────────────────
async function callMiniMax(scores, rating, device, rawData) {
  const vals = Object.values(scores);
  const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const second_best = sorted[1];

  const dimNames = {
    reaction:'反应速度', impulse:'冲动抑制',
    vision:'动态视力', cognition:'认知处理速度',
    aim:'手眼协调', focus:'专注稳定性', color:'色觉感知'
  };
  const roleTracks = calcRoleTracks(scores);
  // 普通人基准
  const benchmarks = {
    reaction:50, impulse:55, vision:47, cognition:52, aim:47, focus:55, color:52
  };
  // 高于均值的维度
  const aboveAvg = Object.entries(scores).filter(([k,v]) => v > benchmarks[k]).map(([k,v]) => `${dimNames[k]}(${v}分,均值${benchmarks[k]})`);
  const belowAvg = Object.entries(scores).filter(([k,v]) => v <= benchmarks[k]).map(([k,v]) => `${dimNames[k]}(${v}分,均值${benchmarks[k]})`);

  // 构建原始数据摘要
  let rawSummary = '';
  if (rawData) {
    if (rawData.reactionTimes && rawData.reactionTimes.length > 0) {
      const avgRT = Math.round(rawData.reactionTimes.reduce((a,b)=>a+b,0)/rawData.reactionTimes.length);
      const bestRT = Math.min(...rawData.reactionTimes);
      rawSummary += `\n反应速度原始数据：平均${avgRT}ms（普通人均值260ms，职业FPS选手均值160-180ms），最快${bestRT}ms`;
    }
    if (rawData.aimRounds && rawData.aimRounds.length === 2) {
      const [r1, r2] = rawData.aimRounds;
      const r1RawKpm = r1.rawKpm !== undefined ? `，原始KPM=${r1.rawKpm}` : '';
      const r2RawKpm = r2.rawKpm !== undefined ? `，原始KPM=${r2.rawKpm}` : '';
      rawSummary += `\nAim双轮原始数据：第一轮 命中${r1.hits}个、命中率${r1.accuracy}%、有效KPM=${r1.kpm}${r1RawKpm}、平均命中时间${r1.avgHitTime}ms；第二轮 命中${r2.hits}个、命中率${r2.accuracy}%、有效KPM=${r2.kpm}${r2RawKpm}、平均命中时间${r2.avgHitTime}ms`;
      if (rawData.aimConsistency) {
        const accDelta = rawData.aimConsistency.accuracyDelta || 0;
        const kpmDelta = rawData.aimConsistency.kpmDelta || 0;
        const timeDelta = rawData.aimConsistency.avgTimeDelta || 0;
        rawSummary += `；前后差值：命中率${accDelta > 0 ? '+' : ''}${accDelta}%，有效KPM${kpmDelta > 0 ? '+' : ''}${kpmDelta}，平均命中时间${timeDelta > 0 ? '+' : ''}${timeDelta}ms`;
      }
    } else if (rawData.aimHits !== undefined) {
      const rawKpmText = rawData.aimRawKpm !== undefined ? `，原始KPM=${rawData.aimRawKpm}` : '';
      rawSummary += `\nAim测试原始数据：命中${rawData.aimHits}个，命中率${rawData.aimAccuracy}%，有效KPM=${rawData.aimKpm}${rawKpmText}（内部参考有效KPM≈44），平均命中时间${rawData.aimAvgTime}ms`;
    }
    if (rawData.visionCorrect !== undefined) {
      rawSummary += `\n动态视力：${rawData.visionCorrect}/${rawData.visionTotal}题正确`;
    }
    if (rawData.gngFalseAlarms !== undefined) {
      rawSummary += `\n冲动抑制：误触${rawData.gngFalseAlarms}次，漏触${rawData.gngMisses}次`;
    }
    if (rawData.focusBreakdown) {
      rawSummary += `\n专注稳定性拆解：RT稳定性 ${rawData.focusBreakdown.rtStability} 分，Aim前后稳定性 ${rawData.focusBreakdown.aimConsistency} 分`;
    }
    if (rawData.colorP1Hits !== undefined) {
      const p1Acc = rawData.colorP1Total ? Math.round(rawData.colorP1Hits / rawData.colorP1Total * 100) : 0;
      rawSummary += `\n色觉感知：红色识别准确率${p1Acc}%`;
      if (rawData.colorP1AvgRT) rawSummary += `，平均反应时${rawData.colorP1AvgRT}ms（优秀基准<350ms）`;
      if (rawData.colorP2Correct !== undefined) rawSummary += `，色差辨别${rawData.colorP2Correct}/${rawData.colorP2Total}正确`;
    }
  }

  const gameType = roleTracks.primaryTrack === 'balanced'
    ? '双赛道均可尝试（需继续看复测表现）'
    : roleTracks.primaryTrack === 'fps'
      ? 'FPS（如Valorant、CS2）'
      : 'MOBA（如英雄联盟、王者荣耀）';
  const gameReason = roleTracks.profileText;

  const prompt = `你是VE天赋雷达平台的资深电竞能力评估师，负责输出版本化测评报告。你的写作风格专业、克制、直接，用具体数字说话，不营销，不喊口号，也不把倾向判断写成绝对结论。

【本次测评者的具体数据】
七维得分（满分100）：
- 反应速度：${scores.reaction}分（普通人均分50）
- 冲动抑制：${scores.impulse}分（普通人均分55）
- 动态视力：${scores.vision}分（普通人均分47）
- 认知处理速度：${scores.cognition}分（普通人均分52）
- 手眼协调：${scores.aim}分（普通人均分47）
- 专注稳定性：${scores.focus}分（普通人均分55）
- 色觉感知：${scores.color !== undefined ? scores.color : '未测'}分（普通人均分52）

综合均分：${avg}分
综合评级：【${rating}】
最强维度：${dimNames[best[0]]}（${best[1]}分，超过普通人${best[1]-benchmarks[best[0]]}分）
第二强：${dimNames[second_best[0]]}（${second_best[1]}分）
最弱维度：${dimNames[worst[0]]}（${worst[1]}分）
超过均值的维度：${aboveAvg.length > 0 ? aboveAvg.join('、') : '暂无'}
低于均值的维度：${belowAvg.length > 0 ? belowAvg.join('、') : '全部超过均值'}
${rawSummary}

根据维度权重，更适合的游戏类型：${gameType}，理由：${gameReason}
双赛道角色建议：
- FPS：${roleTracks.fps.role}（匹配度 ${roleTracks.fps.fit}）—— ${roleTracks.fps.reason}
- MOBA：${roleTracks.moba.role}（匹配度 ${roleTracks.moba.fit}）—— ${roleTracks.moba.reason}

【写作要求】
请写一份约700-900字的结构化电竞能力评估意见，分6段，每段之间空一行：

第一段（综合判断）：
先用综合均分 ${avg} 分和评级「${rating}」给出整体结论，明确说明这是偏操作型、偏决策型还是相对均衡型能力结构。必须引用至少两个具体数字，不要空泛夸赞。

第二段（操作链分析）：
分析反应速度、手眼协调、动态视力三项如何共同作用于实战操作。要指出这名测评者在“看到信息→完成瞄准/操作输出”这条链路上的强项和短板，用分数与普通人均分对比，避免编造不存在的职业常模。

第三段（决策与控制链分析）：
分析认知处理速度、冲动抑制两项，说明其在信息整合、决策切换、失误控制上的意义。若数据只支持倾向判断，就直接说“现阶段只能做倾向判断”，不要装作结论非常绝对。

第四段（稳定性与后程表现）：
结合专注稳定性、两轮 Aim 前后差值、以及可用原始数据，判断其在连续对抗、疲劳后程、压力下维持输出的能力。这里要写得像评估报告，不要写成鼓励文。

第五段（项目与角色匹配）：
基于全部 7 项数据，同时给出 FPS 建议角色和 MOBA 建议角色，再判断当前更应优先尝试哪一条赛道。理由必须落回到数据，不要只给结论，也不要只写一个项目。

第六段（训练优先级）：
给出 2-3 条按优先级排序的训练建议，每条都要包含工具名、训练时长、训练频率、观察指标。结尾只做克制收束，不喊口号，不使用“被选中”“天赋爆表”这类营销表达。

额外约束：
1. 每段至少引用一个具体数字。
2. 语言要专业、克制、像俱乐部评估师写给选手本人的反馈。
3. 不要使用标题、markdown、编号、分隔线。
4. 不要重复同一个结论，不要堆砌形容词。
5. 可以指出优势，但必须同时说边界条件和风险点。

输出纯文本，无标题，无markdown符号，无分隔线。`;

  const response = await axios.post(
    'https://api.minimax.chat/v1/text/chatcompletion_pro',
    {
      model: 'abab6.5s-chat',
      tokens_to_generate: 2400,
      reply_constraints: { sender_type: 'BOT', sender_name: 'VE评估师' },
      bot_setting: [{
        bot_name: 'VE评估师',
        content: '你是VE天赋雷达平台的资深电竞能力评估师，擅长依据量化测评数据写结构化评估意见。你的风格专业、克制、直接，用数据下判断，不营销，不喊口号，不夸张。'
      }],
      messages: [{ sender_type: 'USER', sender_name: '用户', text: prompt }]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 35000
    }
  );

  const reply = response.data?.reply || response.data?.choices?.[0]?.messages?.[0]?.text;
  if (!reply) throw new Error('API返回为空');
  return reply;
}

// ─── MiniMax 基础版报告（约150字，结构化3段）──────────────────
async function callMiniMaxBasic(scores, rating, rawData) {
  const dimNames = {
    reaction:'反应速度', impulse:'冲动抑制', vision:'动态视力',
    cognition:'认知处理速度', aim:'手眼协调', focus:'专注稳定性', color:'色觉感知'
  };
  const vals = Object.values(scores);
  const avg = (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1);
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const best = sorted[0];
  const worst = sorted[sorted.length-1];
  const roleTracks = calcRoleTracks(scores);

  const gameType = roleTracks.primaryTrack === 'balanced'
    ? '双赛道均可尝试'
    : roleTracks.primaryTrack === 'fps'
      ? 'FPS（Valorant / CS2）'
      : 'MOBA（英雄联盟 / 王者荣耀）';

  const prompt = `你是VE天赋雷达的电竞能力评估专家。请根据以下数据生成一份简洁的基础版测评结论，约150字，分3段，段间空行，纯文本无标题。

数据：
- 综合均分：${avg}分，评级：${rating}
- 最强维度：${dimNames[best[0]]}（${best[1]}分）
- 最弱维度：${dimNames[worst[0]]}（${worst[1]}分）
- 各维度：${Object.entries(scores).map(([k,v])=>`${dimNames[k]}${v}`).join('、')}
- FPS建议：${roleTracks.fps.role}
- MOBA建议：${roleTracks.moba.role}

第一段（2句）：用评级和均分定调，说明综合表现。
第二段（2句）：点出最强维度的意义和最弱维度需要注意的地方。
第三段（2句）：说明当前更建议优先尝试 ${gameType}，并同时简要点出 FPS 建议角色和 MOBA 建议角色，最后给一条具体训练建议。

要求：用具体数字，不写废话，不夸张，语言直接。`;

  const response = await axios.post(
    'https://api.minimax.chat/v1/text/chatcompletion_pro',
    {
      model: 'abab6.5s-chat',
      tokens_to_generate: 400,
      reply_constraints: { sender_type: 'BOT', sender_name: 'VE评估师' },
      bot_setting: [{ bot_name: 'VE评估师', content: '你是VE天赋雷达的电竞能力评估专家，语言简洁专业，善用数字说话。' }],
      messages: [{ sender_type: 'USER', sender_name: '用户', text: prompt }]
    },
    {
      headers: { Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 25000
    }
  );
  const reply = response.data?.reply || response.data?.choices?.[0]?.messages?.[0]?.text;
  if (!reply) throw new Error('API返回为空');
  return reply;
}

function fallbackReport(scores, rating, mode = 'advanced') {
  const vals = Object.values(scores);
  const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const best = sorted[0];
  const worst = sorted[sorted.length-1];
  const roleTracks = calcRoleTracks(scores);
  const dimNames = { reaction:'反应速度', impulse:'冲动抑制', vision:'动态视力', cognition:'认知处理速度', aim:'手眼协调', focus:'专注稳定性', color:'色觉感知' };

  if (mode === 'basic') {
    return `综合评分 ${avg} 分，评级「${rating}」，整体表现${parseFloat(avg)>=70?'高于大多数测评者':'处于中等水平'}。\n\n最突出的能力是${dimNames[best[0]]}（${best[1]}分），而${dimNames[worst[0]]}（${worst[1]}分）仍是当前最需要补强的限制项。\n\n当前更建议优先尝试${roleTracks.primaryTrack === 'moba' ? ' MOBA / 策略对抗类' : roleTracks.primaryTrack === 'fps' ? ' FPS / 射击类' : '双赛道并行观察'}；若玩 FPS，更适合${roleTracks.fps.role.split(' · ')[0]}，若玩 MOBA，更适合${roleTracks.moba.role.split(' · ')[0]}。`;
  }

  const fitGame = roleTracks.primaryTrack === 'moba' ? 'MOBA/策略对抗类' : roleTracks.primaryTrack === 'fps' ? 'FPS/射击类' : '双赛道并行';
  return `综合评分 ${avg} 分，评级「${rating}」。从七维数据看，你当前的能力结构${roleTracks.primaryTrack === 'balanced' ? '相对均衡' : roleTracks.primaryTrack === 'fps' ? '偏操作输出型' : '偏决策控制型'}：${dimNames[best[0]]}达到 ${best[1]} 分，是整组数据里最突出的单项，而${dimNames[worst[0]]}只有 ${worst[1]} 分，说明真正限制上限的环节依然存在。\n\n在操作链路上，反应速度 ${scores.reaction} 分、手眼协调 ${scores.aim} 分、动态视力 ${scores.vision} 分共同决定了你处理瞬时信息并完成输出的效率；在决策与控制层面，认知处理 ${scores.cognition} 分、冲动抑制 ${scores.impulse} 分和专注稳定性 ${scores.focus} 分则更接近“后续能否稳定兑现”的上限。\n\n从双赛道匹配看，若玩 FPS，你更适合${roleTracks.fps.role}，匹配度 ${roleTracks.fps.fit}；若玩 MOBA，你更适合${roleTracks.moba.role}，匹配度 ${roleTracks.moba.fit}。当前更建议优先发展 ${fitGame}，因为这条线上的相关维度已经形成了更完整的能力链路。\n\n训练上建议先把${dimNames[worst[0]]}作为第一优先级，每天 15-20 分钟做单项训练，再用 10 分钟做与最强维度的组合练习，避免只补短板导致整体节奏断裂。连续训练 3-4 周后，重点看失误率、稳定性和第二轮表现是否改善。\n\n这组数据说明你已经有比较清晰的能力轮廓，但离“稳定兑现”还有优化空间。后续最关键的不是继续堆时长，而是围绕最弱项做更精确的训练闭环。`;
}

app.listen(PORT, () => {
  console.log(`✅ VE天赋雷达运行在 http://localhost:${PORT}`);
});
