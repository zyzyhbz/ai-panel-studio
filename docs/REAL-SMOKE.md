# 真实 DeepSeek Smoke 记录

- 日期：2026-11-01 12:27（Asia/Shanghai）
- 模式：`LLM_MODE=real`
- Base URL：`https://api.deepseek.com`
- 模型：`deepseek-flash`
- thinking：`disabled`
- 数据库：`data/real-smoke.db`（独立于演示库）
- Key：配置阶段从本机 Key 文件读取一次，写入 gitignored `.env.local`；未打印、未提交、未进入日志

## 目的

验证 mock 之外的真实链路：

1. Key 只在服务端生效，启动自检 `llmMode:"real"`。
2. `deepseek-flash` 接受当前请求参数（含 `thinking:{type:"disabled"}`）。
3. 阵容生成、决策、发言流式、共识/分歧、总结都能跑通。
4. 真实延迟和成本在可接受范围。

## 结果

```text
POST /api/discussions        → 201 ready，5 人（1 主持 + 4 专家）
POST /api/discussions/:id/confirm → 202 live
t=6s   live  turns=3  msgs=3  insights=0
t=9s   live  turns=5  msgs=5  insights=2
t=12s  live  turns=6  msgs=6  insights=2
t=15s  live  turns=8  msgs=8  insights=4
t=18s  live  turns=9  msgs=9  insights=5
t=21s  live  turns=10 msgs=10 insights=5
t=24s  summarizing turns=12 msgs=12 insights=5
t=27s  ended  turns=12 msgs=12 insights=6 summary=true
```

- 首条发言是主持人 `opening`，不是 rebut。
- 讨论 12 轮自然收束，进入 `summarizing` → `summary.completed` → `ended`。
- 6 条 `insight.updated` 对应 6 条洞察，覆盖共识、分歧、待验证。
- 总结是主持人自然语言，未出现 JSON。
- 总耗时约 **27 秒**（含 12 轮 LLM 调用），符合“几分钟内完成一场圆桌”的产品目标。

## 真实输出抽样

首条（主持人开场）：

> 今天只争一件事：圆桌到底带来决策增益，还是把噪声包装成共识。

最后一条（收尾前）：

> 争出了一条：增益看独立性和可追溯性，不看热闹。还差一步——议程权怎么被外部约束，谁都没给出可操作的答案。

总结（节选）：

> 这场讨论形成了一条明确共识：圆桌的价值取决于发言的独立性与可追溯性，而不取决于发言数量或现场热闹程度。……主要分歧集中在三处……没解决的是两件事……

洞察（抽样）：

- `consensus`：圆桌的增益取决于发言的独立性与可追溯性，而非发言数量或热闹程度。
- `divergence`：陈维桢认为圆桌能挖出分歧边界带来增益，许慕之认为圆桌只放大原有权力结构、淹没弱势声音。
- `open_question`：圆桌带来的是决策增益，还是把噪声包装成共识。

## 结论与边界

- **真实链路可用**：不是 mock 假绿；Key、模型、流式、JSON、洞察、总结都通过了。
- **thinking 字段被接受**：`deepseek-flash` + `thinking:{type:"disabled"}` 没有触发 400；未使用 `DEEPSEEK_THINKING=enabled` 退路。
- **成本**：按单场 token 估算在 ¥1 以内；实际以 DeepSeek 账单为准。本次只跑 1 场 smoke，未做 5 议题真实 eval。
- **未证明**：真实模型在 5 个议题上的稳定性、幻觉率、延迟分布；需要 AI-04 的多轮 eval，当前只有 mock 基线 + 1 次真实 smoke。
- **Key 安全**：`.env.local` 在 `.gitignore` 内；`git status` 不显示；前端 bundle 扫描无 Key；日志只输出 `llmMode/model/thinking`，不含 Key。

## 复现命令（不打印 Key）

```powershell
cd D:\AI开发\ai-panel-studio
# .env.local 已配置（gitignored）
$env:LLM_MODE="real"
$env:DATABASE_PATH="D:\AI开发\ai-panel-studio\data\real-smoke.db"
.\scripts\pnpm.ps1 --filter @ai-panel/server dev
# 另一个终端：创建讨论并 confirm，观察 /api/health 的 llmMode=real
```

> 交付演示默认仍用 `LLM_MODE=mock`，避免评审时产生费用和等待；真实 smoke 只作为“确实接通过”的证据。
