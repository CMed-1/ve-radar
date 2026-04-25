(function initScoreModel(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = model;
  }
  root.VEScoreModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createScoreModel() {
  const DIM_KEYS = ['reaction', 'impulse', 'vision', 'cognition', 'aim', 'focus', 'color'];
  const DIM_NAMES = {
    reaction: '反应速度', impulse: '冲动抑制', vision: '动态视力',
    cognition: '认知处理速度', aim: '手眼协调', focus: '专注稳定性', color: '色觉感知'
  };
  const SCORE_WEIGHTS = {
    reaction: 20,
    impulse: 9,
    vision: 7,
    cognition: 14,
    aim: 32,
    focus: 11,
    color: 7
  };
  const REACTION_SOURCE_WEIGHTS = {
    reaction1: 0.5,
    reaction2: 0.3,
    gngGo: 0.2
  };

  function toScore(value) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.min(100, Math.max(0, num)) : 0;
  }

  function toFiniteArray(values) {
    return Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
  }

  function average(values) {
    const nums = toFiniteArray(values);
    return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function filterRTOutliers(times) {
    const nums = toFiniteArray(times);
    if (nums.length < 2) return nums;

    const plausible = nums.filter(time => time >= 100);
    if (!plausible.length) return nums;
    if (plausible.length < 3) return plausible;

    const sorted = [...plausible].sort((a, b) => a - b);
    const lerp = p => {
      const pos = p * (sorted.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
    };

    const q1 = lerp(0.25);
    const q3 = lerp(0.75);
    const iqr = q3 - q1;
    if (iqr < 15) return plausible;

    const loFence = q1 - 2 * iqr;
    const hiFence = q3 + 2 * iqr;
    const filtered = plausible.filter(time => time >= loFence && time <= hiFence);
    const minKeep = Math.max(3, Math.ceil(plausible.length * 0.5));
    return filtered.length >= minKeep ? filtered : plausible;
  }

  function reactionMsToScore(avgMs) {
    if (!Number.isFinite(avgMs)) return 0;
    if (avgMs < 190) return 100;
    if (avgMs < 210) return Math.round(90 + (210 - avgMs) / 20 * 10);
    if (avgMs < 260) return Math.round(50 + (260 - avgMs) / 50 * 40);
    if (avgMs < 350) return Math.round(15 + (350 - avgMs) / 90 * 35);
    return Math.max(0, Math.round(15 - (avgMs - 350) / 150 * 15));
  }

  function getDeviceLatencyCorrection(rawData) {
    const deviceLatency = Number(rawData?.preflight?.deviceLatencyCorrectionMs ?? rawData?.preflight?.deviceLatencyMs);
    if (!Number.isFinite(deviceLatency)) return 0;
    return clamp(Math.round(deviceLatency), 0, 35);
  }

  function buildReactionSource(values, weight, correctionMs) {
    const filtered = filterRTOutliers(values);
    if (!filtered.length) return null;
    const observedAvg = average(filtered);
    const correctedValues = filtered.map(time => Math.max(100, time - correctionMs));
    const correctedAvg = average(correctedValues);
    return {
      count: filtered.length,
      observedAvg: observedAvg === null ? null : Math.round(observedAvg),
      correctedAvg: correctedAvg === null ? null : Math.round(correctedAvg),
      weight
    };
  }

  function calcReactionScoreDetails(rawData) {
    const correctionMs = getDeviceLatencyCorrection(rawData);
    const sources = {
      reaction1: buildReactionSource(rawData?.reactionTimes, REACTION_SOURCE_WEIGHTS.reaction1, correctionMs),
      reaction2: buildReactionSource(rawData?.rt2Times, REACTION_SOURCE_WEIGHTS.reaction2, correctionMs),
      gngGo: buildReactionSource(rawData?.gngReactionTimes, REACTION_SOURCE_WEIGHTS.gngGo, correctionMs)
    };

    const activeSources = Object.entries(sources).filter(([, source]) => source && Number.isFinite(source.correctedAvg));
    if (!activeSources.length) {
      return {
        score: 0,
        correctionMs,
        compositeAvg: null,
        sources
      };
    }

    const totalWeight = activeSources.reduce((sum, [, source]) => sum + source.weight, 0);
    const compositeAvg = activeSources.reduce((sum, [, source]) => sum + source.correctedAvg * source.weight, 0) / totalWeight;
    return {
      score: clamp(reactionMsToScore(compositeAvg), 0, 100),
      correctionMs,
      compositeAvg: Math.round(compositeAvg),
      sources
    };
  }

  function calcWeightedAverage(scores, decimals = 1) {
    const totalWeight = DIM_KEYS.reduce((sum, key) => sum + SCORE_WEIGHTS[key], 0);
    const weighted = DIM_KEYS.reduce((sum, key) => sum + toScore(scores && scores[key]) * SCORE_WEIGHTS[key], 0);
    const avg = totalWeight ? weighted / totalWeight : 0;
    return Number(avg.toFixed(decimals));
  }

  function calcRatingKey(scores) {
    const values = DIM_KEYS.map(key => toScore(scores && scores[key]));
    const avg = calcWeightedAverage(scores, 4);
    const above90 = values.filter(value => value >= 90).length;
    const above80 = values.filter(value => value >= 80).length;
    const minVal = Math.min(...values);
    if (avg >= 90 && above90 >= 4 && minVal >= 78) return 'genius';
    if (avg >= 76 && above80 >= 3) return 'pro';
    if (avg >= 45) return 'normal';
    return 'below';
  }

  function calcRatingLabel(scores) {
    const labels = {
      genius: '职业级天才少年',
      pro: '有潜力的电竞职业玩家',
      normal: '普通玩家水平',
      below: '弱于普通人水平'
    };
    return labels[calcRatingKey(scores)];
  }

  // 百分位转换（内部参考分位，mean=58 SD=16，标准正态CDF近似）
  function scoreToPercentile(score) {
    const z = (score - 58) / 16;
    const sign = z >= 0 ? 1 : -1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
    const pct = 0.5 * (1 + erf) * 100;
    return Math.min(99.9, Math.max(0.1, pct));
  }

  return {
    DIM_KEYS,
    DIM_NAMES,
    SCORE_WEIGHTS,
    REACTION_SOURCE_WEIGHTS,
    filterRTOutliers,
    reactionMsToScore,
    calcReactionScoreDetails,
    getDeviceLatencyCorrection,
    calcWeightedAverage,
    calcRatingKey,
    calcRatingLabel,
    scoreToPercentile
  };
});
