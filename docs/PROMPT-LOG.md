# 核心 Prompt 记录文档（交付物 2）

- 姓名：李荟源
- 项目：AI Panel Studio — AI 圆桌讨论 Web App MVP
- 日期：2026-11-01
- 关联：[WORKFLOW](WORKFLOW.md)、[多 Agent 与阶段映射](08-多Agent协作与阶段映射.md)、[runtime prompts](prompts/runtime/README.md)

> 记录口径：以下是我（李荟源）实际发给各角色 Agent 的核心 Prompt 原文/关键节选。每段后附 1–2 句说明：当时意图、遇到的挑战、如何引导 AI 修正。多 Agent 分工下，PM 写任务/评审/验收 Prompt，Agent 写运行时 Prompt 和部分测试；后者全文在 `docs/prompts/runtime/` 与 `docs/prompts/devlog/`，不冒充全部由我个人手写。
>
> 术语说明：作业把 DDD 阶段定义为“前端组件与页面生成”。本文严格按作业口径分段；严格领域驱动设计中的限界上下文、事件溯源等证据在 §2、§4 及 `AGENT-BEHAVIOR.md` 中，避免把“前端设计”偷换成 DDD 的全部。

---

## 1. 【需求/PRD 阶段】从题目到可执行边界

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

**说明**：先把“题目功能清单”和“我真正想做的产品价值”分开，不直接让 AI 写代码；挑战是两者颗粒度不同，直接写 PRD 容易漏掉可回放、多议题隔离，所以先做技术选型、角色边界，再逐条落到 FR/AR/NFR。

**产出**：`PRD.md`、`07-PRD作业对照审计.md`、`01-技术选型.md`、`02-角色与协作SOP.md`

---

## 2. 【SDD 阶段】数据建模与 API 契约生成

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

**说明**：让后端从“能不能实现”反推契约，而不是 PM 单方面写一份看起来合理的 API；挑战是初稿把同步生成、SSE 补发、seq 分配写得太理想，所以要求 AI 逐项评审并列出必须修改项，再由 PM 裁决冻结。

**产出**：`ER.md`、`03-API契约.md`、`04-SSE事件契约.md`、`06-G1契约决议.md`、`BACKEND-PLAN.md`

---

## 3. 【DDD 阶段】前端组件与页面生成

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

**说明**：按作业口径，DDD 阶段落在“前端组件与页面生成”，核心是把“演播厅感”拆成布局、组件、状态和动效约束，而不是做成通用后台；挑战是“沉浸感”太主观、直播/回放各写一套状态会漂移，所以先要求组件树、reducer 边界和低保真线框，再进入页面实现。

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

**说明**：把 prompt 从“散落在后端/PM 的字符串”变成有 owner、有版本、有 eval 的行为层；挑战是“发言调度”很容易写成第二个后端，所以明确切开“行为编排（AI）”与“运行时编排（后端）”，最终定为 `LLMClient` 接口 + 五类 builder + context + schema + policy + mock。

**产出**：`AGENT-BEHAVIOR.md`、`docs/prompts/runtime/` 五份全文、`packages/agent/**`、`evals/`

---

## 5. 【TDD 阶段】核心逻辑测试与业务实现

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

**说明**：不是“实现完再补测试”，而是用失败用例锁定行为：JSON 合法率、发言长度、洞察 id 全局唯一、结束宽限、断线补发；挑战是洞察 id 用会话内序号导致跨讨论撞主键，修复为 `i_ + sha256(discussionId:type:contentHash)`，并补跨讨论回归。

**产出**：agent 92 tests、server 28 tests、web 42 tests、`docs/prompts/devlog/01-g2-agent-package.md`

---

## 6. 【E2E 阶段】系统级端到端测试与质量闭环

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

**说明**：用真实浏览器证明“用户能从头走到尾”，而不是只看单测；挑战是 mock 太快导致 SSE 连上时已结束、页面显示空壳，修复为 confirm 后 `await refresh()` + `stream.ready` 状态不一致时 refresh，并把布局断言从“存在/可见”升级成矩形不相交。

**产出**：`e2e/**` 35 条用例、`docs/QA-REPORT.md`、`REAL-SMOKE.md`

---

## 7. 【迭代阶段】从“演角色”到“真争论”，从“轮数”到“观点饱和”

**原始 Prompt（用户反馈，节选）**

```text
目前，开启一次讨论后，没有返回大厅的按钮。专家状态小窗未显示 agent 运行状态。
各个专家的思考深度都不够，需要开启思考模式。
我认为 AI/AGENT 的提示词和上下文需要深度设计，目前的 AI 讨论，并没有体现出观点的碰撞，
每个专家时常是沿着自己的角色定义走，其目标不是讨论，不是观点碰撞，而是扮演好自己的角色，
这违背了讨论的初衷。同时，讨论轮数也不该硬设置为 12 轮，我认为应该设计为至多 36 轮。
目前的主持人更像是机械操控讨论流程，思考深度不够。
```

```text
讨论的结束与否应该从观点出发，而不是靠轮数看，我给的轮数只是保底而已。
```

**说明**：不是加一句“请深刻一点”，而是重写 Agent 行为协议：把“角色扮演”改成“回应具体论点”，把“轮数目标”改成“争点饱和”；挑战是第一版仍用 `plannedTurns` 软目标驱动结束，后来改为 `coverageFloor` 只做保底、`maxTurns=36` 只做安全上限，真正收束由 `saturation.ready` 决定。

**产出**：`docs/09-深度讨论与圆桌UI改版.md`、`packages/agent/src/context/debate-map.ts`、P-SPEECH/P-DECIDE v2、`RoundTable.tsx`、三套主题、`docs/prompts/devlog/02-deep-debate-rework.md`

---

## 附：多范式如何落地

| 作业要求的阶段 | 本项目对应 | 关键证据 |
| --- | --- | --- |
| SDD：数据建模与 API 契约 | 先冻结 ER/API/SSE，再实现 | `06-G1契约决议`、契约测试、SSE 补发测试 |
| DDD：前端组件与页面 | 按作业口径做呈现层组件/状态设计 | `FRONTEND-PLAN`、直播/回放共用 reducer、布局回归 |
| TDD：核心逻辑测试与实现 | 失败用例先行的务实 TDD/回归 | agent 92、server 28、web 42 |
| E2E：系统级质量闭环 | 独立测试 Agent 跑真实浏览器 | 35 条 Playwright、0 failed / 0 skipped |
| 多 Agent 分工 | PM + AI/前端/后端/测试 | 目录所有权、任务包、`08-多Agent协作与阶段映射.md` |

> 说明：本项目是 PM + 四个角色 Agent 的分工模式，不是 PM 一个人手写所有 Prompt。本文记录的是 PM 实际下发的核心 Prompt；运行时 Prompt 与部分测试由对应 Agent 编写，PM 审核、版本化、验收。这样既符合作业“核心 Prompt 记录”的要求，也不虚构作者。
