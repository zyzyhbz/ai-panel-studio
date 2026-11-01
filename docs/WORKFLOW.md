# 开发过程思路与工作流说明

- 姓名：李荟源
- 日期：2026-11-01
- 状态：交付版（正文约 1.5 页）
- 关联：[多 Agent 协作说明](08-多Agent协作与阶段映射.md)、[Prompt 记录](PROMPT-LOG.md)、[PRD](PRD.md)

## 1. 工具链与分工

题目问的是“Claude Code + DeepSeek V4 Pro”。我实际使用的是 **DeepSeek Harness + deepseek-flash**，没有使用 Claude Code；这是本机环境和模型接入决定的。方法可以等价迁移：把每个角色的任务包交给 Claude Code，契约、目录边界、测试门禁不变。

我采用多 Agent 分工，由我统一调度。最初我要求主 Agent 以产品经理身份工作，前端、后端、测试各开一个智能体；在 A 确认后，我发现 prompt 设计和上下文工程如果分散在前端/后端，会出现多套不一致的 Agent 理解，于是补设了独立的 AI/Agent 角色。

| 角色 | 我派它做什么 |
| --- | --- |
| 产品经理 Agent | 需求、PRD、功能边界、验收标准 |
| AI/Agent 工程师 | runtime prompt、上下文、发言策略、行为 eval |
| 前端 Agent | 演播厅、圆桌、状态、主题、SSE 客户端 |
| 后端 Agent | SQLite、API、SSE、SessionRunner、恢复 |
| 测试 Agent | E2E、压力、回归、发版门禁 |

产品、AI、前端、后端、测试分别由一个 Agent 承担；我负责需求入口、契约裁决、集成和最终验收。

## 2. 多 Agent 与 SDD / DDD / TDD / E2E

我的调度方式是**任务包 + 验收**：我定义目标、上下文、边界和验收，Agent 在任务包内展开实现级 Prompt 和代码。我给每个 Agent 的任务包固定包含：目标、输入文档、允许修改的目录、必须产出、验收标准、停止条件。跨目录变更必须回到我这里裁决。

| 阶段 | 我如何引导 | 我验收什么 |
| --- | --- | --- |
| SDD | 让后端/前端/测试先评审契约，我裁决冻结 | API/SSE 契约、契约测试 |
| DDD | 让 AI/前端/后端先定领域语言和边界 | 事件溯源、直播/回放同源、布局设计 |
| TDD/回归 | 给失败现象和验收标准，让实现 Agent 补测试 | 测试是否真能抓住 bug |
| E2E | 定义用户旅程和门禁，测试 Agent 独立实现 | 35 条真实浏览器用例 |

详细的角色/阶段关系见 [多 Agent 协作说明](08-多Agent协作与阶段映射.md)。

## 3. 开发流程

```text
G0 需求冻结 → G1 契约冻结 → G2 脚手架/mock 基线
→ G3 多角色并行 → G4 集成/行为调优 → G5 硬化/回归 → G6 交付
```

- **G0**：题目 + 需求笔记 → PRD，划 P0/P1/P2 与非目标。
- **G1**：后端/前端/测试评审 ER/API/SSE/可测性；我裁决并冻结契约 v1.0，不写生产代码。
- **G2**：单仓、SQLite migration/seed、Fastify/Vite 骨架、mock、Playwright 骨架。
- **G3**：按垂直切片并行：创建/阵容 → 确认/开场 → 发言/SSE → 洞察 → 总结 → 回放 → 多会话 → 响应式。
- **G4**：真实 DeepSeek smoke、行为 eval、E2E 主链路、断线/回放一致性。
- **G5**：35 条 E2E、压力/安全/三档布局、Key 扫描、构建；0 P0/P1 才 RC。
- **G6**：README、Prompt、工作流、Git 历史、zip、邮件。

目录所有权固定：AI 改 `packages/agent`，前端 `apps/web`，后端 `apps/server`，测试 `e2e`。共享文件不并发修改；我统一提交，历史按 `docs → schema → api → ui → tests → fix` 分层。

## 4. 三个真实问题

**契约漂移**：多角色同时开工时，前端按想象调 API、后端按自己理解存字段。解决：先冻结 PRD/ER/API/SSE 再并行；任务包固定目标、输入版本、允许修改目录、验收标准；跨目录变更走我。G3 没有出现大范围接口返工。

**直播页空壳**：`MOCK_DELAY_MS=0` 时 12 轮只要 16ms，confirm 后 SSE 连上时已 ended，前端只写 `localStatus=live` 没回读投影，页面显示“直播中 / 0 轮 / 0 条”。解决：confirm 后 `await refresh()`；`stream.ready` 状态不一致时 refresh；测试 Agent 用真实浏览器回归。结论：POST 成功不等于 UI 有数据。

**洞察恒为 0**：12 轮、总结正常但 insights=0。根因是 agent 用会话内序号 `i_1` 做洞察 id，而 `insights.id` 是全局主键；第二个讨论插入即撞主键，异常被异步 `drain()` 吞成 warn。解决：改为 `i_ + sha256(discussionId:type:contentHash)`，补跨讨论回归，并把 accepted/rejected 打成 info 日志。真实 smoke 随后得到洞察。

另外：Playwright trace 中文路径 `ENOENT` → `%TEMP%\ai-panel-e2e`；PowerShell 5.1 默认 GBK 会让 UTF-8 文件“看起来乱码”，实际文件正常，不做无意义重写。

## 5. 对工程化 AI 开发的理解

工程化 AI 开发不是“写一个更大的 prompt，让 AI 一次生成整个项目”，而是搭一条可控生产线：

1. **拆解**：角色、契约、状态机、垂直切片；
2. **约束**：PRD、API、事件 schema、目录所有权；
3. **验证**：单测、契约、E2E、行为 eval、压力，每层有证据；
4. **可观测**：日志、request/session ID、耗时、成本；
5. **可回滚**：小周期提交、契约版本化、失败降级；
6. **上下文管理**：给 AI 的信息够用且最新，跨会话必须隔离。

AI 能很快写代码，但不会自动对“产品是否成立”负责。我的工作不是逐行写代码，而是定义正确目标、切边界、控制变更、用证据验收；同时把 Agent 的行为变成可重复、可评估、可回归的工程对象。

## 6. 实际结果

- typecheck 通过；agent 92、web 42、server 28 测试通过；E2E **35/35**。
- 真实 DeepSeek smoke：36 轮、0 degraded、184 秒、7 条洞察、30 条引用，Key 无泄露。
- Prompt：`docs/prompts/runtime/` 五份全文 + `docs/prompts/devlog/`；我下发的任务/验收 Prompt 见 `PROMPT-LOG.md`。
- 已知限制：真实模型只做 1 场 3 人 smoke；限流未实现；视频/语音/登录为非目标。

> 以上按实际发生的问题记录。
