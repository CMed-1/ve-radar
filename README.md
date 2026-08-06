# VE 天赋雷达

电竞天赋测评全栈应用：浏览器内完成 9 项反应 / 认知测试，统计模型评分，LLM 生成个性化分析报告，含支付与转化闭环。已上线运营。

## 功能概览

- **7 维测评、9 项测试**（Aim 两轮）：反应速度、瞄准（Aim）、工作记忆（N-back）、冲动抑制（Go/No-Go）、专注稳定性、视力、色觉——全部原生 JS 实现，无框架依赖，见 `public/js/tests/`
- **评级与报告**：雷达图 + 综合评级（genius / pro / normal）+ AI 个性化分析与训练计划，SVG 评级勋章，支持 PDF 下载
- **双档付费报告**：Basic / Advanced（AI 分析深度、原始数据、4 周训练计划等差异化），易支付收款
- **管理后台**：订单与支付转化追踪、邀请码、历史数据重算

## 评分方法学

- 综合分为 **7 维加权**（Aim 32%、反应 20%、认知 14%、专注 11%、抑制 9%、视力 7%、色觉 7%），统一由 `public/js/score-model.js` 计算，前端预览 / 报告 / 后台 / 服务端同一口径
- 单项样本经 **IQR 离群过滤**（2×IQR 栅栏）剔除异常操作
- 百分位为**内部参考分位**：基于 mean=58、SD=16 的参考分布 + 标准正态 CDF 映射，并通过 `test_results` 表持续累计匿名完成样本、向经验分位校准迁移
- 冲动抑制 / 专注稳定性等单项公式经过多轮实测修正（误触惩罚、RT 方差 + 后程变慢惩罚、双轮 Aim 一致性）

## AI 报告生成

- MiniMax（OpenAI 兼容 `/v1/chat/completions`），Basic / Advanced 分级模型与参数配置
- **结构化事实块注入**：将实测分数、评级、设备信息组装为事实块交给模型，并施加明确的防幻觉约束（不得编造未提供的数据）
- 输出清洗 + API 失败自动降级本地模板，保证报告链路不因上游故障中断

## 技术栈

前端原生 JS · Node 20 + Express · better-sqlite3 · MiniMax API · 易支付 · Render 部署（`render.yaml`）

## 本地运行

```bash
nvm use 20        # better-sqlite3 需 Node 20.x
npm install
npm run dev       # nodemon server.js
```

环境变量（`.env`）：

| 变量 | 说明 |
|---|---|
| `MINIMAX_API_KEY` | MiniMax API 密钥（缺省时 AI 报告降级为本地模板） |
| `MINIMAX_MODEL_BASIC` / `MINIMAX_MODEL_ADVANCED` | 两档报告模型（默认 MiniMax-M2.7） |
| `EASYPAY_PID` / `EASYPAY_KEY` / `EASYPAY_API_BASE` | 易支付商户配置 |
| `PAY_BASIC_NAME` / `PAY_ADVANCED_NAME` | 商品名 |
| `ADMIN_PASSWORD` | 管理后台密码 |
| `APP_BASE_URL` / `PORT` | 部署地址与端口 |

## 项目结构

```
public/
  index.html        首页 / 邀请码入口
  test.html         测试流程骨架（9 项）
  js/tests/         8 个测试模块（aim / reaction / cognition / impulse / focus / vision / color / preflight）
  js/score-model.js 统一评分模型（加权 + IQR + 参考分位）
  preview.html      结果预览（含支付入口）
  report.html       完整报告（basic / advanced 双模式）
  pay.html          支付页
  admin.html        管理后台
server.js           Express 后端 + MiniMax 报告生成
db.js               SQLite（better-sqlite3）
routes/admin.js     后台接口
routes/pay.js       易支付回调
```
