require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const {
  initDB,
  verifyCode,
  saveContact,
  saveTestResult,
  recordReferralClick,
  recordReferralConversion
} = require('./db');
const {
  DIM_NAMES,
  DIM_BENCHMARKS,
  calcWeightedAverage,
  calcRoleTracks,
  getAimRawKpm
} = require('./public/js/score-model');
const { router: payRouter } = require('./routes/pay');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

initDB();

// ─── 路由模块 ─────────────────────────────────────────────────
app.use('/api', payRouter);
app.use('/api', adminRouter);

app.get('/api/ping', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json({ success: true, ts: Date.now() });
});

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

function averageRounded(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function formatSigned(value, suffix = '') {
  const num = Number(value) || 0;
  return `${num > 0 ? '+' : ''}${num}${suffix}`;
}

function buildRawSummary(rawData) {
  if (!rawData) return '';

  let summary = '';
  const reactionComposite = rawData.reactionBreakdown?.compositeAvgMs;
  const reactionCorrection = rawData.reactionBreakdown?.correctionMs;
  if (reactionComposite !== undefined && reactionComposite !== null) {
    summary += `\n反应速度原始数据：综合反应均值${Math.round(reactionComposite)}ms`;
    const reactionParts = [];
    const reactionAvg = averageRounded(rawData.reactionTimes);
    const reactionBest = Array.isArray(rawData.reactionTimes) && rawData.reactionTimes.length ? Math.min(...rawData.reactionTimes) : null;
    const rt2Avg = averageRounded(rawData.rt2Times);
    const gngAvg = averageRounded(rawData.gngReactionTimes);
    if (reactionAvg !== null) reactionParts.push(`一测平均${reactionAvg}ms`);
    if (reactionBest !== null) reactionParts.push(`最快${reactionBest}ms`);
    if (rt2Avg !== null) reactionParts.push(`二测平均${rt2Avg}ms`);
    if (gngAvg !== null) reactionParts.push(`Go平均${gngAvg}ms`);
    if (reactionParts.length) summary += `（${reactionParts.join('，')}）`;
    if (reactionCorrection) summary += `，已扣除设备延迟修正 ${reactionCorrection}ms`;
    summary += `（普通人均值260ms，职业FPS选手均值160-180ms）`;
  } else {
    const reactionAvg = averageRounded(rawData.reactionTimes);
    const reactionBest = Array.isArray(rawData.reactionTimes) && rawData.reactionTimes.length ? Math.min(...rawData.reactionTimes) : null;
    if (reactionAvg !== null && reactionBest !== null) {
      summary += `\n反应速度原始数据：平均${reactionAvg}ms（普通人均值260ms，职业FPS选手均值160-180ms），最快${reactionBest}ms`;
    }
  }

  if (Array.isArray(rawData.aimRounds) && rawData.aimRounds.length === 2) {
    const [r1, r2] = rawData.aimRounds;
    const r1RawKpm = r1?.rawKpm !== undefined ? `，原始KPM=${r1.rawKpm}` : '';
    const r2RawKpm = r2?.rawKpm !== undefined ? `，原始KPM=${r2.rawKpm}` : '';
    summary += `\nAim双轮原始数据：第一轮 命中${r1.hits}个、命中率${r1.accuracy}%、有效KPM=${r1.kpm}${r1RawKpm}、平均命中时间${r1.avgHitTime}ms；第二轮 命中${r2.hits}个、命中率${r2.accuracy}%、有效KPM=${r2.kpm}${r2RawKpm}、平均命中时间${r2.avgHitTime}ms`;
    if (rawData.aimConsistency) {
      summary += `；前后差值：命中率${formatSigned(rawData.aimConsistency.accuracyDelta, '%')}，有效KPM${formatSigned(rawData.aimConsistency.kpmDelta)}，平均命中时间${formatSigned(rawData.aimConsistency.avgTimeDelta, 'ms')}`;
    }
  } else if (rawData.aimHits !== undefined) {
    const rawKpm = getAimRawKpm(rawData);
    const rawKpmText = rawKpm !== null ? `，原始KPM=${rawKpm}` : '';
    summary += `\nAim测试原始数据：命中${rawData.aimHits}个，命中率${rawData.aimAccuracy}%，有效KPM=${rawData.aimKpm}${rawKpmText}（内部参考有效KPM≈44），平均命中时间${rawData.aimAvgTime}ms`;
  }

  if (rawData.visionCorrect !== undefined) {
    summary += `\n动态视力：${rawData.visionCorrect}/${rawData.visionTotal}题正确`;
  }
  if (rawData.gngFalseAlarms !== undefined) {
    summary += `\n冲动抑制：误触${rawData.gngFalseAlarms}次，漏触${rawData.gngMisses}次`;
  }
  if (rawData.focusBreakdown) {
    summary += `\n专注稳定性拆解：RT稳定性 ${rawData.focusBreakdown.rtStability} 分，Aim前后稳定性 ${rawData.focusBreakdown.aimConsistency} 分`;
  }
  if (rawData.colorP1Hits !== undefined) {
    const p1Acc = rawData.colorP1Total ? Math.round(rawData.colorP1Hits / rawData.colorP1Total * 100) : 0;
    summary += `\n色觉感知：红色识别准确率${p1Acc}%`;
    if (rawData.colorP1AvgRT) summary += `，平均反应时${rawData.colorP1AvgRT}ms（优秀基准<350ms）`;
    if (rawData.colorP2Correct !== undefined) summary += `，色差辨别${rawData.colorP2Correct}/${rawData.colorP2Total}正确`;
  }

  return summary;
}

// ─── MiniMax API 调用（进阶版）───────────────────────────────
async function callMiniMax(scores, rating, device, rawData) {
  const avg = calcWeightedAverage(scores, 1).toFixed(1);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const second_best = sorted[1];

  const roleTracks = calcRoleTracks(scores);
  const aboveAvg = Object.entries(scores)
    .filter(([key, value]) => value > DIM_BENCHMARKS[key])
    .map(([key, value]) => `${DIM_NAMES[key]}(${value}分,均值${DIM_BENCHMARKS[key]})`);
  const belowAvg = Object.entries(scores)
    .filter(([key, value]) => value <= DIM_BENCHMARKS[key])
    .map(([key, value]) => `${DIM_NAMES[key]}(${value}分,均值${DIM_BENCHMARKS[key]})`);
  const rawSummary = buildRawSummary(rawData);

  const gameType = roleTracks.primaryTrack === 'balanced'
    ? '双赛道均可尝试（需继续看复测表现）'
    : roleTracks.primaryTrack === 'fps'
      ? 'FPS（如Valorant、CS2）'
      : 'MOBA（如英雄联盟、王者荣耀）';
  const gameReason = roleTracks.profileText;

  const prompt = `你是VE天赋雷达平台的资深电竞能力评估师，负责输出版本化测评报告。你的写作风格专业、克制、直接，用具体数字说话，不营销，不喊口号，也不把倾向判断写成绝对结论。

【本次测评者的具体数据】
七维得分（满分100）：
- 反应速度：${scores.reaction}分（普通人均分${DIM_BENCHMARKS.reaction}）
- 冲动抑制：${scores.impulse}分（普通人均分${DIM_BENCHMARKS.impulse}）
- 动态视力：${scores.vision}分（普通人均分${DIM_BENCHMARKS.vision}）
- 认知处理速度：${scores.cognition}分（普通人均分${DIM_BENCHMARKS.cognition}）
- 手眼协调：${scores.aim}分（普通人均分${DIM_BENCHMARKS.aim}）
- 专注稳定性：${scores.focus}分（普通人均分${DIM_BENCHMARKS.focus}）
- 色觉感知：${scores.color !== undefined ? scores.color : '未测'}分（普通人均分${DIM_BENCHMARKS.color}）

综合加权分：${avg}分
综合评级：【${rating}】
最强维度：${DIM_NAMES[best[0]]}（${best[1]}分，超过普通人${best[1] - DIM_BENCHMARKS[best[0]]}分）
第二强：${DIM_NAMES[second_best[0]]}（${second_best[1]}分）
最弱维度：${DIM_NAMES[worst[0]]}（${worst[1]}分）
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
先用综合加权分 ${avg} 分和评级「${rating}」给出整体结论，明确说明这是偏操作型、偏决策型还是相对均衡型能力结构。必须引用至少两个具体数字，不要空泛夸赞。

第二段（操作链分析）：
分析反应速度、手眼协调、动态视力三项如何共同作用于实战操作。要指出这名测评者在"看到信息→完成瞄准/操作输出"这条链路上的强项和短板，用分数与普通人均分对比，避免编造不存在的职业常模。

第三段（决策与控制链分析）：
分析认知处理速度、冲动抑制两项，说明其在信息整合、决策切换、失误控制上的意义。若数据只支持倾向判断，就直接说"现阶段只能做倾向判断"，不要装作结论非常绝对。

第四段（稳定性与后程表现）：
结合专注稳定性、两轮 Aim 前后差值、以及可用原始数据，判断其在连续对抗、疲劳后程、压力下维持输出的能力。这里要写得像评估报告，不要写成鼓励文。

第五段（项目与角色匹配）：
基于全部 7 项数据，同时给出 FPS 建议角色和 MOBA 建议角色，再判断当前更应优先尝试哪一条赛道。理由必须落回到数据，不要只给结论，也不要只写一个项目。

第六段（训练优先级）：
给出 2-3 条按优先级排序的训练建议，每条都要包含工具名、训练时长、训练频率、观察指标。结尾只做克制收束，不喊口号，不使用"被选中""天赋爆表"这类营销表达。

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
  const avg = calcWeightedAverage(scores, 1).toFixed(1);
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
- 综合加权分：${avg}分，评级：${rating}
- 最强维度：${DIM_NAMES[best[0]]}（${best[1]}分）
- 最弱维度：${DIM_NAMES[worst[0]]}（${worst[1]}分）
- 各维度：${Object.entries(scores).map(([k,v])=>`${DIM_NAMES[k]}${v}`).join('、')}
- FPS建议：${roleTracks.fps.role}
- MOBA建议：${roleTracks.moba.role}

第一段（2句）：用评级和综合加权分定调，说明综合表现。
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
  const avg = calcWeightedAverage(scores, 1).toFixed(1);
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const best = sorted[0];
  const worst = sorted[sorted.length-1];
  const roleTracks = calcRoleTracks(scores);

  if (mode === 'basic') {
    return `综合评分 ${avg} 分，评级「${rating}」，整体表现${parseFloat(avg)>=70?'高于大多数测评者':'处于中等水平'}。\n\n最突出的能力是${DIM_NAMES[best[0]]}（${best[1]}分），而${DIM_NAMES[worst[0]]}（${worst[1]}分）仍是当前最需要补强的限制项。\n\n当前更建议优先尝试${roleTracks.primaryTrack === 'moba' ? ' MOBA / 策略对抗类' : roleTracks.primaryTrack === 'fps' ? ' FPS / 射击类' : '双赛道并行观察'}；若玩 FPS，更适合${roleTracks.fps.role.split(' · ')[0]}，若玩 MOBA，更适合${roleTracks.moba.role.split(' · ')[0]}。`;
  }

  const fitGame = roleTracks.primaryTrack === 'moba' ? 'MOBA/策略对抗类' : roleTracks.primaryTrack === 'fps' ? 'FPS/射击类' : '双赛道并行';
  return `综合评分 ${avg} 分，评级「${rating}」。从七维数据看，你当前的能力结构${roleTracks.primaryTrack === 'balanced' ? '相对均衡' : roleTracks.primaryTrack === 'fps' ? '偏操作输出型' : '偏决策控制型'}：${DIM_NAMES[best[0]]}达到 ${best[1]} 分，是整组数据里最突出的单项，而${DIM_NAMES[worst[0]]}只有 ${worst[1]} 分，说明真正限制上限的环节依然存在。\n\n在操作链路上，反应速度 ${scores.reaction} 分、手眼协调 ${scores.aim} 分、动态视力 ${scores.vision} 分共同决定了你处理瞬时信息并完成输出的效率；在决策与控制层面，认知处理 ${scores.cognition} 分、冲动抑制 ${scores.impulse} 分和专注稳定性 ${scores.focus} 分则更接近"后续能否稳定兑现"的上限。\n\n从双赛道匹配看，若玩 FPS，你更适合${roleTracks.fps.role}，匹配度 ${roleTracks.fps.fit}；若玩 MOBA，你更适合${roleTracks.moba.role}，匹配度 ${roleTracks.moba.fit}。当前更建议优先发展 ${fitGame}，因为这条线上的相关维度已经形成了更完整的能力链路。\n\n训练上建议先把${DIM_NAMES[worst[0]]}作为第一优先级，每天 15-20 分钟做单项训练，再用 10 分钟做与最强维度的组合练习，避免只补短板导致整体节奏断裂。连续训练 3-4 周后，重点看失误率、稳定性和第二轮表现是否改善。\n\n这组数据说明你已经有比较清晰的能力轮廓，但离"稳定兑现"还有优化空间。后续最关键的不是继续堆时长，而是围绕最弱项做更精确的训练闭环。`;
}

app.listen(PORT, () => {
  console.log(`✅ VE天赋雷达运行在 http://localhost:${PORT}`);
});
