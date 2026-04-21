require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const { initDB, generateCode, verifyCode, getAllCodes, saveContact, getAllContacts } = require('./db');

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
    if (rawData.aimHits !== undefined) {
      rawSummary += `\nAim测试原始数据：命中${rawData.aimHits}个，命中率${rawData.aimAccuracy}%，KPM=${rawData.aimKpm}（普通人均值约44），平均命中时间${rawData.aimAvgTime}ms`;
    }
    if (rawData.visionCorrect !== undefined) {
      rawSummary += `\n动态视力：${rawData.visionCorrect}/${rawData.visionTotal}题正确`;
    }
    if (rawData.gngFalseAlarms !== undefined) {
      rawSummary += `\n冲动抑制：误触${rawData.gngFalseAlarms}次，漏触${rawData.gngMisses}次`;
    }
    if (rawData.colorP1Hits !== undefined) {
      const p1Acc = rawData.colorP1Total ? Math.round(rawData.colorP1Hits / rawData.colorP1Total * 100) : 0;
      rawSummary += `\n色觉感知：红色识别准确率${p1Acc}%`;
      if (rawData.colorP1AvgRT) rawSummary += `，平均反应时${rawData.colorP1AvgRT}ms（优秀基准<350ms）`;
      if (rawData.colorP2Correct !== undefined) rawSummary += `，色差辨别${rawData.colorP2Correct}/10正确（普通人均值6/10）`;
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
请写约600字的深度个性化报告，分5段，每段之间空一行：

第一段（定调·2-3句）：
根据「${rating}」评级，用一句话定调整体天赋水平，要有画面感和冲击力，必须引用至少一个具体数字。天才少年：说出为什么在数据上罕见；普通玩家：真诚指出具体潜力方向，不能敷衍。

第二段（维度深度解读·4-5句）：
深度剖析最强维度（${best[1]}分）和最弱维度（${worst[1]}分），说出背后的神经/认知机制。例如反应速度高意味着视觉刺激→决策→运动输出的神经通路效率；冲动抑制高意味着前额叶对杏仁核的调控能力强。用具体数字对比普通人基准和职业选手基准，给出一个判断：此人在这个维度上处于人群哪个区间？

第三段（游戏类型精确匹配·3-4句）：
基于7项数据的整体权重，给出最适合游戏类型（${gameType}），并且对比说明他为什么不适合另一大类（FPS/MOBA对立），要有数据依据，不能臆造。精确到游戏品类，例如：节奏型FPS vs 策略型MOBA vs Battle Royale。

第四段（角色方向 + 短板风险·3-4句）：
给出具体角色方向建议（如FPS：入场手/狙击/狙支；MOBA：打野/ADC/辅助），附理由。然后点出最弱维度（${dimNames[worst[0]]}：${worst[1]}分）在实战中会如何拖累表现，举具体场景。

第五段（训练建议 + 个性化展望·3-4句）：
针对最弱维度给出2条具体可操作训练建议，包括工具名（如AimLab、Human Benchmark、N-back App）和时长（如每天15分钟，持续3周）。结尾根据评级定向收束：
${rating.includes('天才') ? '强调天赋稀缺性，表达VE俱乐部的高度期待，给他一种"被选中"的感觉' : rating.includes('潜力') ? '强调离职业门槛已很近，鼓励转化天赋为系统训练' : '真诚鼓励，给出最关键的一个突破口，语气接地气'}

输出纯文本，无标题，无markdown符号，无分隔线。语言流畅专业，像真正懂他数据的专家在直接跟他说话。约600字。`;

  const response = await axios.post(
    'https://api.minimax.chat/v1/text/chatcompletion_pro',
    {
      model: 'abab6.5s-chat',
      tokens_to_generate: 2000,
      reply_constraints: { sender_type: 'BOT', sender_name: 'VE评估师' },
      bot_setting: [{
        bot_name: 'VE评估师',
        content: '你是VE天赋雷达平台的资深电竞天才评估专家，擅长从测评数据中发现选手的真实天赋特征，语言专业有温度，善用具体数字说话。'
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

  const response = await require('axios').post(
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

  const colorLine = scores.color !== undefined ? `色觉感知${scores.color}分、` : '';
  return `综合评分 ${avg} 分，评级「${rating}」。你的七维能力数据呈现出鲜明的特征，${dimNames[best[0]]}达到 ${best[1]} 分，是整体数据中最亮眼的部分，这一维度的优势直接影响你在高强度对抗中的临场表现。\n\n从能力结构看，反应速度 ${scores.reaction} 分、手眼协调 ${scores.aim} 分、动态视力 ${scores.vision} 分构成你的核心操作能力基础；冲动抑制 ${scores.impulse} 分和专注稳定性 ${scores.focus} 分体现了你的心理素质水平；${colorLine}则反映了你对战场视觉信息的识别速度。\n\n需要特别关注的是${dimNames[worst[0]]}（${worst[1]}分），这是当前数据组合中相对薄弱的环节，若不加以训练可能成为上限突破的瓶颈。建议优先针对这一维度制定专项训练计划，结合 Aim Lab 等工具坚持练习，通常6-8周内可见明显改善。\n\n以你当前的数据组合，最适合的游戏类型与方向已在报告页给出，期待你通过系统训练持续突破！`;
}

app.listen(PORT, () => {
  console.log(`✅ VE天赋雷达运行在 http://localhost:${PORT}`);
});
