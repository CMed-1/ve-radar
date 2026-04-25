'use strict';
const express = require('express');
const {
  generateCode,
  getAllCodes,
  getAllContacts,
  getAllTestResults,
  getReferralStats,
  recalculateTestResultScores
} = require('../db');
const { calcRatingLabel, calcReactionScoreDetails } = require('../public/js/score-model');
const { clearPaymentCookie } = require('./pay');

const router = express.Router();

// ─── 通用工具 ─────────────────────────────────────────────────
function parseStoredJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function getScoreRating(scores) {
  return calcRatingLabel(scores || {});
}

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

function summarizeRawData(rawData) {
  const parts = [];
  const reactionDetails = calcReactionScoreDetails(rawData || {});
  const reactionComposite = finiteNumber(rawData?.reactionBreakdown?.compositeAvgMs ?? reactionDetails.compositeAvg);
  const reactionCorrection = finiteNumber(rawData?.reactionBreakdown?.correctionMs ?? reactionDetails.correctionMs);
  if (reactionComposite !== null) {
    parts.push(`综合RT均值${Math.round(reactionComposite)}ms${reactionCorrection !== null ? `（修正${Math.round(reactionCorrection)}ms）` : ''}`);
  } else if (Array.isArray(rawData?.reactionTimes) && rawData.reactionTimes.length) {
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
  if (rawData?.gngFalseAlarms !== undefined) parts.push(`GNG误触${rawData.gngFalseAlarms}`);
  if (rawData?.visionCorrect !== undefined) parts.push(`视力${rawData.visionCorrect}/${rawData.visionTotal || 0}`);
  return parts.join(' · ') || '暂无摘要';
}

// ─── 校准指标定义 ─────────────────────────────────────────────
const CALIBRATION_METRICS = [
  { key: 'avgScore', group: '总分/七维', label: '综合加权分', unit: '分', direction: 'higher' },
  { key: 'scoreReaction', group: '总分/七维', label: '反应速度分', unit: '分', direction: 'higher' },
  { key: 'scoreImpulse', group: '总分/七维', label: '冲动抑制分', unit: '分', direction: 'higher' },
  { key: 'scoreVision', group: '总分/七维', label: '动态视力分', unit: '分', direction: 'higher' },
  { key: 'scoreCognition', group: '总分/七维', label: '认知处理分', unit: '分', direction: 'higher' },
  { key: 'scoreAim', group: '总分/七维', label: '手眼协调分', unit: '分', direction: 'higher' },
  { key: 'scoreFocus', group: '总分/七维', label: '专注稳定分', unit: '分', direction: 'higher' },
  { key: 'scoreColor', group: '总分/七维', label: '色觉感知分', unit: '分', direction: 'higher' },
  { key: 'reactionCompositeMs', group: '反应速度', label: '综合反应均值', unit: 'ms', direction: 'lower' },
  { key: 'reactionAvgMs', group: '反应速度', label: '一测平均反应', unit: 'ms', direction: 'lower' },
  { key: 'gngGoAvgMs', group: '反应速度', label: 'Go平均反应', unit: 'ms', direction: 'lower' },
  { key: 'reactionCorrectionMs', group: '反应速度', label: '设备修正延迟', unit: 'ms', direction: 'lower' },
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

  const reactionDetails = calcReactionScoreDetails(raw);
  addMetric(metrics, 'reactionCompositeMs', reactionDetails.compositeAvg);
  addMetric(metrics, 'reactionCorrectionMs', reactionDetails.correctionMs);
  addMetric(metrics, 'gngGoAvgMs', reactionDetails.sources.gngGo?.observedAvg);

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

  return { key, label, total: rows.length, stage: getCalibrationStage(rows.length), metrics };
}

function buildCalibrationStats(rows) {
  const devices = rows.reduce((acc, row) => {
    const key = row.device || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const groups = { all: buildCalibrationGroup(rows, 'all', '全体样本') };
  Object.keys(devices).sort().forEach(device => {
    groups[device] = buildCalibrationGroup(
      rows.filter(row => (row.device || 'unknown') === device),
      device,
      device === 'pc' ? 'PC样本' : device === 'mobile' ? '手机样本' : `${device}样本`
    );
  });
  return { generatedAt: new Date().toISOString(), total: rows.length, devices, groups };
}

// ─── 管理员：生成邀请码 ───────────────────────────────────────
router.post('/admin/generate-codes', async (req, res) => {
  try {
    const { password, count = 1, note = '' } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.json({ success: false, message: '管理员密码错误' });
    }
    const num = Math.min(Math.max(parseInt(count) || 1, 1), 200);
    const codes = [];
    for (let i = 0; i < num; i++) codes.push(generateCode(note));
    res.json({ success: true, codes });
  } catch (err) {
    console.error('[generate-codes]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 管理员：查看所有邀请码 ───────────────────────────────────
router.post('/admin/codes', async (req, res) => {
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
router.post('/admin/contacts', async (req, res) => {
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
router.post('/admin/test-results', async (req, res) => {
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

router.post('/admin/test-results/recalculate', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.json({ success: false, message: '管理员密码错误' });
    }
    const result = recalculateTestResultScores();
    res.json({ success: true, total: result.total, updated: result.updated, sample: result.changes.slice(0, 20) });
  } catch (err) {
    console.error('[admin/test-results/recalculate]', err.message);
    res.status(500).json({ success: false, message: '服务器错误，请稍后重试' });
  }
});

// ─── 管理员：样本校准统计 ─────────────────────────────────────
router.post('/admin/calibration-stats', async (req, res) => {
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

// ─── 管理员：推荐统计 ─────────────────────────────────────────
router.post('/admin/referral-stats', (req, res) => {
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
router.post('/admin/debug/reset-preview-access', (req, res) => {
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

module.exports = router;
