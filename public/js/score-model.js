(function initScoreModel(root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = model;
  }
  root.VEScoreModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createScoreModel() {
  const DIM_KEYS = ['reaction', 'impulse', 'vision', 'cognition', 'aim', 'focus', 'color'];
  const SCORE_WEIGHTS = {
    reaction: 20,
    impulse: 9,
    vision: 7,
    cognition: 14,
    aim: 32,
    focus: 11,
    color: 7
  };

  function toScore(value) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.min(100, Math.max(0, num)) : 0;
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

  return {
    DIM_KEYS,
    SCORE_WEIGHTS,
    calcWeightedAverage,
    calcRatingKey,
    calcRatingLabel
  };
});
