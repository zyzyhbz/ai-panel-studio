# 核心 Prompt 记录文档

- 日期：2026-11-01
- 状态：交付版（6 段，覆盖 SDD / DDD / TDD / E2E + Agent 行为 + 需求拆解）
- 关联：[WORKFLOW](WORKFLOW.md)、[PRD](PRD.md)、[Agent API](AGENT-API.md)、[runtime prompts](prompts/runtime/README.md)

> 记录原则：保留真正发给 AI 的 Prompt 原文/关键节选，不只写事后总结。完整开发过程记录在 `docs/prompts/devlog/`；运行时 prompt 全文在 `docs/prompts/runtime/`。

---

## 1. 【需求/PRD 阶段】从题目到可执行产品定义

**原始 Prompt（节选）**

```text
将这个图片内的文字提取，这是一道实习公司给我的测试题，要求我72小时内做完，才能获得面试机会。
```

```text
你先将我的话理解一遍，然后跟我同步。
（附：用户需求笔记；要求分配产品经理、前端、后端、测试四个角色）
```

```text
技术栈需要再单独分析，你需要从产品功能适配度方面给出建议的组合并评估可行性，工程量，难度等。
```

**当时意图**

先把题目、用户诉求、角色约束整理成同一份产品定义，不直接进入“让 AI 写代码”。

**挑战与修正**

题目给的是功能清单，用户笔记给的是价值诉求，颗粒度不同；直接写 PRD 容易漏掉“可回放/多议题隔离”。先做技术选型和角色边界，再写 PRD；把“快/全/结构化/回放/透明/多议题”翻译成可验收的 FR/AR/NFR。后续又做了一次 56 项逐条审计，补上工程规则、交付物、提交方式等 12 个缺口。

**产出**：`PRD.md`、`07-PRD作业对照审计.md`、`01-技术选型.md`、`02-角色与协作SOP.md`

---

## 2. 【SDD 阶段】数据建模与 API/SSE 契约

**原始 Prompt（节选）**

```text
你是 AI Panel Studio 项目的后端工程师。
先读 PRD、ER、API 契约、SSE 契约、技术选型、角色 SOP、任务板。
G1 任务：只做设计，不写生产代码。
产出 docs/BACKEND-PLAN.md：
- 逐项评审 ER/API/SSE 是否可落地
- 模块与目录、SessionRunner 状态机
- 事件 seq、事务、WAL、并发隔离、进程重启恢复
- SSE 补发/心跳/背压
- mock LLM 与测试清单
- 对契约的修改建议
硬约束：不改共享文档、不写代码、不读 Key。
```

**当时意图**

让后端从可实现性反推契约，而不是 PM 单方面写一份“看起来合理”的 API。

**挑战与修正**

PM 初稿把“同步生成阵容”“SSE 补发”“seq 分配”写得太理想；后端指出 15 条必须改，包括 `discussion.failed` 终态事件、`turn.aborted`、`payload_json === SSE data`、幂等键、`/state` 投影接口。PM 裁决后形成 `06-G1契约决议 v1.0`，再进入实现。

**产出**：`ER.md`、`03-API契约.md`、`04-SSE事件契约.md`、`BACKEND-PLAN.md`

---

## 3. 【DDD 阶段】前端组件、页面与状态流转

**原始 Prompt（节选）**

```text
你是 AI Panel Studio 项目的前端工程师。
先读 PRD、API/SSE 契约、技术选型、角色 SOP、任务板。
G1 任务：只做设计，不写页面代码。
产出 docs/FRONTEND-PLAN.md：
- 页面/路由、三档响应式布局
- 组件树、Zustand + reducer 边界
- SSE 客户端、断线重连、流式缓冲
- 直播/回放共用 reducer
- 设计 token 与“演播厅感”
- 低保真线框
- 对 API/SSE 的修改建议
硬约束：不改共享文档、不写代码、不定义 Agent 行为。
```

**当时意图**

先把“演播厅感”拆成布局、组件、状态和动效约束，再让前端写页面，避免做成通用后台。

**挑战与修正**

“沉浸感”是主观词，必须落成三栏布局、专家色、聚光、独立滚动、状态脉冲等可验收项；直播/回放如果各写一套状态必然漂移，所以要求共用 reducer。实现后又发现 1440 下三栏重叠：子项都写着 `grid-area: stage`，媒体查询只改了模板没分配区域；补 `.studio-rail{grid-area:rail}`、`.studio-stage{grid-area:stage}`、90rem 下 `.studio-insights{grid-area:insights}`，并加布局回归。

**产出**：`FRONTEND-PLAN.md`、`apps/web/**`、`styles.layout.test.ts`

---

## 4. 【Agent 行为阶段】Prompt、上下文与发言调度

**原始 Prompt（节选）**

```text
你是 AI Panel Studio 项目的 AI/Agent 工程师。
你的边界是 Agent 行为与上下文工程，不是第二个后端。
产出 docs/AGENT-BEHAVIOR.md：
- 人设生成、主持人行为、发言调度
- 上下文窗口、token 预算、跨会话隔离
- 公开状态/隐藏 CoT 边界
- 共识/分歧判定与证据
- 五类 LLM 输出契约
- 失败降级
- 5 个议题的行为 eval
- 对 API/SSE/ER 的修改建议
硬约束：只写 packages/agent 与 docs，不碰 API/DB/SSE/UI，不读 Key。
```

**当时意图**

把 prompt 从“散落在后端/PM 的字符串”变成有 owner、有版本、有 eval 的行为层。

**挑战与修正**

“发言调度”很容易写成另一个后端；必须切开“行为编排（AI）”和“运行时编排（后端）”。最终接口定为：Agent 包提供 `LLMClient` 接口、五类 builder、context、schema、policy、mock；后端实现真实 DeepSeek transport 并注入。运行期 mock 留在后端（绑 QA 钩子），Agent mock 只服务 eval/单测，避免两套生产客户端。

**产出**：`AGENT-BEHAVIOR.md`、`docs/prompts/runtime/` 五份全文、`packages/agent/**`、`evals/`

---

## 5. 【TDD 阶段】核心逻辑测试与回归

**原始 Prompt（节选）**

```text
我跑 `.\scripts\pnpm.ps1 --filter @ai-panel/agent test` 目前 3 failed / 67 passed，
都在 mock-client.test.ts：empty_output 用例没抛预期错误、long 用例文本只有 83 字。
先修到 agent test 全绿，再继续；把失败原因和修复写进 devlog。
```

```text
新建讨论跑完 12 轮 ended，但 insights=0。
请查 insight 服务；在 mock 下至少要产出 1 条 insight.updated。
修完把“同库两个讨论都产生洞察且 id 不冲突”写成回归测试。
```

**当时意图**

不是“实现完再补测试”，而是用失败用例锁定行为：JSON 合法率、发言长度、洞察 id 全局唯一、结束宽限、断线补发。

**挑战与修正**

最初测试每个用例用全新临时 DB，第一个会话永远不撞洞察主键，所以漏掉了 `UNIQUE constraint failed: insights.id`；真实 smoke 才暴露。修复为 `i_ + sha256(discussionId:type:contentHash)` 派生 id，并新增跨讨论回归。另一个坑是 `empty` mock 仍返回合法 JSON、`long` 文本只有 83 字，测试没真正触发目标路径；修 fixture 后才有意义。

**产出**：agent 86 tests、server 19 tests、web 36 tests、`docs/prompts/devlog/01-g2-agent-package.md`

---

## 6. 【E2E 阶段】系统级端到端与质量闭环

**原始 Prompt（节选）**

```text
真实链路 smoke 已跑：首页/创建/健康检查 6 条过，
但主链路里有一条 `BUG-01：确认后直播页应渲染出首条消息（当前为空壳）`。
请切真实 API，重点检查 confirm 后 SSE/activeTurn/message.completed 是否进入 reducer 并渲染；
修完发我 live 首条消息可见 + 截图/URL。
```

```text
布局回归补一条：1440×900 下 rail/stage/insights 三个容器 boundingBox 不重叠、
铺满视口；1024 和 390 不出现 body 滚动；首条消息必须落在 stage 栏内。
```

**当时意图**

用真实浏览器证明“用户能从头走到尾”，而不是只看单测。

**挑战与修正**

`MOCK_DELAY_MS=0` 时 12 轮 16ms 就结束，SSE 连上时已是终态，前端只 `localStatus=live` 没回读投影，出现空壳；修复为 confirm 后 `await refresh()` + `stream.ready` 状态不一致时 refresh。Playwright trace 写到中文路径 `ENOENT`，改到 `%TEMP%\ai-panel-e2e`。布局回归最初只断言“存在/可见”，抓不到三栏重叠；改成矩形相交 + 铺满视口 + 首条消息落在 stage 区间，才真正抓住 bug。

**产出**：`e2e/**` 20 条用例、`docs/QA-G2-REPORT.md`、`REAL-SMOKE.md`

---

## 附：交付映射

| 题目要求 | 本文件对应 |
| --- | --- |
| 记录最核心原始 Prompt | §1–§6 均保留原文/节选 |
| 明确标注 SDD/DDD/TDD/E2E | §2/§3/§5/§6 |
| 每段 1–2 句说明 | 每节“意图/挑战与修正” |
| ≥5 段 | 6 段 |
| 运行时 prompt 全文 | `docs/prompts/runtime/` |
| 开发过程细节 | `docs/prompts/devlog/` |
