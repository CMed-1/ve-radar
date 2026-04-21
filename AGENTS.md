# VE天赋雷达 — 项目记忆 (AGENTS.md)

## 项目结构
- `public/index.html` — 首页/邀请码入口（可选邀请码）
- `public/test.html` — 测试页 HTML 骨架（9项流程，其中 Aim 做两轮）
- `public/js/scores.js` — 共享状态、进度条、最终跳转
- `public/js/tests/` — 各单项测试逻辑拆分文件
- `public/preview.html` — 结果预览页（含支付占位）
- `public/report.html` — 完整报告页（basic/advanced双模式）
- `server.js` — Express后端 + MiniMax API
- `db.js` — SQLite（better-sqlite3）
- 本地 Node 版本固定 `20.x`（见 `.nvmrc`）；`better-sqlite3` 在当前机器的 Node 22 下本地安装/启动不稳定，不要用 Node 22 做联调结论

## Token 节省规则（从本次任务学到的）

1. **优先 grep 定位行号，再 Read offset+limit**，不要完整读大文件
2. **简单文本替换用 sed -i**，不用 Read + Edit
3. **多个独立命令合并成一个 Bash 调用**（用 && 或 ;）
4. **test.html 是最大文件（~1900行），不到必要不动**
5. **不要同时并行改多个大文件**，每次聚焦一个

## 评分系统关键参数

### 百分位模型
- `scoreToPercentile(score)`: 仍用 mean=58, SD=16 的内部临时分布做“参考分位”
- **不是正式常模百分位**；页面文案必须写“内部参考分位 / 仅作参考”
- 已开始通过 `test_results` 表累计匿名完成样本，后续应切到经验分位

### 冲动抑制（impulse）评分公式
- `s = 85 - FA*32 - miss*7` + 速度加成3（2026-04修正）
- 旧版 `100 - FA*40` 太宽松，0误触即100分

### 专注稳定性（focus）
- 主公式：`RT稳定性 * 70% + 双次Aim一致性 * 30%`
- RT稳定性仍基于 RT 方差 + 后程变慢惩罚
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

## test.html 拆分规则（用户指令 2026-04）
**触发条件**：接下来如果有需要改动 test.html 且工程量较大的任务，自动先拆分再修改。
拆分方案：
- `public/js/tests/reaction.js` — 反应速度测试逻辑
- `public/js/tests/impulse.js` — 冲动抑制(GNG)逻辑
- `public/js/tests/vision.js` — 动态视力逻辑
- `public/js/tests/cognition.js` — 认知处理(Grid+Nback)逻辑
- `public/js/tests/aim.js` — 瞄准测试逻辑
- `public/js/tests/focus.js` — 专注稳定性(RT2)逻辑
- `public/js/tests/color.js` — 色觉感知逻辑
- `public/js/scores.js` — 共享评分计算 + showFinalScreen()
- `test.html` 只保留 HTML 骨架 + `<script src>` 引用

## 分享图（Feature A，2026-04已实现）
- report.html 新增 "生成分享图" 按钮（紫色边框）
- 卡片内容：VE logo、SVG徽章、评级+百分位、雷达图、7维分数格、AI首句、QR码
- QR URL：`https://ve-radar.onrender.com/?ref=CODE`（有邀请码则带 ref 参数）
- html2canvas + qrcodejs 实现，modal 弹出展示 + 下载按钮
- `RENDER_DOMAIN = 'https://ve-radar.onrender.com'` 常量

## 访问门控（Feature B，2026-04已实现）
- preview.html：`PAYMENT_ENABLED=true` 且无邀请码时调用 `applyGate(scores)`
  - 雷达图模糊（CSS blur + 锁图标 overlay）
  - 显示 gate-teasers：7维分数、AI摘要、角色方向（均模糊）
  - 支付卡片按钮改为"解锁基础版 ¥6.9 / 解锁进阶版 ¥19.9"
- report.html：`REPORT_GATE=false` 常量，true 时未授权直接访问跳回 preview
- 两个开关均默认 false（测试模式），上线时改为 true

## 推荐追踪（Feature C，2026-04已实现）
- `?ref=CODE` → index.html 读取 → sessionStorage `ve_ref_code` + POST `/api/referral/click`
- preview.html `unlockReport()` → POST `/api/referral/convert` with mode
- DB：referral_clicks + referral_conversions 两张表
- Admin API：POST `/api/admin/referral-stats` 返回每个 code 的 clicks + conversions

## Aim 双轮与分位采样（2026-04）
- Aim 顺序：Reaction → GNG → Vision → N-back → Aim1 → Grid → Color → Aim2 → RT2
- Aim 每轮 30 秒，两轮合计 60 秒后再计算 `scores.aim`
- `rawData.aimRounds[0/1]` 保存两轮数据；`rawData.aimConsistency` 保存二测-一测差值
- 首页手游端要提示：**不要在微信内打开**，否则横竖屏切换可能异常
- 后端新增 `test_results` 表和 `/api/test-result`，用于匿名累计经验分位样本

## 待办/已知问题
- [ ] 真实支付接入（preview.html PAYMENT_ENABLED + report.html REPORT_GATE 均改 true）
- [ ] 评分基准可能仍偏高（后续收集更多用户数据后再校准）
- [ ] 色觉感知测试无学术验证，已在评分细则中标注

## 工作原则（用户指令 2026-04）
- **先搜索再实现**：复杂功能先上网找现成方案，不要自己凭空写
- 例：手游FPS触控 → 搜 max-mapper/fps-touch-controls → 直接参考标准实现
- 默认上线约定：如果任务目标是修线上问题或让生产环境生效，完成验证后默认 `commit + push` 到 `origin/main`，触发 Render 部署；只有当用户明确说“不要上线 / 只改本地”时才停在本地

## Workspace Skills 约定（2026-04）
- 以 `.agents/skills/` 下实际存在的 `SKILL.md` 为准；当前可用的是 `karpathy-guidelines`、`find-skills`、`memory-reflect`
- `skills/` 目录当前只有占位目录，没有 `SKILL.md`，不要把它当成可直接执行的 skill 来源
- 编码、修 bug、代码 review、重构时，默认先套用 `karpathy-guidelines`：先说明假设，优先最小改动，给出可验证成功标准
- 当用户问“有没有 skill 能做 X / 帮我找个 skill / 安装一个 skill”时，调用 `find-skills` 流程，不要凭印象推荐
- 当任务是定时复盘、自动总结、长期跟踪记忆时，优先考虑 `memory-reflect`，其余日常开发任务不要滥用
- 如果后续往 workspace 新增 skill，必须补 `SKILL.md` 和明确触发条件，再写入本段约定

## 移动端 Aim 测试触控（已实现 2026-04）
- 方案：Look Zone（非摇杆），参考 fps-touch-controls 标准
- arena 全屏 = Look Zone（touchmove delta 直接驱动准星，跟手无反转）
- fire-btn 双功能：drag(>8px) = 瞄准，tap(<200ms,<8px) = 射击
- Y轴：直接用 dx/dy，不需要反转（跟手模式天然正确）
- 多指隔离：lookId / fireId 各自记录 touch.identifier
- 清理：_cleanLook / _cleanFire / _cleanArena 函数，避免事件泄漏
- nipplejs 保留在 HTML（避免引用报错）但不再创建摇杆实例

## Karpathy Guidelines（编码行为准则）
来源：forrestchang/andrej-karpathy-skills，已装入 workflow

### 1. 先想再写
- 明确说出假设，不确定时直接问
- 有多种解法时，列出来让用户选，不要自己悄悄挑
- 有更简单的方案时，说出来

### 2. 简单优先
- 写最少的代码完成任务，不写没要求的功能
- 不做"以后可能用到"的抽象
- 写了200行但50行能搞定 → 重写

### 3. 精准修改
- 只动必须动的地方，不顺手"改进"无关代码
- 自己改动产生的孤立代码（未用变量/函数）要清理
- 发现不相关的问题 → 说出来，不要擅自删

### 4. 目标驱动
- 大任务前先写计划（步骤 → 验证条件）
- 每步完成后用 grep/bash 验证，不靠感觉
- "能用" 不是成功标准，要有具体的可验证条件

### 本项目应用
- 改动前：先说"我要改X、Y、Z，不动A、B"
- 改动后：用 grep 验证关键字存在/消失
- SVG重复定义问题：下次重构时提取为共享文件（但不主动去做）
