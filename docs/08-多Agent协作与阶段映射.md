# 多 Agent 协作与 SDD / DDD / TDD / E2E 映射

- 日期：2026-11-01
- 状态：交付说明
- 关联：[PROMPT-LOG](PROMPT-LOG.md)、[WORKFLOW](WORKFLOW.md)、[角色 SOP](02-角色与协作SOP.md)

## 0. 先说明一个事实

本项目不是“一个人按 SDD → DDD → TDD → E2E 顺序手写所有 Prompt”。

实际模式是：

- 我（PM）负责需求、PRD、契约、任务包、变更裁决、验收和最终提交；
- AI/Agent、前端、后端、测试四个执行 Agent 各自拥有目录和实现细节；
- **PM 写的是角色任务 Prompt、契约评审 Prompt、Bug/验收 Prompt**；
- 运行时的 P-ROSTER / P-DECIDE / P-SPEECH / P-INSIGHT / P-SUMMARY 由 AI/Agent 角色编写，PM 审核、版本化、验收；
- 各角色的单测/E2E 由对应 Agent 编写，PM 提供失败用例和验收标准，不冒充“每一行测试都是我手写的”。

因此，文档把 Prompt 分成两类，避免虚构：

| 类型 | 作者 | 例子 | 记录位置 |
| --- | --- | --- | --- |
| PM → Agent 的任务/评审/验收 Prompt | 李荟源（PM） | “G1 只做设计，不写生产代码”“BUG-01 空壳”“布局回归补 boundingBox” | `PROMPT-LOG.md` §1–§7 |
| Agent 运行时/实现 Prompt | 各角色 Agent，PM 审核 | P-SPEECH v2、P-DECIDE v2、debateMap、组件测试 | `docs/prompts/runtime/`、`docs/prompts/devlog/` |

> 面试作业要求“记录核心原始 Prompt”。上面两类都保留原文/关键节选；不会把 Agent 写的 Prompt 说成 PM 写的，也不会漏掉 PM 真正下发的任务 Prompt。

## 1. 角色与所有权

| 角色 | 主要产物 | 不碰什么 |
| --- | --- | --- |
| PM | PRD、ER/API/SSE 裁决、任务包、验收、提交 | 不替 Agent 写实现细节 |
| AI/Agent | 五类 runtime prompt、context、policy、eval、mock | 不碰 API/DB/SSE/UI |
| 前端 | 页面、组件、状态、SSE 客户端、主题 | 不定义 Agent 行为 |
| 后端 | SQLite、API、SSE、SessionRunner、恢复 | 不写前端组件 |
| 测试 | Playwright、压力、回归、发版门禁 | 不改生产代码 |

固定目录所有权：`packages/agent`、`apps/web`、`apps/server`、`e2e`、`docs`。跨目录变更必须回到 PM。

## 2. SDD：Spec-Driven Development（规格驱动）

**在这里指什么**：先写清楚“系统必须满足什么”，再写代码；不是瀑布，也不是“先写一份大设计再也不能改”。

实际产物：

- PRD：定位、用户、痛点、FR/AR/NFR、非目标、验收；
- ER：Discussion / Expert / Message / Insight / Summary / Event；
- API 契约：请求/响应/错误码/幂等；
- SSE 契约：事件类型、`seq`、补发、`stream.caught_up`；
- `06-G1契约决议 v1.0`：四角色评审后冻结。

对应 Prompt（PM 写给角色）：

- 后端：“G1 只做设计，不写生产代码，逐项评审 ER/API/SSE”；
- 前端：“G1 只做页面/状态设计，不写页面代码”；
- 测试：“先做可测性评审，指出哪些验收不可测”。

SDD 的验收不是“文档写了”，而是**实现能按契约跑通**：契约测试、SSE 补发测试、E2E 主链路。

## 3. DDD：Domain-Driven Design（领域驱动）

**在这里指什么**：围绕领域语言和边界组织代码，而不是围绕“前端/后端”各写一套。

核心域对象（ubiquitous language）：

- `Discussion`：一场圆桌，状态机 `generating → ready → live → summarizing → ended/failed`；
- `Roster`：主持人 + 专家，立场轴/极性/关注领域；
- `Turn`：谁、以什么 intent、回应哪条 `messageId`、本轮争点；
- `Message`：已完成的公开发言（不是 token 流）；
- `Insight`：共识/分歧/待验证，带证据；
- `Event`：事件溯源的事实来源；
- `DebateMap`：未回应挑战、当前主张、张力、回避前提、饱和判定。

限界上下文：

| 上下文 | 职责 | 防腐层 |
| --- | --- | --- |
| Agent 行为上下文 | prompt、context、speech/decision policy | `LLMClient` 接口，不接触 Key/DB |
| 服务端运行时上下文 | 会话、事件、SSE、持久化 | repository + 事件投影 |
| Web 呈现上下文 | 直播/回放视图、圆桌、气泡 | API/SSE 契约，不直接读 DB |

DDD 的关键决策：

- 直播与回放共用同一个 reducer（同一个领域状态）；
- 事件是事实来源，`message.delta` 只用于流式，不落库；
- `debateMap` 是**确定性投影**，不调 LLM，保证可测试、可回放；
- 跨会话隔离是领域不变量（`discussionId` 作为边界）。

`PROMPT-LOG.md` §3 的前端 Prompt 是**呈现层限界上下文**的设计任务，不是“DDD 只有前端”。DDD 的领域模型证据在 `ER.md`、`06-G1契约决议`、`AGENT-BEHAVIOR.md`、`debate-map.ts`。

## 4. TDD：Test-Driven / 回归驱动

**在这里指什么**：把关键行为写成可执行断言，再让实现通过；不是“所有测试都由 PM 先手写”。

实际做法：

- 先冻结不变量：seq 连续、turn 终态、幂等、事件 payload 一致、跨会话隔离；
- 后端/前端/AI 各自写单测和契约测试；
- PM 提供**失败现象和验收标准**，例如“insights=0”“直播页空壳”“三栏重叠”；
- 修 Bug 必须先写/补回归，再修实现；
- 真实 smoke 暴露的问题，回流成 mock/fixture/测试。

证据：

- agent 92 tests：schema、prompt、policy、context、mock、debateMap；
- server 28 tests：事件契约、SSE 补发、隔离、结束宽限、轮次收束、thinking；
- web 42 tests：reducer、布局契约、主题、首页、创建、回放；
- `turn-policy.test.ts`：coverageFloor / saturation / 36 上限；
- 布局回归从“元素存在”升级为“矩形不相交 + 首条消息落在 stage 区间”。

**诚实边界**：不是严格意义上的“每行测试先写”。核心不变量和 Bug 回归是测试先行；部分组件测试与实现同步编写。文档按实际写，不包装成 100% TDD。

## 5. E2E：端到端验收

**在这里指什么**：用真实浏览器证明“用户能从首页走到结束/回放”，而不是只看单测。

职责：

- 测试 Agent 独立拥有 `e2e/**`，PM 不改测试实现，只定义验收场景；
- 覆盖：首页、创建、确认、直播首条消息、SSE 断线补发、回放、三档布局、圆桌、五态、主题、返回大厅、归档；
- `E2E_STRICT=1` 下不允许“全 skip 的绿色”；
- 失败必须给截图/trace/可复现 URL。

证据：35 条 E2E，0 failed / 0 skipped；真实 Chrome（channel）。

## 6. 阶段与多 Agent 的对应关系

| 阶段 | 主要责任 Agent | PM 做什么 | 产物 |
| --- | --- | --- | --- |
| 需求/PRD | PM + 全员评审 | 写 PRD、裁决范围 | PRD、审计 |
| SDD | 后端/前端/测试 | 下发评审任务、冻结契约 | ER/API/SSE、06 |
| DDD | AI/后端/前端 | 定义领域不变量、裁决边界 | AGENT-BEHAVIOR、debateMap、reducer |
| TDD | 各实现 Agent | 给失败用例/验收、审查测试 | 92/42/28 tests |
| E2E | 测试 Agent | 定义用户旅程、验收 | 35 E2E |
| 迭代 | PM + 对应 Agent | 用户反馈拆解、验收 | 09 改版、v2 prompt |

**不是一一对应**：同一 Agent 跨多个阶段；PM 也不是每个阶段都亲自写实现 Prompt。阶段是质量控制点，不是“谁写哪段代码”的行政划分。

## 7. 为什么这种方式仍然可交付

1. **契约先行**：接口/事件先冻结，四个 Agent 才能并行而不漂移；
2. **目录所有权**：谁改哪里是硬约束，减少合并冲突；
3. **可执行验收**：每个阶段都有测试/截图/smoke，不靠“AI 说完成了”；
4. **变更可追溯**：PRD、06、09、Prompt 版本、Git 提交分层；
5. **如实披露**：工具链、Prompt 作者、测试边界都写清楚，不冒充 Claude Code、不冒充全手写。

这套方式更接近“AI 原生团队”：PM 是产品负责人和集成者，Agent 是各职能工程师；SDD/DDD/TDD/E2E 是团队的工程检查点，不是 PM 一个人的手工作业序列。
