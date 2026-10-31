# 任务板与分派 v0.1

- 日期：2026-10-31
- 状态：G1 进行中
- Owner：产品经理
- 关联：[PRD](PRD.md)、[API 契约](03-API契约.md)、[SSE 事件契约](04-SSE事件契约.md)、[角色 SOP](02-角色与协作SOP.md)

## 1. 编制

| 角色 | 智能体 | 主要所有权 |
| --- | --- | --- |
| PM | 主会话 | 需求、契约、任务、集成、交付 |
| AI/Agent | 独立智能体 | `packages/agent/**`、`evals/**`、`docs/AGENT-BEHAVIOR.md`、`docs/prompts/**` |
| 后端 | 独立智能体 | `apps/server/**`、`scripts/db/**`、`data/**` |
| 前端 | 独立智能体 | `apps/web/**` |
| 测试 | 独立智能体 | `e2e/**`、`docs/QA-*.md` |

## 2. 当前阶段：G1 行为与契约冻结

**目标**：四个角色在同一份 PRD/API/SSE 契约上达成一致，产出各自的设计输入；**本阶段不写生产代码**，避免契约未定就返工。

**截止**：2026-11-01 01:30
**PM 汇总/冻结**：2026-11-01 02:00

### 2.1 AI/Agent：AI-01

**产出**

- `docs/AGENT-BEHAVIOR.md` v0.1，至少包含：
  - 主持人/专家人设生成规则
  - 主持人开场、追问、串联、收尾职责
  - 发言调度策略（意图、禁止固定轮转、连续发言上限）
  - 上下文组装与 token 预算
  - 公开状态/公开摘要/隐藏 CoT 边界
  - 共识/分歧/待验证的判定与依据
  - JSON 输出 schema 与失败降级
  - 行为 eval 指标与 5 个评测议题
- Prompt 清单 v1（阵容、决策、发言、共识、总结），可先放 `docs/prompts/` 草案。
- 对 API/SSE 契约的评审意见：字段是否足够、是否缺 `persona`/`focus`/`intent` 等。

**不做什么**

- 不写 API/DB/SSE/UI 代码。
- 不做无限 prompt 调优；G1 只交设计与 v1 草案。

**验收**

- 每个 AR-01 ~ AR-11 都有对应实现策略。
- 能说明“下一句谁来说、为什么、看哪些上下文”。
- 能说明“共识如何避免编造”。

---

### 2.2 后端：BE-01

**产出**

- 对 `ER.md`、`03-API契约.md`、`04-SSE事件契约.md` 的逐项评审：
  - schema 是否可落地（约束、索引、事务、seq）
  - 状态机是否可实现（ready/live/summarizing/ended/failed）
  - 同步生成阵容是否可接受
  - SSE 补发/心跳/断线是否符合 Fastify 实现
  - SQLite WAL/并发/恢复的风险
- `docs/BACKEND-PLAN.md` v0.1：
  - 目录结构、模块边界
  - SessionRunner 状态机
  - API 路由清单
  - 事件持久化/投影方案
  - mock LLM 方案
  - 测试清单
- 指出契约中必须修改的字段/接口（如有）。

**不做什么**

- G1 不写业务代码；不改前端/AI 目录。
- 不自行改契约；变更走 PM。

**验收**

- 每个 API 有实现路径和错误码。
- 能解释两个会话并行时如何保证 seq/队列/DB 不串。
- 能解释进程重启后如何恢复/中断。

---

### 2.3 前端：FE-01

**产出**

- `docs/FRONTEND-PLAN.md` v0.1：
  - 页面/路由：首页、创建/阵容、演播厅、回放
  - 三档响应式布局（≥1440 / 1024–1439 / <1024，含 <768）
  - 区域独立滚动的 CSS Grid/Flex 方案
  - 组件树与状态机
  - 设计 token（颜色、字体、间距、动效）
  - 直播/回放共用 reducer 的前端数据流
  - SSE 客户端、断线重连、流式缓冲策略
  - loading/empty/error/reconnecting 状态
- 低保真线框（文字/ASCII 即可），重点说明“演播厅感”从哪来。
- 对 API/SSE 契约的评审意见：UI 是否缺字段/事件。

**不做什么**

- G1 不写页面代码；不改后端/AI 目录。
- 不定义 Agent 行为语义。

**验收**

- 每个 FR-01 ~ FR-17 都有页面/状态落点。
- 能说明三档屏宽下各区域如何独立滚动。
- 能说明直播与回放如何共用 reducer。

---

### 2.4 测试：QA-01

**产出**

- `docs/QA-PLAN.md` v0.1：
  - 测试范围与不测范围
  - FR/AR/NFR → 测试用例矩阵
  - 主链路 E2E 场景
  - 多会话隔离、SSE 断线、LLM 失败、回放一致性场景
  - mock LLM 策略
  - 压力测试方案（5 会话/20 SSE，mock）
  - 安全测试（Key、XSS、输入长度）
  - 响应式/可访问性检查
  - 发版门禁与缺陷分级
- 对 PRD/API/SSE 的可测性评审：哪些 AC 不可观测，需要补事件/字段/测试钩子。

**不做什么**

- G1 不写 E2E 代码；不调 prompt；不改生产代码。
- 不给自己发版签字。

**验收**

- 每条 P0 AC 至少 1 个测试用例。
- 能说明如何在不调用真实模型的情况下测完整链路。
- 能说明“回放与直播一致”如何自动验证。

---

## 3. G1 评审问题（四角色都要回答）

1. 这份契约里，有哪些字段/事件是多余的？
2. 有哪些是缺失的，会导致你这一层无法实现/无法测试？
3. 有哪些状态转换没有定义清楚？
4. 有哪些失败路径没有兜底？
5. 你认为哪个设计会在 72 小时内成为最大风险？

## 4. G1 出口标准

- [ ] 四个角色都提交设计输入
- [ ] API/SSE/ER 的阻塞性问题已修复
- [ ] AI 行为规范与 PRD 的 AR 对齐
- [ ] 前端页面/状态与 FR 对齐
- [ ] QA 用例矩阵覆盖所有 P0 AC
- [ ] PM 发布契约 v1.0 冻结通知

## 5. G2 预告（契约冻结后）

| ID | Owner | 任务 | 依赖 |
| --- | --- | --- | --- |
| PM-02 | PM | 单仓脚手架、根配置、README 骨架 | G1 冻结 |
| AI-02 | AI/Agent | `packages/agent` 骨架、prompt v1、mock evaluator | 契约 v1 |
| BE-02 | 后端 | DB migration/seed、Fastify 骨架、健康检查 | 脚手架 |
| FE-02 | 前端 | Vite 骨架、设计 token、App Shell | 脚手架 |
| QA-02 | 测试 | Playwright 骨架、fixtures、mock server | 契约 v1 |
| BE-03 | 后端 | 创建/阵容/详情 API | BE-02 |
| AI-03 | AI/Agent | 阵容/决策/发言/共识 prompt 接入 | AI-02 |
| FE-03 | 前端 | 首页/创建/阵容确认 | FE-02 |
| QA-03 | 测试 | 主链路 E2E v0 | BE-03/FE-03 |
| BE-04 | 后端 | SSE + SessionRunner | BE-03/AI-03 |
| FE-04 | 前端 | 演播厅直播 + 共识面板 | FE-03 |
| AI-04 | AI/Agent | 行为 eval + 调优 | AI-03 |
| FE-05 | 前端 | 回放 + 响应式 | FE-04 |
| QA-04 | 测试 | 压力/断线/多会话/回放一致性 | BE-04/FE-05 |

## 6. 交付格式

每个角色完成后，用固定格式回报：

```text
【角色】
【任务 ID】
【状态】done / blocked / partial
【产出文件】
【关键决策】
【测试/验证】
【风险/阻塞】
【需要 PM 裁决】
【下一步】
```

## 7. 文件所有权提醒

- AI/Agent：`packages/agent/**`、`evals/**`、`docs/AGENT-BEHAVIOR.md`、`docs/prompts/**`
- 后端：`apps/server/**`、`scripts/db/**`、`data/**`
- 前端：`apps/web/**`
- 测试：`e2e/**`、`docs/QA-*.md`
- PM：`docs/PRD.md`、`docs/03-API契约.md`、`docs/04-SSE事件契约.md`、`docs/ER.md`、`docs/TASKS.md`、根配置、README

> G1 阶段所有人只写自己的设计文档；不要改别人的目录，不要提前写生产代码。
