# VE天赋雷达 — 项目记忆 (CLAUDE.md)

## 项目结构
- `public/index.html` — 首页/邀请码入口（可选邀请码）
- `public/test.html` — 测试主文件（~1900行，8项测试）
- `public/preview.html` — 结果预览页（含支付占位）
- `public/report.html` — 完整报告页（basic/advanced双模式）
- `server.js` — Express后端 + MiniMax API
- `db.js` — SQLite（better-sqlite3）

## Token 节省规则（从本次任务学到的）

1. **优先 grep 定位行号，再 Read offset+limit**，不要完整读大文件
2. **简单文本替换用 sed -i**，不用 Read + Edit
3. **多个独立命令合并成一个 Bash 调用**（用 && 或 ;）
4. **test.html 是最大文件（~1900行），不到必要不动**
5. **不要同时并行改多个大文件**，每次聚焦一个

## 评分系统关键参数

### 百分位模型
- `scoreToPercentile(score)`: 正态分布，mean=58, SD=16（2026-04修正）
- 原值 mean=55 会导致60分用户看到73%分位，过于虚高

### 冲动抑制（impulse）评分公式
- `s = 85 - FA*32 - miss*7` + 速度加成3（2026-04修正）
- 旧版 `100 - FA*40` 太宽松，0误触即100分

### 专注稳定性（focus）
- 数据不足时默认50（旧版65，会虚高）

## Basic vs Advanced 报告差异

| 内容 | Basic ¥6.9 | Advanced ¥19.9 |
|------|-----------|----------------|
| SVG评级勋章 | ✅ | ✅ |
| 雷达图+维度分数 | ✅ | ✅ |
| AI分析文字 | ~200字 | ~600字 |
| 实测原始数据 | 🔒锁定卡 | ✅ |
| 角色方向分析 | 🔒锁定卡 | ✅ |
| 专属训练计划 | 🔒锁定卡 | ✅ |
| 评分细则 | ❌隐藏 | ✅ |
| PDF下载 | ❌隐藏 | ✅ |

## SVG勋章
- genius: 金色六边形+王冠 (ID前缀: rsg-/pvg-)
- pro: 绿色八边形+星形
- normal: 紫色圆形+手柄
- below: 灰色盾形+准星靶

## 角色推荐规则（calcRoleRec）
- FPS倾向（reaction+aim > cognition+impulse）:
  - reaction≥65 AND aim≥58 → 入场手
  - focus≥62 AND reaction≥55 → 狙击手
  - cognition≥63 AND impulse≥58 → 控场
  - else → 弹性位
- MOBA倾向:
  - reaction≥62 AND cognition≥60 → 打野
  - aim≥60 AND focus≥58 → ADC
  - cognition≥65 AND vision≥55 → 中单
  - impulse≥65 AND cognition≥55 → 辅助
  - else → 上单

## MiniMax 配置
- 进阶版: tokens_to_generate=2000, 约600字5段
- 基础版: tokens_to_generate=400, 约150字3段
- 支付开关: `PAYMENT_ENABLED = false` in preview.html

## 待办/已知问题
- [ ] test.html 拆分（将来做，不急）
- [ ] 真实支付接入（PAYMENT_ENABLED 改 true）
- [ ] 评分基准可能仍偏高（后续收集更多用户数据后再校准）
- [ ] 色觉感知测试无学术验证，已在评分细则中标注
