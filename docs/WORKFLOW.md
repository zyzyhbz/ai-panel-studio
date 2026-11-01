# 开发过程思路与工作流说明

- 日期：2026-11-01
- 状态：交付版
- 关联：[PRD](PRD.md)、[角色 SOP](02-角色与协作SOP.md)、[任务板](TASKS.md)、[真实 smoke](REAL-SMOKE.md)

## 1. 工具链与角色

题目问的是“如何通过 Claude Code 结合 Deepseek V4 Pro 开发”。本次实际使用的是 **DeepSeek Harness（Vibe Coding 工具）+ deepseek-flash 模型**，没有使用 Claude Code；原因是本机环境与可用模型接入。工作流可以等价迁移到 Claude Code + DeepSeek V4 Pro：把下面每个角色的任务包交给 Claude Code，角色边界、契约、测试门禁不变。实际工具不同，不影响“工程化拆解”的方法论；这一点在交付文档中如实说明，不包装成使用过 Claude Code。

团队编制：

| 角色 | 职责 |
| --- | --- |
| PM | 需求、PRD、契约、任务分派、变更控制、集成、交付 |
| AI/Agent | prompt、上下文工程、发言策略、行为 eval |
| 前端 | 演播厅 UI、交互、响应式、SSE 客户端 |
| 后端 | SQLite、API、SSE、SessionRunner、持久化 |
| 测试 | 独立验收、E2E、压力、回归、发版门禁 |

四个执行角色各由一个智能体承担；PM 是唯一的需求入口、契约出口和集成出口。

## 2. 开发流程

```text
G0 需求冻结 → G1 契约冻结 → G2 脚手架/mock 基线
→ G3 四角色并行 → G4 集成/行为调优 → G5 硬化/回归 → G6 交付
```

- **G0**：把题目、用户笔记、角色约束整理成 PRD；P0/P1/P2 与非目标写清。
- **G1**：四角色分别评审 ER/API/SSE、前端数据需求、测试可测性；PM 裁决并冻结契约 v1.0。本阶段不写生产代码，避免接口未定就返工。
- **G2**：单仓脚手架、SQLite migration/seed、Fastify/Vite 骨架、mock 基线、Playwright 骨架。
- **G3**：按垂直切片并行：创建/阵容 → 确认/开场 → 发言/SSE → 洞察 → 总结 → 回放 → 多会话 → 响应式。
- **G4**：真实 DeepSeek smoke、行为 eval、E2E 主链路、SSE 断线/回放一致性。
- **G5**：35 条 E2E、压力/安全/三档布局、Key 扫描、构建；0 P0/P1 才 RC。
- **G6**：README、Prompt 记录、工作流、Git 历史、提交包。

目录所有权固定：AI 改 `packages/agent`，后端改 `apps/server`，前端改 `apps/web`，测试改 `e2e`，PM 改 `docs`/根配置。共享文件不并发修改；PM 统一提交，提交历史按 `docs → schema → api → ui → tests → fix` 分层。

## 3. 与 AI 协同中的 3 个真实问题

### 问题 1：多智能体并行，契约容易漂移

四角色同时开工时，前端按自己的想象调 API，后端按自己的理解存字段，AI 把 prompt 写进 server，最后接口对不上。

**解决**：先冻结 PRD/ER/API/SSE，再并行；每个任务包固定包含目标、输入文档版本、允许修改目录、验收标准、停止条件；后端/前端/AI 只改自己目录；跨目录变更走 PM。实际效果是 G3 没有出现大范围接口返工。

### 问题 2：mock 太快，直播页变成“空壳”

后端 `MOCK_DELAY_MS=0` 时，12 轮只要 16ms。前端 confirm 后刚连上 SSE，会话已经 `ended`；SSE 对终态立即 close，补发帧一帧都没收到；前端又只做了 `localStatus=live`，没有回读投影，于是页面显示“直播中 / 0 轮 / 0 条”。

**解决**：前端 confirm 后 `await refresh()` 回读 detail；SSE `stream.ready` 发现终态/状态不一致时主动 refresh；QA 用真实浏览器复现并写成回归用例。这是本次最有价值的联调 bug——它证明“POST 成功”不等于“UI 有数据”。

### 问题 3：洞察恒为 0，异常被异步 catch 吞掉

真实 API smoke 时 12 轮、总结都正常，但 insights=0。根因是 agent 用会话内序号 `i_1` 做洞察 id，而 `insights.id` 是全局主键；第二个讨论插入 `i_1` 直接撞主键。异常被 `insight.service` 的异步 `drain()` catch 成一行 warn，表面看就是“没有洞察、也没有报错”。

**解决**：后端改为 `i_ + sha256(discussionId:type:contentHash)` 派生全局唯一 id；测试新增“同库两个讨论都产生洞察且 id 不冲突”；`insight.service` 把 accepted/rejected 原因打成 info 日志。真实 smoke 随后得到 6 条洞察。

另外两个工程问题：Playwright trace 写到中文路径会 `ENOENT`，已改到 `%TEMP%\ai-panel-e2e`；PowerShell 5.1 默认 GBK 解码会让 UTF-8 文件“看起来乱码”，实际文件正常，已用字节级 UTF-8 校验确认，不做无意义重写。

## 4. 对“工程化 AI 开发”的理解

工程化 AI 开发不是“写一个更大的 prompt，让 AI 一次生成整个项目”。它更像搭一条可控的生产线：

1. **拆解**：把产品拆成角色、契约、状态机、垂直切片。
2. **约束**：用 PRD、API、事件 schema、目录所有权限制 AI 的自由度。
3. **验证**：单测、契约测试、E2E、行为 eval、压力测试，每层都有证据。
4. **可观测**：日志、request/session ID、耗时、成本；出问题能定位到哪一层。
5. **可回滚**：小周期提交，契约版本化，失败可降级。
6. **上下文管理**：给 AI 的信息“够用且最新”，不是越多越好；跨会话必须隔离。

AI 可以很快地写代码，但它不会自动对“产品是否成立”负责。PM 的价值不是写更多 prompt，而是定义正确目标、切好边界、控制变更、用测试和证据做验收。AI/Agent 工程师的价值也不是“会写 prompt”，而是把 Agent 行为变成可重复、可评估、可回归的工程对象。

## 5. 实际结果

- 全仓 typecheck 通过；agent 92、web 42、server 28 个测试通过；E2E **35/35**。
- 真实 DeepSeek smoke：36 轮、0 degraded、184 秒、7 条洞察、30 条引用，总结正常，Key 无泄露。
- Prompt 记录：`docs/prompts/runtime/` 五份全文 + `docs/prompts/devlog/` 开发过程记录。
- 已知限制：真实模型只做 1 次 smoke，未做 5 议题真实 eval；限流未实现；视频/语音/登录为非目标。

> 本文按实际发生的问题记录，不写成“事后包装的完美流程”。
