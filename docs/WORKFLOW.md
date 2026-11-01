# 开发过程思路与工作流说明

- 日期：2026-11-01
- 状态：交付版（正文约 1.5 页）
- 关联：[多 Agent 与阶段映射](08-多Agent协作与阶段映射.md)、[Prompt 记录](PROMPT-LOG.md)、[PRD](PRD.md)

## 1. 工具链与角色

题目问的是“Claude Code + DeepSeek V4 Pro”。本次实际使用 **DeepSeek Harness + deepseek-flash**，没有使用 Claude Code；这是本机环境和模型接入决定的。方法可以等价迁移：把下面每个角色的任务包交给 Claude Code，契约、目录边界、测试门禁不变。文档如实说明，不包装成使用过 Claude Code。

| 角色 | 职责 |
| --- | --- |
| PM（我） | 需求、PRD、契约裁决、任务分派、集成、验收、提交 |
| AI/Agent | runtime prompt、上下文、发言策略、行为 eval |
| 前端 | 演播厅、圆桌、状态、主题、SSE 客户端 |
| 后端 | SQLite、API、SSE、SessionRunner、恢复 |
| 测试 | E2E、压力、回归、发版门禁 |

四个执行角色各由一个 Agent 承担；PM 是唯一的需求入口、契约出口和集成出口。

## 2. 多 Agent 与 SDD / DDD / TDD / E2E

这不是“PM 一个人按阶段手写所有 Prompt”，而是**角色分工 + 工程检查点**：

| 阶段 | 主要责任 Agent | PM 实际做什么 |
| --- | --- | --- |
| SDD | 后端/前端/测试评审契约 | 下发评审任务、裁决并冻结 API/SSE |
| DDD | AI/后端/前端 | 定领域语言、限界上下文、事件溯源不变量 |
| TDD/回归 | 各实现 Agent | 给失败现象和验收，审查测试能否抓住 bug |
| E2E | 测试 Agent | 定义用户旅程和门禁，不替测试改实现 |

Prompt 分两类：**PM→Agent 的任务/评审/验收 Prompt**（需求拆解、G1 评审、Bug 复现、布局回归、用户反馈改版）和 **Agent 运行时/实现 Prompt**（P-ROSTER/P-DECIDE/P-SPEECH 等，由对应 Agent 编写、PM 审核）。不冒充每段 Prompt 都是 PM 手写；详细映射见 [08](08-多Agent协作与阶段映射.md)。

## 3. 开发流程

```text
G0 需求冻结 → G1 契约冻结 → G2 脚手架/mock 基线
→ G3 四角色并行 → G4 集成/行为调优 → G5 硬化/回归 → G6 交付
```

- **G0**：题目 + 用户笔记 → PRD，划 P0/P1/P2 与非目标。
- **G1**：四角色评审 ER/API/SSE/可测性；PM 裁决，冻结契约 v1.0，不写生产代码。
- **G2**：单仓、SQLite migration/seed、Fastify/Vite 骨架、mock、Playwright 骨架。
- **G3**：按垂直切片并行：创建/阵容 → 确认/开场 → 发言/SSE → 洞察 → 总结 → 回放 → 多会话 → 响应式。
- **G4**：真实 DeepSeek smoke、行为 eval、E2E 主链路、断线/回放一致性。
- **G5**：35 条 E2E、压力/安全/三档布局、Key 扫描、构建；0 P0/P1 才 RC。
- **G6**：README、Prompt、工作流、Git 历史、zip、邮件。

目录所有权固定：AI 改 `packages/agent`，前端 `apps/web`，后端 `apps/server`，测试 `e2e`，PM 改 `docs`/根配置。共享文件不并发修改；PM 统一提交，历史按 `docs → schema → api → ui → tests → fix` 分层。

## 4. 三个真实问题

**契约漂移**：四角色同时开工时，前端按想象调 API、后端按自己理解存字段。解决：先冻结 PRD/ER/API/SSE 再并行；任务包固定包含目标、输入文档版本、允许修改目录、验收标准；跨目录变更走 PM。G3 没有出现大范围接口返工。

**直播页空壳**：`MOCK_DELAY_MS=0` 时 12 轮只要 16ms，confirm 后 SSE 连上时已 ended，前端只写 `localStatus=live` 没回读投影，页面显示“直播中 / 0 轮 / 0 条”。解决：confirm 后 `await refresh()`；`stream.ready` 状态不一致时 refresh；QA 用真实浏览器回归。结论：POST 成功不等于 UI 有数据。

**洞察恒为 0**：12 轮、总结正常但 insights=0。根因是 agent 用会话内序号 `i_1` 做洞察 id，而 `insights.id` 是全局主键；第二个讨论插入即撞主键，异常被异步 `drain()` 吞成 warn。解决：改为 `i_ + sha256(discussionId:type:contentHash)`，新增跨讨论回归，并把 accepted/rejected 打成 info 日志。真实 smoke 随后得到洞察。

另外：Playwright trace 中文路径 `ENOENT` → `%TEMP%\ai-panel-e2e`；PowerShell 5.1 默认 GBK 会让 UTF-8 文件“看起来乱码”，实际文件正常，不做无意义重写。

## 5. 对工程化 AI 开发的理解

工程化 AI 开发不是“写一个更大的 prompt，让 AI 一次生成整个项目”，而是搭一条可控生产线：

1. **拆解**：角色、契约、状态机、垂直切片；
2. **约束**：PRD、API、事件 schema、目录所有权；
3. **验证**：单测、契约、E2E、行为 eval、压力，每层有证据；
4. **可观测**：日志、request/session ID、耗时、成本；
5. **可回滚**：小周期提交、契约版本化、失败降级；
6. **上下文管理**：给 AI 的信息够用且最新，跨会话必须隔离。

AI 能很快写代码，但不会自动对“产品是否成立”负责。PM 的价值是定义正确目标、切边界、控制变更、用证据验收；AI/Agent 工程师的价值是把 Agent 行为变成可重复、可评估、可回归的工程对象。

## 6. 实际结果

- typecheck 通过；agent 92、web 42、server 28 测试通过；E2E **35/35**。
- 真实 DeepSeek smoke：36 轮、0 degraded、184 秒、7 条洞察、30 条引用，Key 无泄露。
- Prompt：`docs/prompts/runtime/` 五份全文 + `docs/prompts/devlog/`；PM/Agent 作者归属已标注。
- 已知限制：真实模型只做 1 场 3 人 smoke；限流未实现；视频/语音/登录为非目标。

> 本文按实际发生的问题记录，不写成“事后包装的完美流程”。
