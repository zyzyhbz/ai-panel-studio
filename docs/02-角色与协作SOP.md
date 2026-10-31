# 角色与协作 SOP v1.0

- 日期：2026-10-31
- 状态：已确认，执行中
- 适用范围：AI Panel Studio MVP
- 关联文档：[技术选型分析](01-技术选型.md)、[远程作业原文](00-远程作业原文.md)、[PRD](PRD.md)

## 0. 结论

**已确认设立独立的 AI/Agent 工程师角色，并在 G1 契约阶段加入。**

前提不变：它必须是“Agent 行为与上下文工程”的负责人，**不能变成第二个后端**。

一句话边界：

> 产品经理定义“产品要什么”，AI/Agent 工程师定义“Agent 怎么想、看什么、说什么”，后端定义“系统怎么跑”，前端定义“用户怎么感知”，测试定义“是否真的成立”。

---

## 1. 为什么值得单独设这个角色

### 1.1 这个产品的核心不是 CRUD，而是 Agent 行为

AI 圆桌的差异点在于：

- 专家人设是否有真正的立场差异
- 谁在什么时候发言，是否真的由 transcript 驱动
- 每次发言是否控制在 1–2 句，是否有碰撞而不是轮流念稿
- 上下文是否给对：给多了贵且慢，给少了幻觉
- 共识/分歧是否真的有发言依据，而不是模型编造
- 主持人的追问、串联、收尾是否有节奏
- 公开状态与隐藏 CoT 的边界是否守住

这些都不是普通后端接口问题，而是 **prompt + context + policy + eval** 的组合。把它们分散到产品经理、后端、前端，最后一定会出现三套不一致的“Agent 理解”。

### 1.2 产品经理继续兼做，会成为瓶颈

产品经理还要做：

- PRD、范围、优先级、验收标准
- API/事件契约、变更控制
- 任务分派、集成、交付文档
- 与四个角色同步上下文

如果再让 PM 写所有 prompt、调上下文、做 eval，PM 会从“枢纽”变成“瓶颈”，而且没有独立的第二双眼睛 review 自己的 prompt。

### 1.3 后端兼做，会拖慢主链路

后端已经要负责：

- SQLite、迁移、种子数据
- API、SSE、断线重连
- 多会话隔离、队列、AbortController
- 错误处理、超时、日志、安全

Prompt/context 是高度迭代的工作，需要反复跑 eval、改上下文、比较输出。放在后端，会和接口/并发工作争抢时间，而且容易把“能跑”当成“行为对”。

### 1.4 这个角色正好对应题目的核心考察点

题目明确考察：

- Prompt 的结构化表达
- 如何引导 AI 解决具体工程问题
- 上下文管理，避免大模型幻觉
- 嘉宾生成、发言调度、共识提炼的测试驱动

这些需要一个明确的 owner，而不是“大家顺手写一点”。

---

## 2. 组织图

```text
                    PM（产品经理 / 集成负责人）
                     │
      ┌──────────────┼──────────────┬──────────────┐
      │              │              │              │
 AI/Agent 工程师   前端工程师      后端工程师      测试工程师
      │              │              │              │
 packages/agent   apps/web       apps/server     e2e/
 evals/           UI/交互         API/DB/SSE      质量门禁
```

四个执行角色各自一个智能体，PM 是唯一的需求入口、契约出口和集成出口。

---

## 3. 角色卡

### 3.1 产品经理（PM）

**使命**：保证做对的产品，并让四个角色在同一份事实上工作。

**负责**：

- 产品北极星、PRD、范围、非目标、优先级
- 用户流程、功能定义、验收标准（AC）
- API/SSE/事件契约的最终确认与版本管理
- 任务拆分、依赖管理、变更控制
- 集成、最终验收、交付文档
- Prompt 记录的最终汇编与提交

**不负责**：

- 不写业务代码
- 不写具体 prompt
- 不调模型参数
- 不替测试做发版签字

**关键产出**：

- `docs/PRD.md`
- `docs/API.md`、`docs/EVENTS.md`
- `docs/TASKS.md`
- `docs/PROMPT-LOG.md`（汇编）
- `docs/WORKFLOW.md`
- `README.md`

---

### 3.2 AI/Agent 工程师

**使命**：让 AI 圆桌“像真的在讨论”，并在延迟、成本、稳定性约束下可重复。

**负责**：

- 嘉宾/主持人 persona 设计与生成策略
- 主持人 prompt：开场、追问、串联、收尾
- 发言决策策略：谁来说、为什么说、说什么类型（举手/抢答/补充/反驳）
- 上下文工程：transcript 窗口、结构化摘要、共识状态、persona 记忆、token 预算、去重、排序
- LLM 输出契约：JSON schema、解析、修复、兜底
- 模型参数：模型选择、thinking 开关、温度、最大输出
- Prompt 版本管理与回归
- 离线行为 eval：多样性、重复率、发言长度、共识依据、延迟、成本
- 与 PM 一起维护 Prompt 记录

**不负责**：

- 不写 HTTP 路由、SSE、数据库、队列
- 不写前端组件
- 不单方面改产品范围或验收标准
- 不直接改 `apps/server/**`、`apps/web/**`
- 不做最终发版签字

**关键产出**：

- `packages/agent/**`：prompt builders、context assembler、schema、policy、LLM adapter
- `evals/**`：评测集、脚本、报告
- `docs/AGENT-BEHAVIOR.md`：Agent 行为规范
- `docs/prompts/**`：原始 prompt 记录
- `docs/AGENT-EVAL-REPORT.md`：行为评测报告

---

### 3.3 前端工程师

**使命**：让用户感觉“在看一场直播”，而不是“在看一堆 API 返回”。

**负责**：

- 首页、建局、阵容确认、演播厅、回放
- 设计系统、布局、动效、响应式
- SSE 客户端、断线重连、流式渲染
- 专家状态、发言意图、共识/分歧的可视化
- 组件测试、视觉走查、三档屏宽

**不负责**：

- 不定义 Agent 行为语义
- 不写 prompt
- 不单方面改 API/事件契约
- 不直接改服务端/数据库

**关键产出**：

- `apps/web/**`
- 组件测试
- 页面截图/走查记录
- 前端交接说明

---

### 3.4 后端工程师

**使命**：让系统稳定地跑起来，会话之间严格隔离，数据可恢复。

**负责**：

- SQLite schema、迁移、种子数据
- REST API、SSE、断线补发
- SessionRunner、队列、并发隔离、AbortController
- 事件持久化、回放数据接口
- LLM 调用运行时：超时、重试、限流、错误映射
- 服务端 Key 加载与脱敏
- API/集成测试

**不负责**：

- 不写 prompt
- 不定义 Agent 行为
- 不写 UI
- 不单方面改契约

**关键产出**：

- `apps/server/**`
- 数据库初始化/迁移/种子
- API/SSE 实现
- 后端测试
- `docs/API.md` 的实现校对

---

### 3.5 测试工程师

**使命**：独立证明产品“真的能用”，而不是“开发者说能用”。

**负责**：

- 从 PRD/AC 写测试计划与用例
- 功能测试、用户链路、跨端、响应式
- 前后端连通、SSE 断线/重连、多会话隔离
- 压力测试（mock LLM）
- 回归、缺陷管理、发版门禁
- 独立验证 Agent 行为是否符合 AC（不负责调 prompt）

**不负责**：

- 不直接改生产代码
- 不替 AI/后端调 prompt 或修业务逻辑
- 不给自己发版签字

**关键产出**：

- `e2e/**`
- `docs/QA-PLAN.md`
- `docs/QA-REPORT.md`
- 缺陷单
- 发版结论

---

## 4. 四条关键边界

### 4.1 AI/Agent vs 后端：行为 vs 运行时

| 事项 | AI/Agent | 后端 |
| --- | --- | --- |
| 谁决定下一个发言者 | 定义策略/prompt | 执行调用、排队、发事件 |
| 给模型看什么上下文 | 定义选择/压缩/排序 | 提供事件数据、按接口传入 |
| JSON 输出长什么样 | 定义 schema 与修复策略 | 调用、超时、重试、持久化 |
| 会话状态机 | 定义语义状态/转移 | 实现状态持久化与恢复 |
| SSE 事件 | 定义 Agent 相关事件语义 | 实现传输、序号、补发 |
| 失败兜底文案 | 定义兜底策略/文案 | 执行兜底、记录错误 |

接口建议：

```ts
// packages/agent 对外暴露纯函数/类型
buildRosterPrompt(input): PromptSpec
buildDecisionPrompt(ctx): PromptSpec
buildSpeechPrompt(ctx, decision): PromptSpec
buildConsensusPrompt(ctx): PromptSpec
buildSummaryPrompt(ctx): PromptSpec
assembleContext(snapshot, budget): ContextBundle
parseRoster(raw): Roster
parseDecision(raw): TurnDecision
parseConsensus(raw): ConsensusDelta
selectFallbackSpeaker(ctx): SpeakerId
```

后端只负责：

```text
取快照 → 调 build/assemble → 调 LLM → parse → 校验 → 落库 → 发 SSE
```

这样 prompt 不会散落在 `apps/server` 里，后端也不会被 prompt 细节拖住。

### 4.2 AI/Agent vs PM：实现 vs 验收

- PM 定义“专家要有立场差异、每轮 1–2 句、共识必须有依据”。
- AI/Agent 决定“用什么 prompt、给多少上下文、怎么解析、怎么兜底”。
- PM 不审 prompt 文本，审行为结果和 eval 报告。
- AI/Agent 不单方面改 AC；行为变化影响用户感知时，必须走 PM 变更确认。

### 4.3 AI/Agent vs 测试：行为 eval vs 独立验收

- AI/Agent 做离线 eval：多跑几轮、看多样性/重复率/长度/依据/延迟/成本。
- 测试做独立验收：从 AC 出发，做 E2E、跨端、压力、回归。
- 测试发现行为 bug，转给 AI/Agent；AI/Agent 修 prompt/context；测试复验。
- 测试不调 prompt，AI/Agent 不给自己发版签字。

### 4.4 AI/Agent vs 前端：语义 vs 呈现

- AI/Agent 定义状态语义：`idle / preparing / speaking`、发言意图、公开摘要边界。
- 前端决定怎么显示：颜色、动效、布局、可访问性。
- 前端不把 prompt/CoT 直接渲染到页面；只消费契约中的公开字段。
- 任何新增可见字段，先改 `packages/shared` 契约，再各自实现。

---

## 5. 目录与文件所有权

| 路径 | Owner | 说明 |
| --- | --- | --- |
| `docs/PRD.md`、`docs/TASKS.md`、`docs/WORKFLOW.md`、`README.md` | PM | 北极星与交付文档 |
| `docs/API.md`、`docs/EVENTS.md`、`packages/shared/**` | PM | 契约，变更需 PM 批准 |
| `docs/AGENT-BEHAVIOR.md`、`docs/prompts/**`、`packages/agent/**`、`evals/**` | AI/Agent | 行为、上下文、eval |
| `apps/server/**`、`data/**`、`scripts/db/**` | 后端 | 运行时与数据 |
| `apps/web/**` | 前端 | UI/交互 |
| `e2e/**`、`docs/QA-*.md` | 测试 | 独立质量门禁 |
| 根 `package.json`、`pnpm-lock.yaml`、`tsconfig.base.json` | PM | 共享配置，角色不并发修改 |

规则：

- 角色只改自己 owner 的目录。
- 共享文件由 PM 统一修改，避免 lockfile/配置冲突。
- 跨目录改动先提变更单，由 PM 协调。
- 每个角色交付时附“改了哪些文件 + 测试结果 + 风险”。

---

## 6. RACI

> R = 负责执行，A = 最终负责，C = 需咨询，I = 知会

| 工作项 | PM | AI/Agent | 后端 | 前端 | 测试 |
| --- | --- | --- | --- | --- | --- |
| PRD / AC / 范围 | A/R | C | C | C | C |
| Agent 行为规范 | A | R | C | C | C |
| Prompt / 上下文 / 模型参数 | A | R | I | I | C |
| API / SSE / DB / 会话隔离 | A | C | R | C | I |
| UI / 交互 / 响应式 | A | C | C | R | I |
| 行为 eval | A | R | C | I | C |
| E2E / 压力 / 发版门禁 | A | C | C | C | R |
| 需求变更 | A/R | C | C | C | C |
| Prompt 记录汇编 | A/R | C | I | I | I |

---

## 7. 更新后的工作流

| 闸门 | 内容 | 出口条件 |
| --- | --- | --- |
| G0 需求冻结 | PRD、范围、AC、非目标 | 每条 P0 有 ID/AC |
| G1 行为与契约冻结 | Agent 行为规范、prompt v1、ER/API/SSE、eval 计划 | 四个角色对契约无歧义 |
| G2 脚手架与基线 | 单仓、DB、mock LLM、prompt v1、eval 基线 | 一条命令跑通空会话 |
| G3 并行开发 | AI 行为包、后端运行时、前端 UI、QA 用例 | 每个小周期可运行/可测 |
| G4 集成与调优 | 联调、行为 eval、E2E 主链路 | 行为指标达标，主链路全通 |
| G5 硬化 | 响应式、断线、并发、压力、安全 | 无 P0/P1，指标达标 |
| G6 交付 | README、Prompt 记录、工作流、Git 历史 | 交付物逐项对照题目 |

新增 **G1 行为与契约冻结** 是关键：AI/Agent 必须先给出 prompt v1 和上下文预算，后端才能把它接进运行时；否则后端会先写死一套 prompt，后面全部返工。

---

## 8. 变更控制

任何以下变更，必须走 PM：

- 可见行为/状态语义变化
- API/SSE/事件字段变化
- 数据库 schema 变化
- prompt 目标/验收标准变化
- 模型/参数变化影响延迟或成本
- 新增 P1/P2 功能

流程：

```text
提出变更 → PM 影响分析 → 更新 PRD/契约版本 → 通知四个角色 → 更新任务包 → 实施
```

Prompt 文本本身的小迭代，AI/Agent 可以在不改变 AC 的前提下自主进行，但必须：

- 版本号递增
- 跑一次 eval
- 记录变更原因和结果
- 不改变对外可见语义

---

## 9. 交付物映射

| 题目要求 | Owner | 产出 |
| --- | --- | --- |
| 完整源码 / Git 链接 | 全体 | `apps/`、`packages/`、`e2e/` |
| 数据库初始化 + 5 条样例 | 后端 | 迁移、seed、样例数据 |
| 开发文档（PRD/ER/API） | PM + 后端 | `docs/PRD.md`、ER 图、`docs/API.md` |
| 测试代码 | 前端/后端/测试 | 单测、集成、E2E、压力 |
| README | PM | 运行指南、环境变量、API 列表、能力与改进 |
| Prompt 记录（≥5 段） | AI/Agent + PM | `docs/prompts/**` + `docs/PROMPT-LOG.md` |
| 工作流说明（1–1.5 页） | PM | `docs/WORKFLOW.md` |
| Git 提交历史 | PM | 分层提交：docs → schema → api → ui → tests → fix |

---

## 10. 对时间的影响

新增角色不是“多一个人一定更快”，它带来两类成本：

- 协调成本：多一个接口、多一份行为契约
- 评测成本：prompt 需要多轮 eval

但它是核心角色，越早加入越省返工。估算：

- 净增约 **4–6 人时**
- 总人时约 **52–68h**
- 关键路径约 **34–40h**
- 加 PM 集成后到 RC 约 **36–42h**
- 剩余约 43h，缓冲约 **1–7h**

结论：**可行，但更紧。不能再加第五个角色，也不能做 P2。**

时间上的硬约束：

- AI/Agent 必须在 G1 就位
- 11/1 中午前必须有 prompt v1 和 eval 基线
- 11/2 10:00 行为冻结（prompt 只修 bug，不调风格）
- 11/2 12:00 功能冻结
- 11/2 15:00 RC
- 11/2 17:00 提交

---

## 11. 风险与控制

| 风险 | 缓解 |
| --- | --- |
| AI 角色变成第二个后端 | 只拥有 `packages/agent`，不碰 API/DB/SSE |
| prompt 散落在后端 | 后端禁止硬编码 prompt；CI/走查扫描 |
| AI 角色无限调 prompt | eval 指标 + 每阶段最多两轮调优 + 时间盒 |
| 行为 eval 与 QA 重复 | AI 做离线行为 eval，QA 做独立产品验收 |
| 接口漂移 | 契约先行，`packages/shared` 单一事实源 |
| Key 扩散 | 原始 Key 文件只配置时读一次；运行只用环境变量；AI 不接触 Key 文件 |
| 角色过多 | 四个执行角色是上限；PM 统一分派与集成 |

---

## 12. 已确认

1. 新增 **AI/Agent 工程师**，按上述边界执行。
2. 角色名：**AI/Agent 工程师**。
3. 接受时间影响：总人时 52–68h，关键路径 34–40h，到 RC 36–42h，缓冲 1–7h。
4. 接受 11/2 10:00 行为冻结、12:00 功能冻结。

执行顺序：

- 更新技术选型文档中的角色与工时（已完成）
- 建立 `docs/AGENT-BEHAVIOR.md` 草案（由 AI/Agent 在 G1 产出）
- 调整任务板，增加 AI/Agent 工作流
- 创建第四个智能体
