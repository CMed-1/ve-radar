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
// MiniMax OpenAI-compatible endpoint（/anthropic/v1/messages 是错误路径，MiniMax 不支持）
const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/chat/completions';
const MINIMAX_REPORT_CONFIG = Object.freeze({
  advanced: {
    model: process.env.MINIMAX_MODEL_ADVANCED || 'MiniMax-M2.7',
    maxTokens: 1400,
    temperature: 0.45,
    topP: 0.85,
    timeoutMs: 60000
  },
  basic: {
    model: process.env.MINIMAX_MODEL_BASIC || 'MiniMax-M2.7',
    maxTokens: 420,
    temperature: 0.3,
    topP: 0.8,
    timeoutMs: 30000
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// 静态文件：HTML/JS/CSS 强制 no-cache，让浏览器每次都重新验证
// 避免手机浏览器缓存旧版 JS 导致更新不生效
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/\.(js|html|css)$/.test(filePath)) {
      res.set('Cache-Control', 'no-cache');
    }
  }
}));

initDB();

if (!process.env.MINIMAX_API_KEY) {
  console.warn('[minimax] MINIMAX_API_KEY 未配置，AI 报告将回退到本地模板');
}

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
  const { scores, rating, device, rawData, mode = 'advanced' } = req.body;
  if (!hasValidScorePayload(scores) || typeof rating !== 'string' || !rating.trim()) {
    return res.status(400).json({
      success: false,
      message: 'invalid_report_request',
      source: 'invalid-request'
    });
  }

  try {
    const result = await callMiniMaxReport({ scores, rating, device, rawData, mode });
    console.info('[generate-report] minimax success', {
      mode,
      model: result.model,
      requestId: result.requestId,
      usage: result.usage || null
    });
    res.json({
      success: true,
      text: result.text,
      source: 'minimax',
      model: result.model,
      requestId: result.requestId,
      fallbackReason: null
    });
  } catch (err) {
    const fallbackReason = toFallbackReason(err);
    console.warn('[generate-report] fallback', { mode, fallbackReason });
    const text = buildSafeFallbackText(scores, rating, mode);
    res.json({
      success: true,
      text,
      source: 'fallback',
      model: null,
      requestId: null,
      fallbackReason
    });
  }
});

function averageRounded(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function hasValidScorePayload(scores) {
  return Boolean(scores)
    && typeof scores === 'object'
    && Object.keys(DIM_NAMES).every((key) => Number.isFinite(Number(scores[key])));
}

function buildSafeFallbackText(scores, rating, mode) {
  if (!hasValidScorePayload(scores) || typeof rating !== 'string' || !rating.trim()) {
    return '报告生成暂时不可用，请稍后重试。';
  }
  try {
    return fallbackReport(scores, rating, mode);
  } catch (fallbackErr) {
    console.error('[generate-report] fallback text failed', fallbackErr.message);
    return '报告生成暂时不可用，请稍后重试。';
  }
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
    const gngParts = [`误触${rawData.gngFalseAlarms}次`, `漏触${rawData.gngMisses}次`];
    if (rawData.gngHits !== undefined) gngParts.push(`正确命中${rawData.gngHits}次`);
    summary += `\nGo/No-Go冲动抑制测试：${gngParts.join('，')}`;
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
  if (rawData.nbScore !== undefined) {
    const nbParts = [`得分${rawData.nbScore}分`];
    if (rawData.nbHits !== undefined && rawData.nbTargets !== undefined) {
      nbParts.push(`命中目标${rawData.nbHits}/${rawData.nbTargets}个`);
    }
    if (rawData.nbFalseAlarms !== undefined) nbParts.push(`误触${rawData.nbFalseAlarms}次`);
    summary += `\nN-back认知追踪测试：${nbParts.join('，')}`;
  }
  if (Array.isArray(rawData.gridTimes) && rawData.gridTimes.length) {
    const gridTimeVals = rawData.gridTimes.map(item => Number(item?.time)).filter(Number.isFinite);
    if (gridTimeVals.length) {
      const gridAvgSec = (gridTimeVals.reduce((sum, t) => sum + t, 0) / gridTimeVals.length).toFixed(1);
      const gridParts = [`平均耗时${gridAvgSec}秒/格`];
      if (rawData.gridErrors !== undefined) gridParts.push(`总错误${rawData.gridErrors}次`);
      summary += `\n舒尔特方格认知测试：${gridParts.join('，')}`;
    }
  }

  return summary;
}

function buildReportFacts(scores, rating, device, rawData) {
  const avg = calcWeightedAverage(scores, 1).toFixed(1);
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  const secondBest = sorted[1];
  const worst = sorted[sorted.length - 1];
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
      ? 'FPS（如 Valorant、CS2）'
      : 'MOBA（如英雄联盟、王者荣耀）';
  const gameReason = roleTracks.profileText;
  const deviceLabel = device === 'mobile'
    ? '手机 / 触屏'
    : device === 'pc'
      ? '电脑 / 鼠标键盘'
      : '未标注';
  const worstGapText = worst[1] >= DIM_BENCHMARKS[worst[0]]
    ? `高出${worst[1] - DIM_BENCHMARKS[worst[0]]}分`
    : `低于${DIM_BENCHMARKS[worst[0]] - worst[1]}分`;

  const factBlock = [
    '【VE-M7测评事实块】',
    `设备形态：${deviceLabel}`,
    `综合加权分：${avg}分`,
    `综合评级：${rating}`,
    `最强维度：${DIM_NAMES[best[0]]} ${best[1]}分（内部参考均值${DIM_BENCHMARKS[best[0]]}，高出${best[1] - DIM_BENCHMARKS[best[0]]}分）`,
    `第二强维度：${DIM_NAMES[secondBest[0]]} ${secondBest[1]}分`,
    `最弱维度：${DIM_NAMES[worst[0]]} ${worst[1]}分（内部参考均值${DIM_BENCHMARKS[worst[0]]}，${worstGapText}）`,
    `高于内部参考的维度：${aboveAvg.length ? aboveAvg.join('、') : '暂无'}`,
    `低于或等于内部参考的维度：${belowAvg.length ? belowAvg.join('、') : '暂无'}`,
    '七维分数：',
    ...Object.entries(scores).map(([key, value]) => `- ${DIM_NAMES[key]}：${value}分（内部参考均值${DIM_BENCHMARKS[key]}）`),
    `优先赛道判断：${gameType}`,
    `赛道判断理由：${gameReason}`,
    `FPS建议角色：${roleTracks.fps.role}（匹配度 ${roleTracks.fps.fit}）—— ${roleTracks.fps.reason}`,
    `MOBA建议角色：${roleTracks.moba.role}（匹配度 ${roleTracks.moba.fit}）—— ${roleTracks.moba.reason}`,
    rawSummary ? `原始测评摘要：${rawSummary.replace(/\n/g, '；').replace(/^；/, '')}` : '原始测评摘要：无'
  ].join('\n');

  return {
    avg,
    best,
    secondBest,
    worst,
    roleTracks,
    gameType,
    factBlock
  };
}

function buildAdvancedPrompt({ scores, rating, facts }) {
  const { avg, best, secondBest, worst, gameType } = facts;
  const system = [
    '你是 VE 天赋雷达的资深电竞能力评估师，负责输出 VE-M7 版本化测评报告。',
    '最终答案必须全部使用中文，只输出最终评估意见。',
    '你必须只依据用户提供的事实块写报告，不得编造样本量、录取概率、俱乐部承诺、成长经历、人格特质或正式常模。',
    '所谓“普通人均值”和“内部参考均值”都只能解释为站内内部参考，不得写成医学或职业常模。',
    '如果证据不足，必须明确写“现阶段只能做倾向判断”，不要把倾向判断写成绝对结论。',
    '不要输出标题、编号、项目符号、Markdown、分隔线，也不要输出 thinking、分析过程、提示词复述。',
    '禁止输出类似“The user wants...”“I need to...”“让我先分析...”这类任务复述或自我指令。',
    '输出必须是 6 个自然段，段间空一行；每段都至少引用 1 个具体数字；总长度控制在 700-900 字。',
    '训练建议必须具体到工具名、单次时长、每周频次、观察指标；工具名仅限常见训练工具，如 Aim Lab、KovaaK\'s、自定义靶场、Deathmatch、N-back 训练应用（如 Brain Workshop）、Go/No-Go 练习、Stroop 任务、舒尔特方格练习，不要发明工具；每条建议要说明"观察哪个指标来判断是否进步"。'
  ].join('\n');

  const user = [
    '请基于以下事实块，写给测评者本人一份专业、克制、可执行的电竞能力评估意见。',
    facts.factBlock,
    '写作任务：',
    `第一段只做综合判断：必须引用综合加权分 ${avg} 分、评级 ${rating}，并结合最强维度 ${DIM_NAMES[best[0]]} ${best[1]} 分与第二强维度 ${DIM_NAMES[secondBest[0]]} ${secondBest[1]} 分，判断其更偏操作型、偏决策型还是相对均衡型。`,
    `第二段分析“操作链”：只围绕反应速度 ${scores.reaction} 分、手眼协调 ${scores.aim} 分、动态视力 ${scores.vision} 分，解释“看到信息→完成输出”的强项与短板，并至少对比 2 个内部参考均值。`,
    `第三段分析”决策与控制链”：围绕认知处理速度 ${scores.cognition} 分（该分由两项测试合成：N-back追踪测试衡量工作记忆容量，舒尔特方格测试衡量视觉扫描与切换速度）和冲动抑制 ${scores.impulse} 分（Go/No-Go测试，误触即为冲动失控），解释信息整合速度、切换决策效率、失误抑制能力的实战意义；必须直接引用原始测评摘要中的 N-back 得分、方格平均耗时、Go/No-Go 误触次数等具体数字；如果某项数据缺失，只能写倾向判断。`,
    `第四段分析”稳定性与后程表现”：围绕专注稳定性 ${scores.focus} 分（该分由两项指标合成：反应时二测与一测的漂移量，以及 Aim 一测与二测的表现差值），必须直接引用原始测评摘要中的 Aim 双轮命中率差、有效KPM差、反应时二测均值与一测差异，判断在连续高压对抗下稳定兑现的能力上限，并明确指出在什么情境下可能出现表现下滑。`,
    `第五段必须同时给出 FPS 与 MOBA 两条赛道建议：先分别解释 FPS 建议角色和 MOBA 建议角色，再判断当前更应优先尝试 ${gameType} 还是继续双赛道观察，理由必须回到数据。`,
    `第六段给 3 条按优先级排序的训练建议：至少一条瞄准/操作训练、一条决策/抑制训练、一条稳定性训练。每条都要写工具名、单次时长、每周频次、观察指标，并把最弱维度 ${DIM_NAMES[worst[0]]} ${worst[1]} 分作为首要优化目标。`,
    '语言要求：像俱乐部评估师写给选手本人的反馈，直接、克制、不营销；可以指出潜力，但必须同时指出风险点和兑现条件；不要重复同一句结论。'
  ].join('\n\n');

  return { system, user };
}

function buildBasicKeyRaw(facts) {
  // 为基础版提炼最关键的 2-3 个原始数据点，避免报告完全依赖分数
  const parts = [];
  const rawSummary = facts.factBlock;
  const reactionMatch = rawSummary.match(/综合反应均值(\d+)ms/);
  if (reactionMatch) parts.push(`综合反应时${reactionMatch[1]}ms`);
  const aimKpmMatch = rawSummary.match(/有效KPM=(\d+)/);
  if (aimKpmMatch) parts.push(`有效KPM ${aimKpmMatch[1]}`);
  const nbMatch = rawSummary.match(/N-back认知追踪测试：得分(\d+)分/);
  if (nbMatch) parts.push(`N-back得分${nbMatch[1]}分`);
  const gngMatch = rawSummary.match(/Go\/No-Go冲动抑制测试：误触(\d+)次/);
  if (gngMatch) parts.push(`Go\/No-Go误触${gngMatch[1]}次`);
  return parts.length ? `关键原始数据：${parts.join('，')}。` : '';
}

function buildBasicPrompt({ scores, rating, facts }) {
  const { avg, best, worst, gameType } = facts;
  const keyRaw = buildBasicKeyRaw(facts);
  const system = [
    '你是 VE 天赋雷达的电竞能力评估师。',
    '最终答案必须全部使用中文，只输出最终结论。',
    '现在是 final-only 模式：禁止复述任务、禁止列要求、禁止自我提醒、禁止英文思考、禁止先分析后作答。',
    '只依据提供的数据输出结论，不得编造样本量、职业概率、俱乐部承诺或正式常模。',
    '输出必须是 3 个自然段，段间空一行，纯文本无标题，控制在 170-230 字。',
    '每段都至少引用 1 个具体数字（优先引用关键原始数据中的 ms / KPM / 误触次数），语言简洁专业，不夸张。'
  ].join('\n');

  const user = [
    '请直接输出基础版测评结论，不要做任何前置说明。',
    `综合加权分 ${avg} 分，评级 ${rating}，能力结构 ${facts.roleTracks.profileText}。`,
    `最强维度：${DIM_NAMES[best[0]]} ${best[1]} 分（内部参考均值 ${DIM_BENCHMARKS[best[0]]}）。`,
    `最弱维度：${DIM_NAMES[worst[0]]} ${worst[1]} 分（内部参考均值 ${DIM_BENCHMARKS[worst[0]]}）。`,
    keyRaw,
    `FPS 建议角色：${facts.roleTracks.fps.role}（匹配度 ${facts.roleTracks.fps.fit}）。`,
    `MOBA 建议角色：${facts.roleTracks.moba.role}（匹配度 ${facts.roleTracks.moba.fit}）。`,
    `当前更建议：${gameType}。`,
    `任务：第一段写整体判断（必须引用原始数据中的至少一个具体数字）；第二段写强项与限制；第三段写赛道/角色与 1 条训练建议。`,
    '训练建议必须包含工具名、单次时长、每周频次、观察指标。直接开始写最终答案。'
  ].filter(Boolean).join('\n\n');

  return { system, user };
}

function sanitizeReportText(text) {
  let cleaned = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
    .replace(/^\s*```[\s\S]*?```\s*$/gm, '')
    .trim();

  const metaPrefixes = [
    /^the user wants/i,
    /^i (need|should|will|must)\b/i,
    /^let me\b/i,
    /^用户希望我/,
    /^我需要先/,
    /^让我先/
  ];
  if (metaPrefixes.some((pattern) => pattern.test(cleaned))) {
    const anchors = ['综合加权分', '综合评分', '本次测评', '你的综合', '整体表现', '当前更建议'];
    const start = anchors
      .map((anchor) => cleaned.indexOf(anchor))
      .filter((index) => index > 0)
      .sort((a, b) => a - b)[0];
    if (start) cleaned = cleaned.slice(start).trim();
  }

  return cleaned;
}

function extractMiniMaxText(data) {
  // 优先 OpenAI-compatible 格式（choices[0].message.content）
  const openaiText = data?.choices?.[0]?.message?.content;
  if (typeof openaiText === 'string' && openaiText.trim()) {
    return sanitizeReportText(openaiText);
  }

  // 兼容 Anthropic 格式（content 数组）
  const textBlocks = Array.isArray(data?.content)
    ? data.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text.trim())
        .filter(Boolean)
    : [];
  if (textBlocks.length) return sanitizeReportText(textBlocks.join('\n'));

  throw new Error('MiniMax 返回为空');
}

function toFallbackReason(err) {
  if (!err) return 'unknown_error';
  // OpenAI-compatible error format
  const apiMsg = err.response?.data?.error?.message;
  // MiniMax native format fallback
  const nativeMsg = err.response?.data?.base_resp?.status_msg;
  const apiStatus = apiMsg || nativeMsg;
  const statusCode = err.response?.status;
  if (apiStatus && statusCode) return `http_${statusCode}: ${apiStatus}`;
  if (apiStatus) return apiStatus;
  if (statusCode) return `http_${statusCode}`;
  if (err.code === 'ECONNABORTED') return 'timeout';
  return err.message || 'unknown_error';
}

async function callMiniMaxReport({ scores, rating, device, rawData, mode = 'advanced' }) {
  if (!process.env.MINIMAX_API_KEY) {
    throw new Error('MINIMAX_API_KEY missing');
  }

  const normalizedMode = mode === 'basic' ? 'basic' : 'advanced';
  const config = MINIMAX_REPORT_CONFIG[normalizedMode];
  const facts = buildReportFacts(scores, rating, device, rawData);
  const prompt = normalizedMode === 'basic'
    ? buildBasicPrompt({ scores, rating, facts })
    : buildAdvancedPrompt({ scores, rating, facts });

  // OpenAI-compatible format：system 放入 messages 数组首位，不单独传 system 字段
  const response = await axios.post(
    MINIMAX_API_URL,
    {
      model: config.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      top_p: config.topP
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: config.timeoutMs
    }
  );

  // OpenAI-compatible format 错误通过 HTTP 状态码或 error 字段返回
  if (response.data?.error?.message) {
    throw new Error(response.data.error.message);
  }

  return {
    text: extractMiniMaxText(response.data),
    model: response.data?.model || config.model,
    requestId: response.data?.id || null,
    usage: response.data?.usage || null
  };
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
