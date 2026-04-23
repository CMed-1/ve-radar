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
- `scoreToPercentile(score)`: 仍用 mean=58, SD=16 的内部参考分布做“参考分位”
- **不是正式常模百分位**；页面文案必须写“内部参考分位”，并强调“基于内部匿名有效样本持续校准 / 仅作站内相对参考”
- 已开始通过 `test_results` 表累计匿名完成样本，后续应切到经验分位

### 冲动抑制（impulse）评分公式
- `s = 85 - FA*32 - miss*7` + 速度加成3（2026-04修正）
- 旧版 `100 - FA*40` 太宽松，0误触即100分

### 专注稳定性（focus）
- 主公式：`RT稳定性 * 70% + 双次Aim一致性 * 30%`
- RT稳定性仍基于 RT 方差 + 后程变慢惩罚
- 数据不足时默认50（旧版65，会虚高）

## Basic vs Advanced 报告差异

| 内容 | Basic ¥6.98 | Advanced ¥19.98 |
|------|-----------|----------------|
| SVG评级勋章 | ✅ | ✅ |
| 雷达图+维度分数 | ✅ | ✅ |
| AI分析文字 | ~200字 | ~600字 |
| 实测原始数据 | ❌隐藏 | ✅ |
| 角色方向分析 | ✅简版 | ✅深度版 |
| 专属训练计划 | ✅简版 | ✅4周计划 |
| 评分细则 | ❌隐藏 | ✅ |
| PDF下载 | ✅ | ✅ |

## SVG勋章
- genius: 金色六边形+王冠 (ID前缀: rsg-/pvg-)
- pro: 绿色八边形+星形
- normal: 紫色圆形+手柄
- below: 灰色盾形+准星靶

## 角色推荐规则（calcRoleTracks）
- 不再只返回一个总角色，报告页和 AI 文本都必须同时给出：
  - `FPS 建议角色`
  - `MOBA 建议角色`
- 当前实现改为**加权匹配**，不是旧版 if/else 单分支：
  - FPS：突击手 / 狙击手 / 控场-指挥 / 弹性位
  - MOBA：打野 / ADC / 中单 / 辅助 / 上单
- 页面需要额外展示：
  - `FPS 匹配度`
  - `MOBA 匹配度`
  - 当前更建议优先尝试哪条赛道
- 不要再改回“只给一个总项目 + 一个总角色”的写法，否则很容易又出现“总是中单”或 AI 只输出单角色的问题

## 产品文案约定（2026-04）
- 首页 / 预览页 / 报告页统一走“方法论 + 校准”表达，不写无法证明的样本量、排名、行业第一等话术
- 可用表达：
  - `VE-M7 版本化评分模型`
  - `7项核心行为指标`
  - `Aim 双轮复测 + RT 波动拆解`
  - `内部匿名有效样本持续校准`
- 避免写：
  - `基于XX万人`
  - `全球电竞运动员数据建模`
  - `十万里挑一`
  - 任何拿不出证据的俱乐部数量、命中率、行业排名

## MiniMax 配置
- 进阶版: tokens_to_generate=2400, 约700-900字，6段结构化评估意见
- 基础版: tokens_to_generate=400, 约150字3段

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
- preview.html：无邀请码且未支付时，一律调用 `applyGate(scores)`
  - 评级徽章 / 内部参考分位 / 雷达图统一锁定，避免结果侧漏
  - `club-section` 未解锁前不展示，避免通过推荐通道反推评级
  - 支付卡片直接显示 `支付宝 / 微信` 两种支付入口
- report.html：邀请码用户继续走 `sessionStorage.ve_invited`；付费用户改为调用 `/api/report/access`，由服务端支付凭证判定访问权限
- 基础版报告不再出现“锁定卡片”，而是只展示基础版可见内容；进阶版专属内容直接隐藏
- 易支付成功后会在服务端写入 `payments` 表，并通过 `ve_pay_token` cookie 识别已支付用户
- 管理后台新增“查看未付费预览”调试按钮：
  - 前端写入固定 mock `ve_scores / ve_rawdata / ve_device=pc`
  - 清理 `ve_invited / ve_code / ve_paid / ve_report_mode / ve_pending_payment / ve_ref_code`
  - 后端 `POST /api/admin/debug/reset-preview-access` 专门用于清掉 `ve_pay_token`
  - 只用于运营验收未付费预览态，不算正式用户入口
- 管理后台新增“手动生成结果”：
  - 支持手填 7 维分数或一键填入天才少年演示样本
  - 只写入当前浏览器 `sessionStorage`，不写入 `test_results`
  - 进阶演示报告用 `ve_invited=true` 本地绕过，不能作为正式支付/邀请码逻辑

## 推荐追踪（Feature C，2026-04已实现）
- `?ref=CODE` → index.html 读取 → sessionStorage `ve_ref_code` + POST `/api/referral/click`
- 邀请码用户：preview.html `unlockReport()` → POST `/api/referral/convert`
- 付费用户：支付成功后由服务端在订单转为 `PAID` 时记录 `referral_conversions`
- DB：referral_clicks + referral_conversions 两张表
- Admin API：POST `/api/admin/referral-stats` 返回每个 code 的 clicks + conversions

## 支付接入（2026-04）
- 当前接入：`六号易支付 V1 (MD5)`
- 环境变量：
  - `APP_BASE_URL`
  - `EASYPAY_API_BASE`
  - `EASYPAY_PID`
  - `EASYPAY_KEY`
  - `PAY_BASIC_PRICE`
  - `PAY_ADVANCED_PRICE`
  - `PAY_BASIC_NAME`
  - `PAY_ADVANCED_NAME`
- 后端接口：
  - `POST /api/pay/create`：创建订单并请求易支付 `mapi.php`
  - `GET /api/pay/status`：查询本地订单状态，并在未支付时兜底查询易支付 `api.php?act=order`
  - `ALL /api/pay/notify/easypay`：验签并接收异步通知
  - `GET /api/report/access`：读取服务端支付凭证
- 页面流程：
  - `preview.html` 选择版本与支付方式
  - `pay.html` 承接支付跳转 / 二维码展示 / 状态轮询
  - `report.html` 根据服务端访问状态读取基础版或进阶版
- 支付成功判定：
  - 异步通知 `trade_status=TRADE_SUCCESS`
  - 或前端轮询时兜底查询 `status=1`
- 收到异步通知后必须返回纯文本 `success`

## Aim 双轮与分位采样（2026-04）
- Aim 顺序：Reaction → GNG → Vision → N-back → Aim1 → Grid → Color → Aim2 → RT2
- Aim 每轮 60 秒，两轮合计 120 秒后再计算 `scores.aim`
- `rawData.aimRounds[0/1]` 保存两轮数据；`rawData.aimConsistency` 保存二测-一测差值
- Aim 原始数据里的“命中数”是两轮合计值；内部参考 `KPM≈44` 对应两轮约 `88` 命中。不要再使用旧 30 秒口径的 `普通人均值 ~22`
- 外部 Aim Lab / Gridshot 公开数据与本网页测试的目标尺寸、输入方式、时长不一致；未拿到站内经验分布前，页面只写“内部参考”，不要写“普通人均值”
- 首页手游端要提示：**不要在微信内打开**，否则横竖屏切换可能异常
- 后端新增 `test_results` 表和 `/api/test-result`，用于匿名累计经验分位样本
- `test_results.invite_code` 只记录真实使用的邀请码：前端只有 `ve_invited === true` 时才提交 `ve_code`；无邀请码用户必须留空

## 分享图二维码（2026-04）
- 分享卡二维码必须保持黑码白底、足够大（当前 132px + 白色 quiet zone），否则微信/相机扫分享图时容易识别失败
- QR URL 固定使用 `https://ve-radar.onrender.com/`，有邀请码时只追加 `?ref=CODE`
- 后台“测试数据”Tab 可查看最近匿名完成记录并导出 CSV；该数据没有姓名/手机号，只能和 contacts 分开看

## 待办/已知问题
- [ ] 用真实 Render 环境变量跑一单联调支付宝 / 微信，确认易支付返回的是 `payurl`、`qrcode` 还是 `urlscheme`
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
- 2026-04 修复：`fire-btn` 必须放在 screen 外层，否则灵敏度页父级 `display:none` 会导致按钮不可见
- 手机 Aim 进入时会尝试 `requestFullscreen()` + `screen.orientation.lock('landscape')`，失败时使用 CSS fixed + `100dvh` 兜底
- 手机 Aim HUD 使用底部悬浮，arena flex 占满剩余空间，避免横屏时小球区域被浏览器地址栏/底部 HUD 挤压

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
