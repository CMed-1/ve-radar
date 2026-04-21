require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
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
  saveTestResult
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

initDB();

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
    const { scores, rawData, device } = req.body;
    if (!scores || typeof scores !== 'object') {
      return res.json({ success: false });
    }
    saveTestResult({ scores, rawData, device });
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
      rawSummary += `\nAim双轮原始数据：第一轮 命中${r1.hits}个、命中率${r1.accuracy}%、KPM=${r1.kpm}、平均命中时间${r1.avgHitTime}ms；第二轮 命中${r2.hits}个、命中率${r2.accuracy}%、KPM=${r2.kpm}、平均命中时间${r2.avgHitTime}ms`;
      if (rawData.aimConsistency) {
        const accDelta = rawData.aimConsistency.accuracyDelta || 0;
        const kpmDelta = rawData.aimConsistency.kpmDelta || 0;
        const timeDelta = rawData.aimConsistency.avgTimeDelta || 0;
        rawSummary += `；前后差值：命中率${accDelta > 0 ? '+' : ''}${accDelta}%，KPM${kpmDelta > 0 ? '+' : ''}${kpmDelta}，平均命中时间${timeDelta > 0 ? '+' : ''}${timeDelta}ms`;
      }
    } else if (rawData.aimHits !== undefined) {
      rawSummary += `\nAim测试原始数据：命中${rawData.aimHits}个，命中率${rawData.aimAccuracy}%，KPM=${rawData.aimKpm}（普通人均值约44），平均命中时间${rawData.aimAvgTime}ms`;
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

  // 判断倾向性（FPS vs MOBA）
  const colorBonus = scores.color !== undefined ? scores.color * 0.5 : 0;
  const fpsTendency = (scores.reaction + scores.aim) / 2 + colorBonus * 0.3;
  const mobaTendency = (scores.cognition + scores.impulse) / 2;
  const gameType = fpsTendency >= mobaTendency ? 'FPS（如Valorant、CS2）' : 'MOBA（如英雄联盟、王者荣耀）';
  const gameReason = fpsTendency >= mobaTendency
    ? `你的反应速度(${scores.reaction}分)、手眼协调(${scores.aim}分)${scores.color !== undefined ? `和色觉感知(${scores.color}分)` : ''}明显强于其他维度`
    : `你的认知处理速度(${scores.cognition}分)和冲动抑制(${scores.impulse}分)体现出更强的策略型思维`;

  const prompt = `你是VE天赋雷达平台的资深电竞天赋评估专家，有10年职业选手评测经验。你的评估风格：权威专业，但有温度；用具体数字说话，不说废话；能从数据里看出别人看不到的天赋特征。

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
基于全部 7 项数据，给出最适合的游戏类型和角色方向，并说明为什么更适合这一类，而不是另一类。理由必须落回到数据，不要只给结论。

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

  const fpsTendency = ((scores.reaction||0) + (scores.aim||0)) / 2;
  const mobaTendency = ((scores.cognition||0) + (scores.impulse||0)) / 2;
  const gameType = fpsTendency >= mobaTendency ? 'FPS（Valorant / CS2）' : 'MOBA（英雄联盟 / 王者荣耀）';

  const prompt = `你是VE天赋雷达的电竞能力评估专家。请根据以下数据生成一份简洁的基础版测评结论，约150字，分3段，段间空行，纯文本无标题。

数据：
- 综合均分：${avg}分，评级：${rating}
- 最强维度：${dimNames[best[0]]}（${best[1]}分）
- 最弱维度：${dimNames[worst[0]]}（${worst[1]}分）
- 各维度：${Object.entries(scores).map(([k,v])=>`${dimNames[k]}${v}`).join('、')}

第一段（2句）：用评级和均分定调，说明综合表现。
第二段（2句）：点出最强维度的意义和最弱维度需要注意的地方。
第三段（2句）：推荐${gameType}类游戏，给一条具体训练建议。

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
  const dimNames = { reaction:'反应速度', impulse:'冲动抑制', vision:'动态视力', cognition:'认知处理速度', aim:'手眼协调', focus:'专注稳定性', color:'色觉感知' };

  if (mode === 'basic') {
    return `综合评分 ${avg} 分，评级「${rating}」，整体表现${parseFloat(avg)>=70?'高于大多数测评者':'处于中等水平'}。\n\n最突出的能力是${dimNames[best[0]]}（${best[1]}分），在电竞对抗中具备明显优势；${dimNames[worst[0]]}（${worst[1]}分）是当前最需要提升的方向，建议重点训练。\n\n根据你的数据组合，推荐优先尝试 FPS 或 MOBA 类游戏，并针对${dimNames[worst[0]]}进行每日30分钟专项练习，持续4-6周可见明显进步。`;
  }

  const fpsScore = Math.round(((scores.reaction || 0) + (scores.aim || 0) + (scores.vision || 0)) / 3);
  const mobaScore = Math.round(((scores.cognition || 0) + (scores.impulse || 0) + (scores.focus || 0)) / 3);
  const fitGame = fpsScore >= mobaScore ? 'FPS/射击类' : 'MOBA/策略对抗类';
  return `综合评分 ${avg} 分，评级「${rating}」。从七维数据看，你当前更像是${fpsScore >= mobaScore ? '偏操作输出型' : '偏决策控制型'}选手：${dimNames[best[0]]}达到 ${best[1]} 分，是整组数据里最突出的单项，而${dimNames[worst[0]]}只有 ${worst[1]} 分，说明能力结构并不平均。\n\n在操作链路上，反应速度 ${scores.reaction} 分、手眼协调 ${scores.aim} 分、动态视力 ${scores.vision} 分决定了你处理瞬时信息和完成操作输出的效率。如果这三项里有两项明显高于均值，你在高节奏对抗里会更容易建立先手；反之，任何一项偏低都会拖慢整条链路。\n\n在决策与控制层面，认知处理速度 ${scores.cognition} 分、冲动抑制 ${scores.impulse} 分、专注稳定性 ${scores.focus} 分更接近“实战上限”的决定因素。这里如果分数波动较大，通常意味着你能打出高光，但稳定复现能力还不够强。\n\n以当前数据组合，较适合优先发展 ${fitGame}。原因不是单项高分，而是相关维度的组合更匹配这类项目的核心要求；如果直接转去另一类项目，最弱维度 ${dimNames[worst[0]]} 往往会先成为限制项。\n\n训练上建议先把${dimNames[worst[0]]}作为第一优先级，每天 15-20 分钟做单项训练，再用 10 分钟做与最强维度的组合练习，避免只补短板导致整体节奏断裂。连续训练 3-4 周后，重点看失误率、稳定性和第二轮表现是否改善。\n\n这组数据说明你已经有比较清晰的能力轮廓，但离“稳定兑现”还有优化空间。后续最关键的不是继续堆时长，而是围绕最弱项做更精确的训练闭环。`;
}

app.listen(PORT, () => {
  console.log(`✅ VE天赋雷达运行在 http://localhost:${PORT}`);
});
