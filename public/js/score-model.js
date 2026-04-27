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
  const DIM_BENCHMARKS = {
    reaction: 50,
    impulse: 55,
    vision: 47,
    cognition: 52,
    aim: 47,
    focus: 55,
    color: 52
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

  function finiteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
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

  function getAimRoundRawKpm(round) {
    const rawKpm = finiteNumber(round && round.rawKpm);
    if (rawKpm !== null) return rawKpm;
    return finiteNumber(round && round.kpm);
  }

  function getAimRoundEffectiveKpm(round) {
    const stored = finiteNumber(round && round.effectiveKpm);
    if (stored !== null) return stored;
    return computeAimEffectiveKpm(getAimRoundRawKpm(round), round && round.accuracy, round && round.avgHitTime);
  }

  function getAimRawKpm(rawData) {
    const rawKpm = finiteNumber(rawData && rawData.aimRawKpm);
    if (rawKpm !== null) return rawKpm;
    return finiteNumber(rawData && rawData.aimKpm);
  }

  function getAimEffectiveKpm(rawData) {
    const stored = finiteNumber(rawData && rawData.aimEffectiveKpm);
    if (stored !== null) return stored;
    const effective = finiteNumber(rawData && rawData.aimKpm);
    if (effective !== null) return effective;
    return computeAimEffectiveKpm(getAimRawKpm(rawData), rawData && rawData.aimAccuracy, rawData && rawData.aimAvgTime);
  }

  function weightedFit(weights, scores) {
    return Object.entries(weights).reduce((sum, [key, weight]) => sum + toScore(scores && scores[key]) * weight, 0);
  }

  function buildRoleReason(track, key, scores, avg, spread) {
    const {
      reaction = 0,
      impulse = 0,
      vision = 0,
      cognition = 0,
      aim = 0,
      focus = 0
    } = scores || {};

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
    const values = DIM_KEYS.map(key => toScore(scores && scores[key]));
    const avg = values.reduce((sum, value) => sum + value, 0) / DIM_KEYS.length;
    const spread = Math.max(...values) - Math.min(...values);
    const pickRole = (track, list) => {
      const ranked = list.map(item => {
        let fit = weightedFit(item.weights, scores);
        if (item.key === 'flex') fit += spread <= 16 ? 6 : spread <= 24 ? 2 : -4;
        return {
          ...item,
          fit: Math.round(fit),
          reason: buildRoleReason(track, item.key, scores, avg, spread)
        };
      }).sort((a, b) => b.fit - a.fit);
      return ranked[0];
    };

    const fps = pickRole('fps', [
      { key: 'duelist', role: '突击手 · Duelist', icon: '⚡', gameName: 'Valorant / CS2', weights: { reaction: 0.36, aim: 0.34, vision: 0.16, impulse: 0.08, focus: 0.06 } },
      { key: 'sniper', role: '狙击手 · Sniper', icon: '🎯', gameName: 'Valorant / CS2', weights: { aim: 0.34, focus: 0.30, reaction: 0.18, vision: 0.18 } },
      { key: 'controller', role: '控场 / 指挥 · Controller', icon: '🧠', gameName: 'Valorant / CS2', weights: { cognition: 0.32, impulse: 0.24, focus: 0.18, vision: 0.14, aim: 0.12 } },
      { key: 'flex', role: '弹性位 · Flex', icon: '🎮', gameName: 'Valorant / CS2', weights: { reaction: 0.18, aim: 0.18, cognition: 0.20, impulse: 0.18, focus: 0.18, vision: 0.08 } }
    ]);

    const moba = pickRole('moba', [
      { key: 'jungler', role: '打野 · Jungler', icon: '🗡️', gameName: '英雄联盟 / 王者荣耀', weights: { cognition: 0.30, reaction: 0.22, vision: 0.18, focus: 0.16, impulse: 0.14 } },
      { key: 'adc', role: 'ADC · 射手', icon: '🏹', gameName: '英雄联盟 / 王者荣耀', weights: { aim: 0.34, focus: 0.24, reaction: 0.18, impulse: 0.12, vision: 0.12 } },
      { key: 'mid', role: '中单 · Mid Lane', icon: '⭐', gameName: '英雄联盟 / 王者荣耀', weights: { cognition: 0.34, vision: 0.22, reaction: 0.18, impulse: 0.16, focus: 0.10 } },
      { key: 'support', role: '辅助 · Support', icon: '🛡️', gameName: '英雄联盟 / 王者荣耀', weights: { impulse: 0.34, cognition: 0.26, focus: 0.20, vision: 0.10, reaction: 0.10 } },
      { key: 'top', role: '上单 · Top Lane', icon: '⚔️', gameName: '英雄联盟 / 王者荣耀', weights: { focus: 0.28, impulse: 0.24, reaction: 0.20, cognition: 0.18, aim: 0.10 } }
    ]);

    const fpsFit = Math.round(weightedFit({ reaction: 0.28, aim: 0.28, vision: 0.16, focus: 0.12, color: 0.08, cognition: 0.05, impulse: 0.03 }, scores));
    const mobaFit = Math.round(weightedFit({ cognition: 0.28, impulse: 0.22, focus: 0.18, vision: 0.12, reaction: 0.10, aim: 0.06, color: 0.04 }, scores));
    const diff = fpsFit - mobaFit;
    const primaryTrack = Math.abs(diff) <= 4 ? 'balanced' : (diff > 0 ? 'fps' : 'moba');
    const profileText = primaryTrack === 'balanced'
      ? `当前两条赛道的适配度接近，FPS 匹配度 ${fpsFit}，MOBA 匹配度 ${mobaFit}。更合理的做法不是只看单项高分，而是继续结合复测稳定性和真实对局反馈收敛方向。`
      : `当前更建议优先尝试 ${primaryTrack === 'fps' ? 'FPS / 射击类' : 'MOBA / 策略对抗类'}。原因是相关维度形成了更完整的能力链路：FPS 匹配度 ${fpsFit}，MOBA 匹配度 ${mobaFit}。`;

    return { fps, moba, fpsFit, mobaFit, primaryTrack, profileText };
  }

  return {
    DIM_KEYS,
    DIM_NAMES,
    DIM_BENCHMARKS,
    SCORE_WEIGHTS,
    REACTION_SOURCE_WEIGHTS,
    computeAimEffectiveKpm,
    getAimRoundRawKpm,
    getAimRoundEffectiveKpm,
    getAimRawKpm,
    getAimEffectiveKpm,
    filterRTOutliers,
    reactionMsToScore,
    calcReactionScoreDetails,
    getDeviceLatencyCorrection,
    calcWeightedAverage,
    calcRatingKey,
    calcRatingLabel,
    calcRoleTracks,
    scoreToPercentile
  };
});
