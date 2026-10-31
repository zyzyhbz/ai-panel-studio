# AI Panel Studio 测试计划（QA-PLAN）v0.1

- 日期：2026-10-31
- 状态：G1 设计输入，待 PM 冻结契约后随契约版本升级
- Owner：测试工程师
- 任务：QA-01
- 关联：[PRD](PRD.md)、[API 契约](03-API契约.md)、[SSE 事件契约](04-SSE事件契约.md)、[ER 图](ER.md)、[技术选型](01-技术选型.md)、[角色与协作 SOP](02-角色与协作SOP.md)、[任务板](TASKS.md)
- 本阶段边界：**只做测试设计，不写 E2E 代码、不安装依赖、不调 prompt、不改生产代码、不调用真实模型**

---

## 0. 结论摘要（TL;DR）

1. **测试目标不是"功能列表全"，而是证明四件事成立**：① 主链路在无真实模型、无 Key、断网条件下可从首页走到回放闭环；② 两个讨论并行时事件/transcript/共识不串线；③ 回放与直播状态完全一致；④ 失败路径不会让会话永久卡在 `live`、不会白屏、不会泄露 Key/CoT/原始 JSON。
2. **P0 必测 = PRD §2.2 的 P0 清单 + §11.2 十项必测场景**。P0 未过不进 G5；P1/P2 明确不阻塞发版。
3. **全部 FR/AR/NFR 共 39 条**（FR-01~17、AR-01~11、NFR-01~11）在 §7 逐条映射到用例编号、测试层级、自动化程度与证据形式，无一条落空。
4. **mock LLM 是主路径，真实模型只做 1 次由 PM 执行的 smoke**。E2E 在 `LLM_MODE=mock`、**未设置 `DEEPSEEK_API_KEY`、物理断网**下全绿，这条本身就是 NFR-07/ADR-06 的证据。
5. **回放一致性用"双路交叉验证"**：把直播终态 DOM 规范化成 JSON，与 `GET /events` 全量事件经共享 reducer 重放的结果做深度相等断言；辅助像素级截图对比。
6. **契约层面存在 12 项阻塞可测性问题**（详见 §14），其中 4 项必须在 G1 冻结前修掉，否则对应用例只能降级为人工抽查：缺少服务端投影接口、缺"串联"意图字段、`POST /end` 幂等返回码不唯一、消息被中止无可观测标记。
7. **发版门禁**：0 个 P0、0 个 P1；Key 扫描通过；主链路 E2E 通过；5 会话/20 SSE 压测通过；39 条 AC 的 P0 子集全部有用例与证据。证据不齐视为未通过。

---

## 1. 测试目标与质量主张

### 1.1 这次测试要回答的问题

| # | 质量主张 | 反例（我们最怕的情况） | 主要验证手段 |
| --- | --- | --- | --- |
| Q1 | 用户能独立完成"从议题到回放"的完整旅程 | 每步都能点，但连起来走不通；或必须看后台日志才知道成功 | E2E-01 主链路 |
| Q2 | 多个讨论真的互不污染 | 页面上是两个讨论，实际共用一份状态或一个 LLM 上下文 | E2E-02 + 接口交叉断言 |
| Q3 | 回放是直播的忠实记录 | 回放少了共识、多了消息、顺序错乱、总结丢失 | E2E-05 双路一致性 |
| Q4 | 网络抖动不毁掉观看体验 | 断线后静默卡死，用户以为讨论停了 | E2E-03 重连补发去重 |
| Q5 | 模型出问题时有体面的兜底 | 一直转圈、白屏、堆栈外泄、会话永久 live | E2E-04 失败族 |
| Q6 | 秘密不出服务端 | Key 进了 bundle、日志、错误响应或 SSE 帧 | SEC-01~04 |
| Q7 | 页面像演播厅而不是后台表格 | 整页乱滚、三档布局塌陷、动效违反 reduced motion | VIS + A11Y |
| Q8 | 测试自己可信 | 用例依赖真实模型/网络/时钟，跑三次三种结果 | §3.3 确定性 + §6.6 可重复 |

### 1.2 测试原则（对本项目的具体化）

1. **从 AC 出发，不从实现出发**：先写"用户能观察到什么"，再决定在哪一层验证。
2. **证据优先于结论**：任何"通过"必须有可复查的产物（DOM 快照、SSE 抓帧、DB 查询结果、日志、截图、报告）。
3. **失败路径与成功路径同等重要**：本产品的失败模式（断线、超时、坏 JSON、并发）比成功模式更容易毁掉体验。
4. **不为通过而调低标准**：mock 通过只证明"管道对"，不证明"模型好"；两者证据分开归档（见 §6.7）。
5. **可重复**：同一条用例连跑 3 次结论必须一致；不一致即视为测试缺陷，优先修测试。

---

## 2. 范围与不测范围

### 2.1 P0 必测（缺一不可，进发版门禁）

对应 PRD §2.2 P0 清单与 §11.2 十项必测场景：

| 编号 | 必测内容 | 覆盖用例 | 说明 |
| --- | --- | --- | --- |
| P0-01 | 首页列表、空态、状态分流（进行中→直播 / 已结束→回放） | TC-FR-01-01~05、E2E-01 | |
| P0-02 | 创建讨论（2–200 字、3–6 人、默认 4）、重复提交阻止、失败可重试 | TC-FR-02-01~04 | |
| P0-03 | 阵容生成（1 主持 + N 专家、五要素齐全、颜色/姓名唯一、≥3 立场） | TC-FR-03-01~04 | |
| P0-04 | 阵容确认 / 重新生成 / 幂等 / 草稿可返回 | TC-FR-04-01~04 | |
| P0-05 | 演播厅布局 + 三档响应式 + 区域独立滚动 + 页面不整体滚动 | TC-FR-05-01~05、VIS-01~06 | |
| P0-06 | 自主发言：主持开场、非轮转调度、1–2 句、8–12 轮收束、硬上限 14 | TC-FR-06-01~04、TC-AR-03-*、E2E-01 | |
| P0-07 | 专家状态小窗 idle/preparing/speaking + 公开关注点，无隐藏 CoT | TC-FR-07-01~03、TC-AR-06-* | |
| P0-08 | 现场 transcript：姓名/职业/色块/顺序/无内部事件/自动滚动策略 | TC-FR-08-01~04 | |
| P0-09 | 实时共识/分歧/待验证：增量更新、有依据、不重复堆叠 | TC-FR-09-01~05 | |
| P0-10 | 主持人自然语言总结、不出现 JSON、持久化可见 | TC-FR-10-01~03、E2E-01 | |
| P0-11 | 回放：播放/暂停/倍速/跳转、刷新可回放、不调 LLM、与直播一致 | TC-FR-11-01~04、E2E-05、E2E-06 | |
| P0-12 | 多讨论并行隔离（事件/transcript/共识/结论/状态） | TC-FR-12-01~04、E2E-02、PERF-05 | |
| P0-13 | 结束/离开：幂等、结束后不可发言、离开不取消后台 | TC-FR-13-01~04、E2E-07 | |
| P0-14 | 5 条样例数据可见可进，≥1 条可完整回放 | TC-FR-14-01~03、E2E-09 | |
| P0-15 | 异常与空态：生成失败、超时、SSE 断线、空列表、无共识 | TC-FR-15-01~06、E2E-03、E2E-04 | |
| P0-16 | Key 仅在服务端：bundle / 网络 / 日志 / 错误响应均无 | SEC-01~04、SEC-09 | |
| P0-17 | 一键运行：Windows 下 README 步骤可复现 | TC-FR-17-01 | |
| P0-18 | mock LLM 可切换、核心逻辑可单测、E2E 不依赖真实模型 | TC-NFR-07-01~03、§6 | |
| P0-19 | 压力：5 会话 / 20 SSE 连接无串流无串数据 | PERF-05 | |
| P0-20 | 可访问性与视觉底线：键盘可达、对比度、reduced motion、颜色非唯一载体 | A11Y-01~08 | |

### 2.2 P1（有时间就测，不阻塞发版）

| 条目 | 处理方式 |
| --- | --- |
| 导出 Markdown / JSON | 若交付则补 1 条导出正确性用例 + 1 条导出不含 Key/CoT；不交付则记为"未实现" |
| 首页搜索/筛选 | 补 1 条筛选正确性 + 1 条 URL 可分享；否则不测 |
| 立场图谱、共识跳转到发言 | 补点击定位用例；否则不测 |
| 重新生成单个专家 | 补单人重生成不破坏其他人 sortOrder 的用例 |
| 暂停/继续讨论 | 补暂停期间不产生新 message.completed 的用例；状态机不在本版契约内，若实现需 PM 先改契约 |
| 议题模板 | 补模板填充不覆盖用户输入 |
| WebKit / Firefox 兼容 | 若 Chromium 全绿且余 ≥2h，跑 WebKit 主链路 1 条 |
| 3G 限速下的体验 | CDP 限速 1 条，仅记录不作为门禁 |

### 2.3 P2 明确不测（并在报告中声明为"未验证"）

- 视频/音频录制导出、语音输入/合成（PRD 非目标）
- 登录、权限、多租户、云端部署、水平扩展、HTTPS/反向代理
- 多人协作编辑、议题树/子议题
- 联网搜索、工具调用、RAG
- 真实模型的**内容质量**（由 AI/Agent 的 AR-11 eval 负责，不属 QA 门禁；QA 只验收 eval 报告是否齐全）
- 跨浏览器像素级视觉一致
- 移动端真机（iOS Safari / Android Chrome）：只做 DevTools 视口模拟，真机属 P1
- 生产环境性能（多机、CDN、进程集群）

### 2.4 结论边界（必须写进 QA 报告，防止过度声称）

- mock 模式下"延迟达标"只代表**服务端管道 + 前端渲染开销**，不代表真实模型首字延迟。
- E2E 通过不代表 Agent 行为质量达标；行为质量以 AR-11 eval 报告 + 人工抽查为准。
- 只测 Chromium 时，结论限定为"Chromium 通过"。
- 未测项在报告中单列，不得用"全部通过"概括。

---

## 3. 测试环境与运行矩阵

### 3.1 环境基线

| 项 | 值 | 备注 |
| --- | --- | --- |
| OS | Windows 11 | 与交付环境一致，脚本不得依赖 bash |
| Node | 20.20.1 | 与 `.nvmrc` 一致 |
| 包管理 | pnpm 11 workspaces | 测试不新增根依赖，压测脚本只用 Node 内置模块 |
| 数据库 | SQLite（WAL） | 每个测试 worker 独立库文件 |
| 后端端口 | 开发 3001 / 测试 3101 | 测试用独立端口，避免与人工调试冲突 |
| 前端端口 | 开发 5173 / 测试 5273 | Vite 代理 `/api` → 3101 |
| 时区 | Asia/Shanghai | `createdAt` 为 UTC，断言用 ISO 字符串比较 |
| 语言 | zh-CN | 断言文案用中文关键字，不硬编码整句 |

### 3.2 双模式（这是整个测试方案的支点）

| 模式 | 开关 | 用途 | 是否进 CI | 成本 |
| --- | --- | --- | --- | --- |
| mock | `LLM_MODE=mock`（默认用于所有自动化） | 单测、接口、E2E、压力、安全 | 是，每次 | 0 |
| real | `LLM_MODE=real` + 服务端 `DEEPSEEK_API_KEY` | 仅 1 次端到端 smoke，由 PM 在 G4/G5 各执行 1 次 | 否 | ≈¥0.5/次 |

硬要求：

1. `LLM_MODE` 未设置或拼错时**启动即失败**（fail-fast），不允许静默回落 real。
2. 自动化测试启动前先 `GET /api/health`，断言 `llmMode === "mock"`；不满足直接中止并报环境错误（防止误用真实 Key 烧钱）。
3. CI/本地跑测试时**不注入** `DEEPSEEK_API_KEY`。E2E 全绿本身构成"不依赖真实模型"的证据。

### 3.3 数据隔离与确定性

| 关注点 | 策略 |
| --- | --- |
| 库隔离 | 每个 worker 一个 `data/qa-<runId>-<worker>.db`；run 结束删除；不使用开发库 |
| 种子 | 每个测试文件跑前 `db:migrate` + 场景化 `seed`（`--only=fixtures`）；种子内容由 fixture 生成，保证 id 可预测 |
| ID | `QA_DETERMINISTIC=1` 时 UUID 改用递增占位 `qa-0001`，便于断言引用关系；关掉时仍须通过所有用例（双跑一次验证） |
| 时钟 | `QA_FIXED_CLOCK=2026-11-01T10:00:00.000Z` 起始、每事件 +1000ms 递增；回放倍速用例用 `page.clock` 控制 |
| 随机 | mock 的 speaker 选择用固定 seed；断言序列而不是断言"随机" |
| 重启类用例 | 用 `child_process` 拉起/杀死 server 进程（Node 脚本，非 bash），端口复用前先探活 |
| 清理 | 每个用例结束断言无残留 SSE 连接（服务端计数归零）+ 无未捕获异常日志 |

> 之所以要求"确定性开关关掉也能通过"：防止用例把实现细节（固定 id/固定时间）当成产品需求。

### 3.4 浏览器与视口矩阵

| 维度 | 取值 | 必测 |
| --- | --- | --- |
| 浏览器 | Chromium（Playwright 自带版本） | 是 |
| 浏览器 | WebKit | P1 |
| 视口 | 2560×1440（超宽）、1920×1080、1440×900、1280×800、1024×768、834×1112、768×1024、390×844 | 1440×900 / 1280×800 / 390×844 必测；其余用于截图归档 |
| 缩放 | 100% / 125% / 150%（Windows 显示缩放） | 125% 抽查 1 次 |
| 系统设置 | normal / `prefers-reduced-motion: reduce` | 是 |

---

## 4. 测试分层与工具映射

| 层 | 代号 | 工具 | 位置 | Owner | 设计用例数 | 触发时机 |
| --- | --- | --- | --- | --- | --- | --- |
| 单元 | U | Vitest | `packages/shared`、`packages/agent`、`apps/server/src` | 各 owner | ≈45 | 每次改动 |
| 组件 | C | Vitest + Testing Library | `apps/web` | 前端 | ≈20 | 每次改动 |
| 接口/集成 | I | Vitest + Fastify `inject` + 临时 SQLite + mock LLM | `apps/server/test` | 后端 | ≈35 | 每次改动 |
| 端到端 | E | Playwright（Chromium） | `e2e/` | **测试** | 12 场景 / 约 40 步 | 每次 PR + 门禁 |
| 非功能 | N | Playwright（多上下文）+ 自研 SSE 压测脚本 + autocannon + axe-core | `e2e/perf`、`e2e/a11y` | **测试** | 24 组 | 每日 + 门禁 |

分工说明（遵循 SOP §3.5 与 TASKS §2.4）：

- 测试角色**直接拥有并编写**：`e2e/**`（E 层与非功能层的 E2E 部分）、`docs/QA-*.md`、压测脚本、Key 扫描脚本、门禁报告。
- U/C/I 层由前后端/AI 各自实现，**测试负责验收**：按 §7 矩阵核对"每条 AC 是否有对应用例且真的在跑"，缺的记缺陷（对 owner 提）。
- 测试**不给自己发版签字**：QA 出结论与证据，PM 签字。

各层职责边界（防止重复测试或漏测）：

| 层 | 该层必须回答 | 该层不负责 |
| --- | --- | --- |
| U | 纯函数对不对：Zod 校验、reduce、调度策略、长度/去重、上下文预算 | HTTP、DB、SSE、渲染 |
| C | 给定 props/事件后 UI 是否按契约渲染与交互 | 真实网络、真实 DB |
| I | API 状态机、错误码、事件 seq、补发、落库、幂等、重启恢复 | 浏览器渲染 |
| E | 用户视角的完整旅程、跨页面状态、断网、多标签、响应式 | 内部函数细节 |
| N | 延迟、吞吐、隔离、内存、安全、可访问性 | 功能正确性（E 层已覆盖） |

---

## 5. 观测面与断言基线

> 测试能不能"证明"，取决于有没有稳定的观测点。本节定义的观测面同时是对契约/前端的可测性要求，冲突项见 §14.2。

### 5.1 五个观测面

| 观测面 | 怎么取 | 用于证明 |
| --- | --- | --- |
| O1 DOM 契约 | `data-testid` + `data-*` 语义属性 | 界面状态、transcript 内容、不串线、响应式、a11y |
| O2 SSE 抓帧 | Playwright 拿不到 EventSource 的原始帧（`page.route` 只能拦请求头，读不到流）。改用**页面内 hook**：前端在测试模式下把收到的原始帧写入 `window.__qa.sse` 环形缓冲（上限 1000 条），E2E 直接读取 | 断线补发、去重、seq 连续性、事件顺序、Key/CoT 不泄露 |
| O3 API 断言 | Playwright `request` 或 Node `fetch` 直连 3101 | 状态机、错误码、分页、幂等、详情/事件一致性 |
| O4 数据落库 | 只读打开 `data/qa-*.db` 执行 `SELECT`（测试侧只读连接） | 投影与事件一致、seq 唯一、无半条消息、摘要唯一 |
| O5 日志断言 | 读 Pino 输出文件 `data/qa-logs/*.log`（JSON lines） | 脱敏、requestId、阶段耗时、无 SQLITE_BUSY |

> O2 的页面内 hook 是**测试钩子需求**（见 §14.2 第 C 项）。若 PM 不批，则 SSE 相关用例降级为"用 Node 直连 SSE 端点"的方式在 I 层验证，E 层只验证 UI 可观察结果（连接状态点、消息是否补齐），断言强度下降一档。

### 5.2 DOM 契约（需要前端在 FE-01 里确认，进 `packages/shared` 常量）

| testid | 关键属性 | 断言用途 |
| --- | --- | --- |
| `app-shell` | — | 根节点存在 |
| `home-list` / `home-empty` / `home-error` | — | 首页四态互斥 |
| `disc-card` | `data-discussion-id`、`data-status` | 卡片数量/状态分流 |
| `disc-card-progress` | `data-turn-count` | 进度与 API 一致 |
| `disc-card-summary` | — | ended 有摘录、live 无 |
| `create-topic` / `create-expert-count` / `create-submit` / `create-error` | — | 表单校验 |
| `roster-panel` / `roster-member` | `data-expert-id`、`data-role`、`data-color` | 阵容五要素 |
| `roster-confirm` / `roster-regenerate` | `data-disabled` | 幂等与禁用 |
| `stage-status` | `data-status` | live/summarizing/ended/failed |
| `stage-conn-state` | `data-conn-state` = `connecting` / `live` / `reconnecting` | 断线重连断言 |
| `stage-turn-count` | `data-turn-count` | 轮次 |
| `panel` | `data-panel` = `topic` / `experts` / `transcript` / `insights` | 独立滚动、三档布局 |
| `expert-card` | `data-expert-id`、`data-status` = `idle`/`preparing`/`speaking`、`data-focus` | 状态小窗 |
| `transcript-list` | `role="log"`、`aria-live="polite"` | a11y + 消息容器 |
| `transcript-item` | `data-message-id`、`data-seq`、`data-speaker-id`、`data-intent`、`data-turn-index` | 顺序、去重、不串线、无内部事件 |
| `insight-section` | `data-type` = `consensus`/`divergence`/`open_question` | 三区存在与空态 |
| `insight-item` | `data-insight-id`、`data-evidence-count` | 依据数、去重 |
| `summary-panel` / `summary-content` | — | 总结展示与 JSON 黑名单 |
| `replay-controls` / `replay-play` / `replay-speed` / `replay-seek` | `data-speed`、`data-state` | 回放控制 |
| `jump-to-latest` | — | 上滚后出现 |
| `toast` / `error-banner` | `data-code` | 可读错误态 |
| `mobile-tabs` | `data-tab` | <768 单栏 Tab |

### 5.2.1 与 FE-01 已有约定的对齐（G1 需拍板）

`docs/FRONTEND-PLAN.md` 已给出 `data-testid` 约定（`stage-header`、`status-pill`、`expert-card-{expertId}`、`message-{messageId}`、`insight-{type}-{insightId}`、`jump-to-latest`、`insight-badge`、`replay-slider`、`replay-speed-{1|1.5|2}`、`reconnect-banner`）。与本节的差异与建议：

| 场景 | FE-01 写法 | 本节建议 | 理由 |
| --- | --- | --- | --- |
| 消息条目 | `message-{messageId}`（testid 内插 id） | `transcript-item` + `data-message-id` | 静态 testid 便于 `$$eval` 批量取、便于等待"至少 N 条"；id 放 `data-*` 才能同时断言去重与顺序 |
| 专家卡片 | `expert-card-{expertId}` | `expert-card` + `data-expert-id` | 同上；且状态断言要按 `data-status` 过滤 |
| 洞察条目 | `insight-{type}-{insightId}` | `insight-item` + `data-insight-id` / `data-type` | 三区容器用 `insight-section[data-type]`，条目用属性区分，避免 testid 组合爆炸 |
| 状态胶囊 | `status-pill` | `stage-status` + `data-status` | 断言要读 `data-status` 值而不是比对文案 |
| 断线提示 | `reconnect-banner` | `stage-conn-state` + `data-conn-state` | 连接状态是状态机（connecting/live/reconnecting），不是一条 banner |

**结论**：建议统一为"**静态 testid + 语义 data 属性**"，两套名字合并成一份常量放进 `packages/shared`；FE-01 只需在我列出的 ~22 个 testid 上补 `data-*`，改动很小。若 FE-01 坚持内插式 testid，则本节所有批量断言需改写成 `[data-testid^="message-"]` 前缀选择器，可维护性下降但仍可执行（不影响用例有效性，只影响实现成本）。

### 5.3 通用断言工具约定（后续 QA-02 落地）

- `normalizeTranscript(page)` → `[{id, seq, speakerId, intent, turnIndex, content}]`，按 `turnIndex` 排序后比较。
- `normalizeInsights(page)` → `{consensus:[id...], divergence:[...], open_question:[...]}`。
- `normalizeLiveState(page)` → `{status, turnCount, transcript, insights, summary}`，用于回放一致性（§9.4）。
- `fetchAllEvents(id)` → 分页拉全量 `GET /events`，返回按 `seq` 升序数组。
- `assertNoSecrets(text)` → 正则黑名单：`sk-[A-Za-z0-9]{8,}`、`reasoning_content`、`chain_of_thought`、`Authorization`、`at Object.`、`node_modules`、`SQLITE_`、`D:\\`、`E:\\`。
- `assertNoJsonLeak(text)` → 黑名单：`{"`、`"consensus"`、`"divergence"`、`"evidenceMessageIds"`、`"intent":`。
- `waitForSeq(id, n, timeoutMs)` → 轮询 API 直到 `lastSeq >= n` 或超时。

---

## 6. Mock LLM 策略（核心）

### 6.1 六条原则

1. **在 adapter 边界替换，不替换业务逻辑**。mock 只接管 `packages/agent` 里那层 HTTP transport（OpenAI 兼容客户端）。prompt 组装、Zod 校验、状态机、队列、SSE、SQLite、前端渲染全部走真实代码。只有这样才能证明"系统能用"，而不是"桩能用"。
2. **mock 在服务端进程内，不用 Playwright 拦截 `/api`**。route 拦截只能测前端，测不到落库、seq、补发、幂等。E2E 结构固定为：真实前端 + 真实后端 + mock LLM。
3. **fixture 是数据不是逻辑**。纯 JSON 文件，禁止在 fixture 里写判断/循环。任何"随机性"由 mock 引擎按 seed 决定，不写在 fixture 里。
4. **fixture 必须包含坏样本**。只放"完美输出"的 mock 会掩盖 AR-09 的失败，等于自欺。`speech/duplicate.json`、`decision/round-robin.json`、`summary/json-leak.json` 是长期保留的负例资产。
5. **按会话注入故障**。同一个进程里要能跑"会话 A 正常 + 会话 B 超时"，否则并行隔离用例必须先重启服务，时序不可控。
6. **调用可审计**。每次 mock 调用落一行 JSONL，用于证明"上下文不跨会话""模型与 thinking 参数正确""成本估算"，也用于断言"回放不调 LLM"（调用计数为 0）。

### 6.2 开关与作用域

| 名称 | 作用域 | 取值 | 说明 |
| --- | --- | --- | --- |
| `LLM_MODE` | 进程 | `mock`（默认测试）/ `real` | 拼错即启动失败 |
| `QA_SCENARIO` | 进程（默认场景） | `normal`/`slow`/`timeout`/`invalid-json`/`empty`/`duplicate`/`runaway`/`long`/`mixed` | 影响该进程新建的所有会话 |
| `x-qa-scenario` | 单次请求（仅 mock 且非 production） | 同上 | 创建讨论时绑定到该会话，用于并行异构场景 |
| `QA_FIXED_CLOCK` | 进程 | ISO 时间 | 固定时间基准 |
| `QA_DETERMINISTIC` | 进程 | `0`/`1` | 固定 UUID 与 speaker 选择 |
| `QA_LLM_LOG` | 进程 | 文件路径 | mock 调用记录（JSONL） |
| `QA_DELTA_INTERVAL_MS` | 进程 | 默认 80 | 流式 delta 间隔，用于慢流 |

> `x-qa-scenario` 属于**仅测试生效**的能力，必须满足两个条件才生效：`LLM_MODE=mock` 且 `NODE_ENV !== 'production'`；生产构建应在外层拒绝该 header（见 §14.2 第 C 项）。

### 6.3 fixture 设计

目录（QA-02 落地）：

```text
e2e/fixtures/llm/
├── roster/
│   ├── default.json          # 1 主持 + 4 专家，颜色/立场互不重复
│   ├── six-experts.json      # expertCount=6 边界
│   ├── three-experts.json    # expertCount=3 边界
│   ├── dup-color.json        # 负例：两人同色
│   ├── dup-name.json         # 负例：两人同名
│   ├── same-stance.json      # 负例：4 人立场雷同（只有 1 种）
│   ├── invalid-json.json     # 负例：缺右括号
│   ├── empty.json            # 负例：空字符串
│   └── timeout.json          # 负例：hang 30s
├── decision/
│   ├── normal.json           # 10 轮，speaker 序列非轮转，含 host probe/bridge
│   ├── round-robin.json      # 负例：1,2,3,4,1,2,3,4（应被判违规或降级）
│   ├── same-speaker-x3.json  # 负例：同一专家连续 3 次
│   ├── invalid-speaker.json  # 负例：返回不存在的 expertId
│   ├── invalid-intent.json   # 负例：intent=abc
│   └── runaway.json          # 20 轮不给 summary（测硬上限 14）
├── speech/
│   ├── normal.json           # 每轮 1–2 句，≤120 码点
│   ├── long.json             # 300 字小作文（测截断/重试）
│   ├── empty.json            # 空串 / 纯空白 / 仅标点
│   ├── duplicate.json        # 连续 3 条完全相同内容
│   └── slow.json             # delta 间隔 800ms，首字延迟 3s
├── consensus/
│   ├── normal.json           # 三类各 1–3 条，每条 ≥1 依据
│   ├── unsupported.json      # 负例：consensus 无 evidenceMessageIds
│   ├── dup-stack.json        # 负例：同一结论重复 5 条（测不堆叠）
│   └── empty.json            # 空数组（测空态）
├── summary/
│   ├── normal.json           # 自然语言，覆盖共识/分歧/未决
│   ├── json-leak.json        # 负例：返回 JSON 原文
│   └── empty.json            # 空输出
└── mixed/
    └── resilience.json       # 单场混合：第2轮超时 → 第4轮坏JSON → 第5轮空 → 第6轮重复 → 正常收尾
```

单个 fixture 的结构（字段级约定）：

| 字段 | 说明 |
| --- | --- |
| `name` | 唯一名，日志与报告引用 |
| `kind` | `roster` / `decision` / `speech` / `consensus` / `summary` |
| `steps[]` | 按调用顺序消费；用尽后按 `onExhausted`（`loop`/`last`/`fail`） |
| `steps[].content` | 模型返回的文本（JSON 或自然语言） |
| `steps[].model` / `finishReason` / `usage` | 用于 AR-10 与成本断言 |
| `timing.firstTokenDelayMs` | 首 token 延迟 |
| `timing.interDeltaMs` | delta 间隔 |
| `timing.hang` | `true` 时永不返回（超时用例） |
| `repeat` | `{times: n}` 或 `{when: "turn>=3"}` 控制重复注入 |
| `expect` | 仅供人读的预期说明，引擎不消费 |

`roster/default.json` 的必需内容约束（QA 会写成校验脚本 `TC-FR-14-01` 的一部分）：

- 5 人（1 host + 4 expert），`color` 两两不同（共 5 个不同值）。
- host 的 `stance` 含"中立"语义；expert 的 `stance` 至少 3 种不同取向（支持/反对/折中）。
- 每人 `name`/`profession`/`title`/`focus` 非空，`sortOrder` 从 0 连续。

### 6.4 场景矩阵（场景 × 期望表现）

| 场景 | 注入什么 | 期望系统行为 | 验证用例 |
| --- | --- | --- | --- |
| `normal` | 理想 fixture | 8–12 轮 → 总结 → ended | E2E-01 |
| `slow` | 首字 3s、delta 800ms | 有流式感知（骨架→逐字），首字前有"准备中"状态，不白屏 | PERF-03、TC-FR-07-02 |
| `timeout` | 某轮 hang 30s | 该轮 20–30s 超时 → 重试 1 次 → 跳过 → toast 可读 → 后续轮继续 | TC-AR-09-01 |
| `invalid-json` | 决策/共识返截断 JSON | 修复重试 1 次 → 仍失败则兜底（跳过/安全文案） → 不中断整场 | TC-AR-09-02 |
| `empty` | 发言空串 | 重试 1 次 → 仍空则跳过，不产生空 transcript 条目 | TC-AR-09-03 |
| `duplicate` | 连续 3 条同内容 | 去重或换人；同专家连续 ≤2 | TC-AR-09-04 |
| `runaway` | 永远不给 summary | 14 轮硬上限 → 自动进入 summarizing | TC-FR-06-03 |
| `long` | 300 字发言 | 截断/重试到 ≤120 码点 | TC-AR-04-02 |
| `mixed` | 一场内 4 种故障 | 仍能走到 ended，且有效发言 ≥6 条 | TC-AR-09-05 |
| `roster-fail` | 阵容生成失败 | 502/504 + `details.discussionId`；首页出现 failed 卡片；可重试成功 | TC-FR-15-01、TC-FR-02-04 |

### 6.5 故障注入的三种形态

1. **数据形态故障**（坏 JSON、空、超长、重复、无依据）：改 fixture 内容即可，最稳定。
2. **时序故障**（慢、超时、半截流）：改 `timing`；超时用例必须把后端超时阈值通过环境变量压到 `QA_LLM_TIMEOUT_MS=2000`，否则每个超时用例要等 30s，测试时长不可接受。
3. **网络形态故障**（SSE 断线、跳号、重复推送）：这一层不通过 LLM，而通过测试辅助能力实现：
   - 断线：Playwright `context.setOffline(true)` 或 `page.route` 中断 `/stream` 请求。
   - 跳号：mock 模式下 `x-qa-sse-drop=<seq>` 让服务端跳过某条持久化事件的推送（仅测试）。
   - 重复推送：`x-qa-sse-dup=<seq>` 让服务端重复推一条（测前端按 id 去重）。

> 若 PM 不批准 `x-qa-sse-*` 钩子，跳号/重复用例降级为"前端单测喂构造事件序列"，E2E 只保留真实断线（offline）场景。

### 6.6 可重复性与"自证清白"

- 同一用例连跑 3 次，结论必须一致（`TC-NFR-07-02`）。
- E2E 启动自检：`llmMode==='mock'`、`DEEPSEEK_API_KEY` 未设置、`/health` 的 `dbReady===true`。
- **断网验证**：在 mock 模式下把网卡禁用（或 Playwright `context.setOffline(true)` 全程）跑 E2E-01，仍须全绿 → 证明零外呼。
- 真实模式只做 smoke，且必须能在报告中区分"mock 证据"与"real 证据"（不同目录归档）。

### 6.7 mock 的结论边界（必须写进报告）

| mock 能证明 | mock 不能证明 |
| --- | --- |
| 状态机、事件序、补发、幂等、落库 | 真实模型的 JSON 合法率 |
| 前端渲染与交互、断线恢复 | 真实首字延迟与轮次间隔分布 |
| 多会话隔离、并发安全 | 真实 token 成本 |
| 失败路径的兜底存在 | 兜底文案在真实错误下的自然度 |
| 上下文不含其他会话数据（通过调用记录） | 上下文是否"足够好"（质量） |

后四项由 AR-11 eval 报告 + 1 次 real smoke 覆盖，QA 只验收"报告存在且指标齐全"，不代替 AI 判断质量。

---

## 7. 需求追溯矩阵

> 说明：
> - 层级：`U` 单元 / `C` 组件 / `I` 接口 / `E` E2E / `N` 非功能 / `M` 人工走查。
> - 自动化：`自动` = 断言全自动；`半自动` = 自动执行 + 人工判定一次；`人工` = 只能走查。
> - 门禁：`必跑` = 进发版门禁；`回归` = 每次 PR；`抽查` = 按轮次抽检。
> - 每条 AC 至少 1 个用例；`交叉` 表示该 AC 由另一组用例覆盖，不重复计数。

### 7.1 功能需求 FR-01 ~ FR-17

| ID | 测试视角的验收标准 | 用例 | 层级 | 自动化 | 证据 | 门禁 |
| --- | --- | --- | --- | --- | --- | --- |
| FR-01 | 卡片含议题/状态/专家数/进度/更新时间/摘要；进行中→直播，已结束→回放；空态有创建入口；四态互斥 | TC-FR-01-01 卡片字段齐全且与 API 一致；TC-FR-01-02 状态分流跳转正确；TC-FR-01-03 空态仅有创建入口；TC-FR-01-04 列表排序（进行中优先，其次 updatedAt 倒序）；TC-FR-01-05 首页 error 态不白屏 | C/E/I | 自动 | DOM 断言 + 跳转后 URL 与 `stage-status` + API 快照 | 必跑 |
| FR-02 | topic 2–200 字（去空白）、expertCount 3–6 默认 4；重复提交被阻止；失败可重试 | TC-FR-02-01 边界值 1/2/199/200/201 与纯空白、纯空格；TC-FR-02-02 `expertCount` = 2/3/6/7/"4"/undefined；TC-FR-02-03 连点提交 5 次只产生 1 个 discussion；TC-FR-02-04 生成失败后从首页重试成功 | U/I/E | 自动 | 400/201 响应 + `discussions` 行数相比前置快照 +1 + 按钮 `data-disabled` | 必跑 |
| FR-03 | 1 主持 + N 专家；姓名/职业/Title/立场/颜色齐全；颜色唯一；姓名不重复；≥3 种立场 | TC-FR-03-01 `roster/default.json` 经 API 后字段齐全且 1+N；TC-FR-03-02 颜色唯一性（5 人 5 色）；TC-FR-03-03 姓名与立场去重后 ≥3；TC-FR-03-04 负例 `dup-color`/`dup-name`/`same-stance` 必须被拒或重试成功，不得原样落库 | U/I | 自动 | DB 查询 + API 响应断言 + 负例的 502/降级 | 必跑 |
| FR-04 | 可确认/重新生成；确认后 live；重复确认不重启；返回首页草稿仍在 | TC-FR-04-01 `confirm` 在 ready→202、live→200 幂等、ended→409；TC-FR-04-02 连发 3 次 confirm 后 `turn.started` 只出现 1 次 opening（DB 中 opening 消息 == 1）；TC-FR-04-03 生成后返回首页再进入，阵容与 topic 不丢；TC-FR-04-04 `regenerate` 仅 ready/failed 可用，替换后 discussionId 不变且 seq 递增 | I/E | 自动 | 事件序列 + DB 计数 + 页面回访断言 | 必跑 |
| FR-05 | 桌面四区（议题/专家/transcript/共识）；区域独立滚动；页面本身不滚动；三档合理 | TC-FR-05-01 1440×900 四区可见且互不重叠；TC-FR-05-02 1280×800 右栏收起为抽屉且可开；TC-FR-05-03 390×844 单栏 + 底部 Tab 可切换；TC-FR-05-04 每个 `[data-panel]` 的 `overflow-y ∈ {auto,scroll}` 且 `scrollHeight > clientHeight`（内容足够长时）；TC-FR-05-05 2560×1440 不出现拉伸变形与超长行宽 | E | 自动 | 视口截图 + `scrollWidth/scrollHeight` 计算 + 面板 `getComputedStyle` | 必跑 |
| FR-06 | 主持开场；专家自主决定顺序；无固定轮转；每人 1–2 句；8–12 轮收束；硬上限 14 | TC-FR-06-01 主链路 ≥8 且 ≤12 轮 `message.completed`；TC-FR-06-02 首条为 host 且 `intent=opening`；TC-FR-06-03 `runaway` 场景 14 轮后自动 summarizing（不得 >14）；TC-FR-06-04 speaker 序列不满足"按 sortOrder 循环"判定 | I/E/U | 自动 | `/events` 序列分析 + DB `turn_count` | 必跑 |
| FR-07 | 每位专家显示 idle/preparing/speaking；显示关注点/公开摘要；不显示隐藏 CoT | TC-FR-07-01 三个状态都能被观测到（至少各 1 次）；TC-FR-07-02 `turn.started` 后 1s 内该专家 `data-status=speaking`，`message.completed` 后回到 idle/preparing；TC-FR-07-03 状态区文本不含 `reasoning`/`thinking`/`CoT` 字样，且 `data-focus` 来自 `turn.started.focus` | C/E | 自动 | DOM 状态序列采样（100ms 轮询）+ 文本黑名单 | 必跑 |
| FR-08 | 姓名+职业/Title+专属色块；按时间序；不显示"举手"等内部事件；自动滚动，上滚暂停并出现"跳到最新" | TC-FR-08-01 每条 transcript 含姓名与 title 文本、色块 `background-color` 等于该专家 `color`；TC-FR-08-02 transcript 条目数 == `message.completed` 数，且不含 `turn.started`/`intent`/`focus` 文本；TC-FR-08-03 新消息到达自动滚到底；上滚 200px 后自动滚动停止且 `jump-to-latest` 可见，点击后回到底部；TC-FR-08-04 `turnIndex` 严格递增无重复 | E | 自动 | DOM 提取 + `scrollTop` 采样 + 颜色值比较 | 必跑 |
| FR-09 | 三区（共识/分歧/待验证）；讨论中增量更新；每条有依据数/引用；不重复堆叠；不编造一致 | TC-FR-09-01 收到 `insight.updated` 后三区内容与 payload 完全一致（全量替换，无残留旧条目）；TC-FR-09-02 从 `message.completed` 到对应 insight 出现在 DOM ≤2s；TC-FR-09-03 每条 insight 的 `evidenceMessageIds` 非空且每个 id 都能在本会话 messages 中找到；TC-FR-09-04 `dup-stack` 场景下同类同义结论条目 ≤2（相似度 <0.9 才算不同）；TC-FR-09-05 `empty` 场景显示"暂无共识"空态而非空白区 | I/E/U | 自动 | DOM vs SSE payload 比对 + DB `insight_evidence` 查询 | 必跑 |
| FR-10 | 结束时自然语言总结共识/分歧/未决；不显示 JSON；持久化后首页/回放可见 | TC-FR-10-01 summary 文本长度 >20 且覆盖三类关键字（共识/分歧/未决 或同义）；TC-FR-10-02 summary 文本通过 `assertNoJsonLeak`；TC-FR-10-03 ended 后首页卡片 `summaryPreview` 非空且 ≤80 字；回放页 `summary-content` 与直播结束时文本逐字相同 | E/I | 自动 | DOM 文本 + API 详情 + 首屏卡片断言 | 必跑 |
| FR-11 | 播放/暂停/1x/1.5x/2x/跳转；刷新/重启后仍可回放；回放不调 LLM；直播与回放一致 | TC-FR-11-01 暂停后 transcript 条目数 5s 内不变，继续后增多；TC-FR-11-02 2x 下 10s 内推进量 ≈ 1x 的 1.8–2.2 倍；TC-FR-11-03 跳转到 50% 后条目集合 == 事件序列前 N 条；TC-FR-11-04 回放全程 mock LLM 调用记录新增 0 行；TC-FR-11-05 一致性见 E2E-05 | E/I | 自动 | 条目计数采样 + 调用日志行数 + 状态深度比较 | 必跑 |
| FR-12 | 同时运行 ≥2 讨论；事件流/transcript/共识/结论互不串线；首页状态独立更新 | TC-FR-12-01 两会话的 messageId 集合交集为空；TC-FR-12-02 各自 SSE 帧 `discussionId` 100% 匹配；TC-FR-12-03 两会话 insight id 与 evidence 不交叉；TC-FR-12-04 结束 A 后 B 仍 live 且继续收到新消息；TC-FR-12-05 A 的 mock 调用记录不含 B 的 messageId/topic 片段 | E/I | 自动 | 见 §9.1 断言矩阵 | 必跑 |
| FR-13 | 可主动结束；结束后 summarizing/ended；离开不取消后台；结束后不可发言 | TC-FR-13-01 连发 3 次 `/end`：summaries 表 1 行、`summary.completed` 1 条、`discussion.ended` 1 条；TC-FR-13-02 ended 后等 10s，`lastSeq` 不变且无新 `message.completed`；TC-FR-13-03 直播页返回首页 15s 后 turnCount 继续增长；TC-FR-13-04 ended 后 `confirm`/`regenerate` 均 409 | I/E | 自动 | DB 计数 + lastSeq 采样 + 409 断言 | 必跑 |
| FR-14 | 初始化脚本 + ≥5 条样例；≥1 条含完整 transcript/共识/总结可直接回放 | TC-FR-14-01 seed 后 `SELECT` 校验：5 条、状态覆盖 ended/live/ready/failed、每场 1 host + N expert、颜色唯一；TC-FR-14-02 首页 5 张卡片可见且逐张可进入无报错；TC-FR-14-03 样例 1 回放：≥8 条消息、≥2 条 insight、summary 非空、无网络错误 | I/E | 自动 | DB 校验脚本输出 + 首页截图 + 回放断言 | 必跑 |
| FR-15 | 生成失败/超时/SSE 断线/空列表/无共识均有可读状态；不显示堆栈/JSON；SSE 自动重连 | TC-FR-15-01 `roster-fail` 后页面显示可读失败文案 + 重试按钮，DOM 无堆栈；TC-FR-15-02 生成超时（超时阈值压到 2s）显示超时文案；TC-FR-15-03 断网 3s 恢复后 `data-conn-state` 回到 live 且消息补齐；TC-FR-15-04 空库首页显示空态与创建入口；TC-FR-15-05 无共识时三区均为空态文案；TC-FR-15-06 访问不存在 id 显示"讨论不存在"并给返回入口，不白屏 | E/I | 自动 | 文案断言 + `assertNoSecrets` | 必跑 |
| FR-16 | Key 只在服务端环境变量；bundle/网络响应/日志均无 Key | 交叉 §11：SEC-01~04 | N | 自动 | 见 §11 | 必跑 |
| FR-17 | Windows 下按 README 完成安装/迁移/种子/启动；提供 `.env.example` | TC-FR-17-01 在干净目录按 README 逐条执行（`pnpm install` → `db:migrate` → `db:seed` → `dev`），health 200 且首页可用；`.env.example` 存在且不含真实 Key | M/E | 半自动 | 命令回放日志 + 截图 + 逐条打勾 | 必跑 |

### 7.2 AI 行为需求 AR-01 ~ AR-11

| ID | 测试视角的验收标准 | 用例 | 层级 | 自动化 | 证据 | 门禁 |
| --- | --- | --- | --- | --- | --- | --- |
| AR-01 | 职业/立场/关注点互补；主持中立；不出现 4 个同质专家 | TC-AR-01-01 5 个议题 × 3 次生成：`name`/`profession` 组内唯一，`stance` 相似度两两 <0.9，`role=host` 的 stance 含中立语义；TC-AR-01-02 至少 3 种立场取向（支持/反对/折中/条件性）可被关键词规则识别；TC-AR-01-03 人工抽查 3 场阵容，判断"互补"（半自动，记录判定理由） | U/I/M | 半自动 | 生成结果表 + 人工判定表 | 必跑 |
| AR-02 | 开场点题；≥1 次追问；≥1 次串联不同专家；结尾总结；不长期霸占 | TC-AR-02-01 首条 `intent=opening`、最后一条发言为 host 且 `intent=summary`；TC-AR-02-02 host 发言占比 ≤40% 且 ≥2 次；TC-AR-02-03 `intent=probe` ≥1 次；TC-AR-02-04 串联判定（**当前不可自动验证**，见 §14.1-1）：临时用"host 发言中引用 ≥2 位不同专家姓名"作代理断言，记为半自动 | I/M | 半自动 | 事件序列分析 + 人工抽查 | 必跑 |
| AR-03 | 基于当前 transcript 决定；intent 合法；禁止固定轮转；同一专家连续 ≤2 | TC-AR-03-01 全序列中同一 speaker 连续出现次数 ≤2；TC-AR-03-02 序列不等于按 `sortOrder` 循环（长度 ≥6 的窗口内至少 2 次打破顺序）；TC-AR-03-03 所有 `intent` ∈ 枚举；TC-AR-03-04 `round-robin` 负例与 `same-speaker-x3` 负例必须被服务端拒绝或纠正，不得原样透传到 transcript | U/I | 自动 | 事件序列静态分析 | 必跑 |
| AR-04 | 每次 1–2 句；单条 ≤120 中文字符；不写小作文 | TC-AR-04-01 所有消息按 Unicode 码点计 ≤120；TC-AR-04-02 `long` 场景（300 字）被截断或重试后达标，transcript 无超长条目；TC-AR-04-03 句数启发式（按 `。！？` 切分）≤2 的比例 ≥90% | U/I | 自动 | 长度统计报告 | 必跑 |
| AR-05 | 用最新 transcript 窗口 + 结构化摘要 + 当前共识；只读本会话；不跨会话 | TC-AR-05-01 上下文组装单测：窗口条数 ≤N、token 估算 ≤预算、包含当前共识快照；TC-AR-05-02 跨会话负例：构造 A/B 两会话后，A 的每次 mock 调用记录中不得出现 B 的任何 messageId/topic 片段；TC-AR-05-03 长会话（14 轮）下窗口仍受控，不整场塞入 | U/I | 自动 | mock 调用记录 JSONL（只记 id 与摘要，不记全文） | 必跑 |
| AR-06 | 只暴露状态/关注点/意图等公开字段；不展示 `reasoning_content`/隐藏 CoT | 交叉 TC-FR-07-03 + SEC-11 | E/N | 自动 | 网络与 DOM 黑名单扫描 | 必跑 |
| AR-07 | 每条共识/分歧至少 1 条发言依据；无依据进"待验证"；不编造 | TC-AR-07-01 所有 consensus/divergence 的 `evidenceMessageIds.length ≥1` 且全部存在于本会话；TC-AR-07-02 `unsupported` 负例：无依据的 consensus 必须被降级为 `open_question` 或丢弃，不得进入共识区；TC-AR-07-03 人工抽查 20 条洞察判断"依据是否支撑结论"，记录支持率 | I/M | 半自动 | DB 联合查询 + 抽查表 | 必跑 |
| AR-08 | 自然语言；覆盖共识/分歧/未决；不出现 JSON 字段名/原始结构 | TC-AR-08-01 见 TC-FR-10-01/02；TC-AR-08-02 `summary/json-leak.json` 场景：即使模型返回 JSON 原文，页面也不得原样展示（前端/后端兜底为可读文案或提示生成失败） | U/E | 自动 | DOM 文本 + 黑名单 | 必跑 |
| AR-09 | 超时/无效 JSON/空输出有兜底：重试一次、跳过或安全文案；不卡死、不白屏 | TC-AR-09-01 超时；TC-AR-09-02 无效 JSON；TC-AR-09-03 空输出；TC-AR-09-04 重复输出；TC-AR-09-05 `mixed` 场景整场韧性（仍能 ended 且有效发言 ≥6 条）。统一附加断言：会话 60s 内不处于 live 且无新事件；页面始终有可见状态文案 | I/E | 自动 | mock 调用次数 + 事件序列 + 页面截图 | 必跑 |
| AR-10 | 实时链路默认 `deepseek-flash` 且关闭 thinking；模型可配置；单场 <¥1 | TC-AR-10-01 mock 调用记录中 `model==deepseek-flash` 且 thinking 关闭参数存在；TC-AR-10-02 改 `DEEPSEEK_MODEL` 后请求体 model 随之变化（不硬编码）；TC-AR-10-03 单场 token 统计换算成本 <¥1（用 usage 字段，按 01-技术选型 §6.3 单价） | U/I | 自动 | 调用记录 + 成本计算表 | 必跑 |
| AR-11 | ≥5 议题离线 eval；记录 JSON 合法率/长度/分布/重复率/依据/延迟/成本 | TC-AR-11-01 验收 `docs/AGENT-EVAL-REPORT.md` 存在且 7 项指标齐全、议题 ≥5 个；TC-AR-11-02 报告中"共识依据支持率"有可复查样本。**QA 只验收报告与指标，不判定 prompt 好坏** | M | 人工 | eval 报告 + 抽样核对 | 必跑 |

### 7.3 非功能需求 NFR-01 ~ NFR-11

| ID | 测试视角的验收标准 | 用例 | 层级 | 自动化 | 证据 | 门禁 |
| --- | --- | --- | --- | --- | --- | --- |
| NFR-01 | 首页 <1.5s；阵容 p95 <12s；首 token p95 <5s；轮间 p95 <8s | PERF-01 首页 LCP（本地 prod 构建）<1.5s；PERF-02 mock 下创建→ready p95 <12s（含 mock 延迟 1s）；PERF-03 首条 `message.delta` 到达时间 p95 <5s；PERF-04 相邻 `message.completed` 间隔 p95 <8s。**mock 只证明管道开销，真实延迟由 real smoke 日志补充** | N | 自动 | Playwright trace + 服务端耗时日志 | 必跑 |
| NFR-02 | SSE 推送；共识 2s 内更新；断线 3s 内重连并补发 | TC-NFR-02-01 见 TC-FR-09-02；TC-NFR-02-02 断网恢复后 3s 内 `data-conn-state=live`，且缺失消息在 5s 内补齐 | E | 自动 | 时间戳采样 + 帧缓冲 | 必跑 |
| NFR-03 | mock 下 5 会话/20 SSE；无串流串数据；p95 事件延迟 <500ms | PERF-05（见 §10） | N | 自动 | 压测脚本报告 JSON + 串线检测统计 | 必跑 |
| NFR-04 | SQLite WAL；事件/消息/洞察/总结落库；进程重启后可恢复 | TC-NFR-04-01 `PRAGMA journal_mode` == `wal`、`busy_timeout` ≥5000、`foreign_keys` == 1；TC-NFR-04-02 kill 进程重启后：ended 会话可回放且内容一致；live 会话变为可读的失败/中断态，不自动重跑 LLM；TC-NFR-04-03 事件表 `(discussion_id, seq)` 无重复；messages 条数 == `message.completed` 条数 | I/N | 自动 | DB 查询 + 重启前后 API 对比 | 必跑 |
| NFR-05 | ≥1440/1024–1439/768–1023/<768 四档；独立滚动；页面不整体滚动 | 交叉 TC-FR-05-01~05 + VIS-01~06 | E | 自动 | 截图 + 尺寸计算 | 必跑 |
| NFR-06 | Key 仅服务端；输入长度限制；XSS 转义；日志脱敏；不展示 JSON/CoT/堆栈 | 交叉 §11 SEC-01~11 | N | 自动 | 扫描报告 | 必跑 |
| NFR-07 | mock 可切换；核心逻辑可单测；E2E 不依赖真实模型；可重复 | TC-NFR-07-01 `/health.llmMode` 在两种模式下正确且拼错即启动失败；TC-NFR-07-02 E2E-01 连跑 3 次结论一致；TC-NFR-07-03 无 `DEEPSEEK_API_KEY` + 全程 offline 下 E2E-01 仍通过 | N | 自动 | 三次报告 diff + 启动失败日志 | 必跑 |
| NFR-08 | 单场 <¥1；开发期总成本远低于 ¥10 | PERF-06 按 mock usage 估算单场成本并记录；real 模式记录实际调用次数与 token；汇总表对照 ¥1/¥10 阈值 | N | 自动 | 成本表 | 必跑 |
| NFR-09 | 结构化日志；request/session ID；关键阶段耗时；不记 Key 与敏感 prompt | TC-NFR-09-01 每条日志含 `reqId`、`discussionId`（如适用）、`phase`、`durationMs`；TC-NFR-09-02 日志扫描无 Key/Authorization/完整 prompt；TC-NFR-09-03 前端错误与后端日志能通过 `reqId` 关联（抽查 1 次） | I/N | 自动 | 日志样本 + 关联追踪记录 | 必跑 |
| NFR-10 | Windows 下 Node 脚本；一条命令启动；README 含环境变量/迁移/种子/测试 | 交叉 TC-FR-17-01 | M | 半自动 | README 走查记录 | 必跑 |
| NFR-11 | 键盘可操作；对比度达标；reduced motion 降级；颜色非唯一载体 | 交叉 §12 A11Y-01~08 | N | 自动 + 半自动 | axe 报告 + 截图 + 走查表 | 必跑 |

### 7.4 覆盖统计

| 类别 | 条数 | 独立用例数 | 自动化 | 半自动 | 人工 | P0 覆盖 |
| --- | --- | --- | --- | --- | --- | --- |
| FR-01~17 | 17 | 65 | 64 | 1 | 0 | 17/17 |
| AR-01~11 | 11 | 35 | 30 | 3 | 2 | 11/11 |
| NFR-01~11（专有用例） | 11 | 17 | 17 | 0 | 0 | 11/11 |
| 非功能专项（SEC 11 / PERF 锁 3 / VIS 6 / A11Y 8） | — | 28 | 26 | 2 | 0 | — |
| **合计** | **39** | **145** | **137** | **6** | **2** | **39/39** |

门禁子集（发版前必须全绿，约 45 条）：

```text
E2E-01 主链路
E2E-02 并行隔离
E2E-03 SSE 断线重连
E2E-05 回放一致性
E2E-06 刷新/重启恢复
E2E-07 结束幂等
TC-FR-02-01/03, TC-FR-03-01/02, TC-FR-04-01/02, TC-FR-06-01/03,
TC-FR-08-02, TC-FR-09-01/03, TC-FR-10-02, TC-FR-12-01/02/04,
TC-FR-13-01/02/04, TC-FR-14-01/02/03, TC-FR-15-01/03
TC-AR-03-01/02, TC-AR-04-01, TC-AR-07-01/02, TC-AR-09-01~05, TC-AR-10-01
TC-NFR-04-01/02/03, TC-NFR-07-03, TC-NFR-09-02
PERF-05, SEC-01~04, VIS-01/03/04, A11Y-01/02/04
```

> 除门禁子集外，其余用例进每日回归；不稳定用例（flaky）连续 2 次不稳定即降级并开缺陷，不得静默重试掩盖。

---

## 8. 主链路 E2E（E2E-01）

**目标**：用一条用例证明"用户能独立完成从议题到回放的完整旅程"，并且每一步都有可断言的可观测结果。

**前置**：`LLM_MODE=mock`、`QA_SCENARIO=normal`、`QA_DETERMINISTIC=1`、空库 + seed、视口 1440×900、Chromium、**全程 `context.setOffline(false)` 但进程无 Key 无外网出口**。

| 步 | 操作 | 可执行断言 | 证据 |
| --- | --- | --- | --- |
| 1 | 打开 `/` | `home-list` 可见；卡片数 == seed 的讨论数；`home-empty` 不存在 | 截图 `01-home.png` |
| 2 | 点"发起新讨论" | 路由到创建页，`create-topic` 可聚焦 | 截图 |
| 3 | 输入议题 `AI 会不会让初级开发者失业？`，人数选 4，提交 | 请求 `POST /api/discussions` 返回 201；`roster-panel` 出现；`roster-member` 数 == 5 | 响应体快照 |
| 4 | 校验阵容 | 5 人 `data-role` 中 host 恰 1；每人 `name/profession/title/stance` 文本非空；`data-color` 5 个不同值；至少 3 种立场 | 阵容 DOM 提取 JSON |
| 5 | 点"确认阵容" | `POST /confirm` 202；`stage-status` 在 3s 内变 `live`；`discussion.started` 事件存在 | 截图 `02-stage.png` |
| 6 | 等待至少 8 轮 | `transcript-item` 数 ≥8 且 ≤12；`turnIndex` 1..N 连续递增；所有消息码点 ≤120；首条 `data-speaker-id` == host | 事件序列 JSON |
| 7 | 校验主持行为 | 存在 `data-intent=opening` 1 条；host 消息 ≥2 条且占比 ≤40%；`data-intent=probe` ≥1 条 | 同上 |
| 8 | 校验非轮转 | 长度 ≥6 的窗口内，speaker 序列至少 2 次打破 sortOrder 顺序；无同一 speaker 连续 >2 | 同上 |
| 9 | 校验共识/分歧 | 讨论中出现过 ≥1 次 `insight.updated`；结束时 `insight-item` ≥2 条；每条 `data-evidence-count` ≥1；不可有 evidence 指向不存在消息 | DOM + DB |
| 10 | 校验专家状态 | 采样期间 `expert-card` 至少各出现 1 次 `speaking`，且结束时全部回到 `idle`/`preparing` | 100ms 采样日志 |
| 11 | 校验 transcript 干净 | `transcript-list` 内不含"举手/抢答/turn.started/intent/focus"等内部字样；条目数 == `message.completed` 数 | DOM 文本扫描 |
| 12 | 点"结束讨论" | `POST /end` 202；`stage-status` 变 `summarizing` 再 `ended`（≤30s）；`summary-content` 非空且通过 `assertNoJsonLeak` | 截图 `03-summary.png` |
| 13 | 校验结束态只读 | 等 10s：`transcript-item` 数不变、`lastSeq` 不变；"结束讨论"按钮不可用或幂等 | API 采样 |
| 14 | 进入回放 | `replay-controls` 可见；点播放，条目数增加；点暂停，5s 内不再增加 | 截图 `04-replay.png` |
| 15 | 切 2x | 相同 10s 内推进量约为 1x 的 1.8–2.2 倍 | 条目计数 |
| 16 | 跳转到 50% | 显示的条目集合 == 事件序列前 N 条（N 由进度换算） | 状态对比 |
| 17 | 校验回放一致性 | `normalizeLiveState(live终态)` 与 `normalizeLiveState(回放末尾)` 深度相等（见 §9.4） | 差异报告（空即通过） |
| 18 | 校验回放不调 LLM | mock 调用记录行数在回放期间增量为 0 | JSONL 行数差 |
| 19 | 返回首页 | 该讨论卡片 `data-status=ended`、`disc-card-summary` 非空且 ≤80 字 | 截图 `05-home-after.png` |
| 20 | 全局安全断言 | 整个过程的响应体、SSE 帧、DOM、日志均通过 `assertNoSecrets` | 扫描报告 |

**失败判定**：任一步断言失败 → 该步记缺陷，用例整体失败；步骤 3/5/12/17 失败直接判 P0（主链路断）。

---

## 9. 关键场景用例

### 9.1 E2E-02 两个讨论并行，事件/transcript/共识不串线

**构造**：Playwright 两个 `context`（等价两个标签页），A 用 `x-qa-scenario=normal`，B 用 `x-qa-scenario=slow`（制造时序差），两场议题不同（B 的议题含独特词 `量子计算`，A 含 `初级开发者`）。

**断言矩阵**（每条都是硬断言）：

| # | 断言 | 取法 |
| --- | --- | --- |
| 1 | A 页面 `transcript-item` 的 `data-message-id` 集合 ∩ B 集合 == ∅ | DOM 提取 |
| 2 | A 的每条消息 `data-speaker-id` 属于 A 的专家集合 | DOM + API 详情 |
| 3 | A 的 SSE 帧 `discussionId` 100% == A.id（B 同理），抽样全量 | 页面内帧缓冲 |
| 4 | A 的 `seq` 单调递增，B 的 `seq` 单调递增；两者可以交错但各自无重号 | 帧缓冲 |
| 5 | A 的 transcript 文本不含 B 议题独有词，反之亦然 | 文本扫描 |
| 6 | A 的 `insight-id` 与 B 无交集；A 的 `evidence` 全在 A 内 | DB 查询 |
| 7 | 首页两个卡片 `data-turn-count` 各自独立增长（±2 轮内） | 轮询首页 API |
| 8 | 结束 A 后，B 在 10s 内仍新增 ≥1 条消息 | 事件轮询 |
| 9 | 重生成 A 阵容后，B 的专家列表与颜色不变 | API 详情对比 |
| 10 | A 的每次 mock 调用记录中不含 B 的 `messageId`/`topic` 片段 | mock JSONL |

**补充**：再做一次"两个标签页打开同一讨论"的用例，断言两边都只读、都能收到同一条消息（id 相同），不产生重复写入（DB 中该 messageId 只有 1 行）。

### 9.2 E2E-03 SSE 断线重连 / 补发 / 去重

| 用例 | 步骤 | 断言 |
| --- | --- | --- |
| TC-SSE-01 正常重连 | 直播中 `context.setOffline(true)` 3s → 恢复 | 恢复后 3s 内 `data-conn-state` 回到 `live`；期间产生的 `message.completed` 全部补齐（与 `/events` 对比无缺） |
| TC-SSE-02 补发去重 | 同上 | 每个 `messageId` 在 DOM 中只出现 1 次；帧缓冲中 `seq` 无重复值 |
| TC-SSE-03 Last-Event-ID | 抓重连请求头 | `Last-Event-ID` == 断线前最后收到的 `seq` |
| TC-SSE-04 after 与 LEI 取 max | 手工请求 `?after=5` 且头 `Last-Event-ID: 9` | 服务端首条补发事件的 `seq` == 10 |
| TC-SSE-05 跳号自愈 | `x-qa-sse-drop=7` 丢弃一条 | 前端发现跳号后触发 `GET /events?after=`，最终 DOM 无缺口；日志有补齐记录 |
| TC-SSE-06 重复推送 | `x-qa-sse-dup=12` 重复推一条 | DOM 无重复条目；`seq` 去重生效 |
| TC-SSE-07 心跳保活 | 静默 20s（mock 让其挂起） | 连接不断（无 `reconnecting`），随后事件仍能到达 |
| TC-SSE-08 已结束会话 | 对 ended 会话连 `/stream` | 补发到 `discussion.ended` 后服务端关闭；前端不无限重连 |
| TC-SSE-09 不存在的会话 | 请求 `/stream` 于随机 UUID | 404，不建立 SSE；页面显示可读错误 + 返回入口 |
| TC-SSE-10 重复挂载 | 路由在直播页与首页来回切 3 次 | 服务端同时活跃 SSE 连接 ≤1；无连接泄漏（连接计数归零） |
| TC-SSE-11 补发量上限 | 构造 >500 条历史事件后重连 | 补发完整（或分段），无重复无缺口；若超时则失败 |
| TC-SSE-12 结束后不再推送 | ended 后保持连接 | 不再有 `message.completed`/`insight.updated`；`lastSeq` 恒定 |

**失败判定**：TC-SSE-01/02/05 任一失败 → P0（断线是最可能毁掉体验的缺陷）。

### 9.3 E2E-04 LLM 失败族（超时 / 无效 JSON / 空输出 / 重复输出 / 失控）

统一前置：`QA_LLM_TIMEOUT_MS=2000`（把超时压短，避免等 30s）。

| 用例 | 注入 | 断言 |
| --- | --- | --- |
| TC-AR-09-01 超时 | 第 2 轮 speech hang | ≤5s（2×超时 + 1s 余量）出现可恢复 toast/文案；mock 调用次数 +2（原始 + 1 次重试）；第 3 轮及以后正常产生消息；会话不卡 live |
| TC-AR-09-02 无效 JSON | 第 2 轮 decision 返截断 JSON | 调用 +2；该轮被跳过或使用兜底 speaker；`turn.started` 不出现非法 intent；页面无白屏、无错误堆栈 |
| TC-AR-09-03 空输出 | 第 3 轮 speech 返 `""` 与 `"   "` | 调用 +2；transcript 不出现空条目；`char_count` 不出现 0 的落库行 |
| TC-AR-09-04 重复输出 | 连续 3 条同内容 | 同一 speaker 连续 ≤2；完全相同 content 去重后 ≤1 条进入 transcript；若不满足记 P1 |
| TC-AR-09-05 混合韧性 | `mixed` 场景一整场 | 60s 内走到 `ended`；有效 `message.completed` ≥6；summary 存在；全程无未捕获异常日志 |
| TC-AR-09-06 连续不可恢复 | 全部调用 hang | 进入可读失败态（failed 或 ended + 模板总结）；**不得永久 live**；页面提供重试/返回 |
| TC-AR-09-07 阵容生成失败 | `roster-fail` | 502 + `error.details.discussionId`；首页出现 failed 卡片；点重试后 success |
| TC-AR-09-08 总结失败 | summary hang | `summarizing` 不超时卡死；兜底模板总结 + `ended`；页面有可读说明 |

**关键判定**：`TC-AR-09-06` 是"任何 LLM 失败都不能让会话永久卡在 live"（PRD §10.4）的唯一自动化证据，必须进必跑。

### 9.4 E2E-05 回放与直播一致性（怎么自动验证）

**方案：双路交叉验证 + 像素辅助。**

```
直播终态 ──DOM 规范化──► S_live  ┐
                                 ├─► deepEqual(S_live, S_replay) ? 通过
GET /events(全量) ─reducer重放─► S_evt  ┤
                                 └─► deepEqual(S_evt, S_live/S_replay) ? 通过
回放末尾 ──DOM 规范化──► S_replay ┘
```

- `S` 的结构（规范化后）：`{ status, turnCount, lastSeq, messages: [{id, seq, speakerId, intent, turnIndex, content, color}], insights: {consensus: ids, divergence: ids, open_question: ids}, evidence: {insightId: [messageId]}, summary: text }`。
- 规范化规则：排序按 `turnIndex`（同值按 `seq`）；文本去首尾空白、折叠连续空白；颜色统一小写；时间字段不参与比较（时间戳不作为一致性判据，避免时钟抖动误报）。
- `S_evt` 用 `packages/shared` 的 reducer 在 Node 侧重放——这正是 ADR-03 主张的"共用 reducer"，测试用它作为**第三视角**（DOM 侧与 API 侧各自独立走到同一结果）。
- 像素辅助 `VIS-DIFF-01`：直播结束最后一帧截图 vs 回放拖到末尾截图，允许 diff ≤0.5%（动效/光标导致），仅作辅助证据，不作为门禁（P2）。

**必须覆盖的边界**（这些是最容易不一致的地方）：

| 边界 | 用例 | 断言 |
| --- | --- | --- |
| 重生成阵容后再开始 | TC-RP-01 | 回放只显示最终阵容，不出现在旧的 5 人 + 新的 5 人叠影 |
| 结束时有正在流式的消息 | TC-RP-02 | 回放中该消息要么完整、要么不存在，**不得半条**；且事件序中 `message.completed` 在 `summary.completed` 之前 |
| `insight.updated` 全量替换 | TC-RP-03 | 回放中不会出现"已被删除的旧共识"残留（S_replay 的 insights 等于最后一次快照） |
| 补发/重连发生过 | TC-RP-04 | 一致性不受断线影响（断线过的会话仍通过一致性） |
| 空共识/无洞察 | TC-RP-05 | 回放空态与直播空态文案一致 |
| 刷新后回放 | TC-RP-06 | 见 §9.5 |

### 9.5 E2E-06 刷新 / 重启后的状态恢复

| 用例 | 步骤 | 断言 |
| --- | --- | --- |
| TC-RC-01 直播中刷新 | 第 4 轮时 `page.reload()` | 3s 内重新渲染已有历史（条目数 ≥ 刷新前）；`stage-status=live`；后续消息继续到达；无重复条目；`data-conn-state` 经历 connecting→live |
| TC-RC-02 summarizing 中刷新 | 点结束后立即刷新 | 显示"正在总结"可读状态（不空白、不报错）；最终仍到达 ended |
| TC-RC-03 回放中刷新 | 回放到 50% 刷新 | 允许回到 0 位置，但内容完整（用 S_evt 对比）；不调用 LLM |
| TC-RC-04 服务重启后 ended 可回放 | kill server → 重启 → 回放 seed 样例 | 内容与重启前逐字一致；`/events` 全量可取 |
| TC-RC-05 服务重启后 live 会话 | 直播中 kill server → 重启 | 会话变为可读的失败/中断态（PRD/契约待定，见 §14.3-5）；页面不白屏；**mock 调用记录不增加**（证明不自动重跑） |
| TC-RC-06 浏览器后退/前进 | 直播页 → 首页 → 前进 | 不产生重复 SSE 连接；状态与 API 一致 |
| TC-RC-07 多标签同会话刷新 | 两个标签页都刷新 | 两边内容一致；DB 中消息无重复行 |

### 9.6 E2E-07 结束幂等与终态只读

| 用例 | 步骤 | 断言 |
| --- | --- | --- |
| TC-EN-01 三连结束 | 1s 内连发 3 次 `POST /end` | 首次 202/200，其余同一 code（需契约固定，见 §14.2-H）；summaries 表 1 行；`summary.completed` 1 条；`discussion.ended` 1 条；总结 mock 调用 1 次 |
| TC-EN-02 结束后静默 | ended 后等 10s | `lastSeq` 不变；SSE 无新业务事件；无 `message.delta` 残留 |
| TC-EN-03 结束后禁写 | 依次调 `confirm`/`regenerate`/`end` | 分别 409/409/200（幂等）；DB 无新增 message/insight |
| TC-EN-04 结束后连接 | 新开 `/stream` | 补发到 ended 后关闭；前端显示 ended 态并给"回放/返回首页" |
| TC-EN-05 结束与流式竞态 | 在 `message.delta` 到达中途点结束 | 最终该消息有完整 `message.completed` 或完全不存在；`summary.completed` 在其后；页面无"半条消息"（DOM 中该 messageId 的 content 长度 == DB 中 content 长度） |
| TC-EN-06 结束接口错误态 | 对 ready 状态调 `/end` | 409 + 可读 message；页面提示而不崩溃 |

### 9.7 E2E-08 三档响应式与区域独立滚动

详细见 §12.2（VIS）。核心三条硬断言：

1. `document.scrollingElement.scrollHeight - clientHeight ≤ 1`（页面不整体滚动）—— 三档视口各测一次，并在 transcript 撑满后复测。
2. 每个 `[data-panel]` 的 `getComputedStyle().overflowY ∈ {auto, scroll}`，且在内容溢出时 `scrollHeight > clientHeight`。
3. 滚动 transcript 面板时，`window.scrollY` 始终为 0（滚动没有冒泡到页面）。

### 9.8 首页样例与空态（E2E-09）

| 用例 | 断言 |
| --- | --- |
| TC-FR-14-02 | 5 张卡片全部可见；逐张点击后：ended → 回放页、live → 直播页、ready → 确认页、failed → 失败态；无一张 404 或白屏 |
| TC-FR-15-04 | 清空库后首页显示空态文案 + 唯一创建入口；不显示"0 条讨论"这类冷文案 |
| TC-FR-01-04 | 列表顺序：live 在前、ended 按 `updatedAt` 倒序；断言顺序数组 |

### 9.9 关键场景与用例映射一览

| 场景（题目要求） | 用例组 |
| --- | --- |
| 两个讨论并行不串线 | E2E-02 / TC-FR-12-01~05 |
| SSE 断线重连/补发/去重 | E2E-03 / TC-SSE-01~12 |
| LLM 超时/无效 JSON/空输出/重复输出 | E2E-04 / TC-AR-09-01~08 |
| 回放与直播一致 | E2E-05 / TC-RP-01~06 |
| 刷新后直播/回放恢复 | E2E-06 / TC-RC-01~07 |
| 结束幂等、结束后不能发言 | E2E-07 / TC-EN-01~06 |
| 三档响应式、区域独立滚动 | E2E-08 / VIS-01~06 |
| Key 不在 bundle/网络/日志 | §11 SEC-01~04 |

---

## 10. 压力与性能测试

### 10.1 脚本选型（明确"什么工具测什么"）

| 工具 | 用来测 | 为什么不用它测别的 |
| --- | --- | --- |
| **autocannon** | REST 吞吐与延迟：`GET /api/discussions`、`GET /api/discussions/:id`、`GET /api/discussions/:id/events` | autocannon 把长连接当超时处理，**不适合 SSE**；且它会掩盖事件到达顺序，测不出串流 |
| **自研 Node SSE 压测脚本**（`e2e/perf/sse-load.mjs`，只用 `node:http`） | 20 条 SSE 长连接、事件延迟分布、`discussionId` 串线检测、seq 连续性 | 这是唯一能逐帧记录到达时间与归属的可靠方式 |
| **Playwright 多 context** | 5 个会话的 UI 级并行（渲染不串、内存不爆、页面可交互） | 不是吞吐工具；只做"5 个真实页面同时活着"的验证 |
| **Playwright + CDP** | 前端渲染性能（LCP、长任务、内存） | 不测服务端 |
| **SQL 只读查询 + 日志扫描** | DB 锁、seq 唯一性、投影一致性 | 不能替代延迟测量 |

> 结论：**压测的主体是自研 SSE 脚本，autocannon 只做 REST 基线，Playwright 只做 UI 并行**。三者结论分别归档，不混为一谈。

### 10.2 PERF-05 主压测（对应 NFR-03）

**拓扑**：

```text
1 个 server 进程（LLM_MODE=mock，QA_DELTA_INTERVAL_MS=50）
├── 5 个 discussion 同时 live（各自 8–12 轮，mock 定时推进）
├── 20 条 SSE 连接（每 discussion 4 条，模拟多标签观察）
├── 1 个首页轮询器（GET /api/discussions 每 2s）
└── 1 个采样器（每 5s 读 RSS / 活跃连接数 / lastSeq）
持续：10 分钟（≥ 5 场完整讨论走完）
```

**采集**：

- 每条事件：`{connId, discussionId, eventType, seq, serverCreatedAt, clientRecvAt}`。
- 事件延迟 `delay = clientRecvAt - serverCreatedAt`（同机同进程时钟，误差 <5ms，可接受；前提写进报告）。
- 内存：`GET /api/health.rssBytes` 或进程采样。
- DB：压测后跑一致性查询。

**指标与阈值**：

| 指标 | 阈值 | 采集方式 | 失败等级 |
| --- | --- | --- | --- |
| p95 事件延迟 | < 500ms | 事件延迟分布 | P0 |
| p99 事件延迟 | < 1000ms | 同上 | P1 |
| 串流率（事件 `discussionId` ≠ 连接归属） | **= 0** | 逐帧校验 | P0 |
| 事件丢失率（同连接 seq 缺口） | **= 0** | seq 连续性 | P0 |
| 重复事件率（同连接 seq 重复） | **= 0** | seq 去重计数 | P0 |
| 5xx / 连接异常率 | < 0.1% 且无 5xx | HTTP 状态统计 | P0（出现 5xx 即 P0） |
| `SQLITE_BUSY` 日志条数 | 0 | 日志扫描 | P0 |
| `(discussion_id, seq)` 唯一冲突 | 0 | DB 唯一索引 + 日志 | P0 |
| 活跃 SSE 连接数峰值 | == 20（±0，结束关闭除外） | health 计数 | P1 |
| 进程 RSS 10 分钟增长 | < 200MB（阈值待 PM 确认） | 采样 | P1 |
| CPU 平均（归一单核） | < 80% | 采样 | P1 |
| 连接建立 p95 | < 1s | 脚本计时 | P2 |

**串线检测的关键技巧**：mock 在该模式下给每条发言内容加会话标记前缀（`[A]`/`[B]`…），压测脚本断言 `content` 前缀与连接归属一致。这样即使 `discussionId` 字段错了，也能从内容层发现串线。这项能力需要 mock 支持 `echoDiscussionTag`（写进 §14.2）。

**通过判据**：所有 P0 指标达标 + P1 指标超阈值需 PM 书面接受 + 报告含完整分布图数据（不进图片，进 JSON/CSV）。

### 10.3 REST 基线（autocannon）

| 场景 | 命令形态 | 阈值 |
| --- | --- | --- |
| 列表查询 | 20 连接 / 30s / `GET /api/discussions?limit=50` | p95 < 150ms，错误 0 |
| 详情查询 | 20 连接 / 30s / `GET /api/discussions/:id`（seed 的 ended 会话） | p95 < 150ms，错误 0 |
| 事件分页 | 10 连接 / 30s / `GET /api/discussions/:id/events?limit=500` | p95 < 300ms |
| 创建限流 | 串行 12 次 `POST /api/discussions` | 前 10 次 201，之后 429，不 5xx（验证限流不是崩溃） |

> 创建接口不做高并发压测：限流（10 次/分钟）是设计行为，高并发只会打出 429，测不出有效信息。

### 10.4 UI 并行（Playwright 多 context）

5 个 context 打开 5 个 live 会话，持续 3 分钟，每 15s 采样：

- 每页 `transcript-item` 数单调不减；
- 每页 `data-status` 保持 `live`（除非该会话已 ended）；
- **5 个页面的 messageId 集合两两无交集**；
- 每页无 console error、无未捕获 Promise rejection（`page.on('pageerror')`）；
- 每页 DOM 节点数增长 < 3 倍（初步判断无节点泄漏）。

### 10.5 DB 锁专项

| 用例 | 步骤 | 断言 |
| --- | --- | --- |
| PERF-07 并发写 | 5 会话同时 confirm，之后 3 秒内同时对 5 个会话发 `/end` | 全部 2xx；summaries 5 行；无 `SQLITE_BUSY`；无 500 |
| PERF-08 高频洞察 | 5 会话各自每轮触发 `insight.updated` | 每会话 insights 行数 == 最后一次快照条数（全量替换无残留）；无唯一约束冲突 |
| PERF-09 seq 竞争 | 同会话在「结束」与「最后一条消息」并发 | seq 连续无重复；`last_seq` == max(seq) |

---

## 11. 安全测试

| 用例 | 目标 | 步骤 | 断言 |
| --- | --- | --- | --- |
| SEC-01 Key 静态扫描 | 源码里没有真 Key | 扫描仓库内 `.ts/.js/.json/.env*/.md`（排除 `docs/` 与 fixture 中的假 Key `sk-test-*`）匹配 `sk-[A-Za-z0-9]{10,}` | 命中 0 条真 Key；报告只输出 `文件名:行号` + 前 4 位脱敏，**不打印匹配内容** |
| SEC-02 bundle 扫描 | 构建产物无 Key | `pnpm build` 后扫描 `apps/web/dist/**`（含 `.map` 若开启）匹配 `sk-`、`DEEPSEEK_API_KEY`、`api.deepseek.com` | 命中 0；同时确认无 `VITE_*KEY*` 变量名 |
| SEC-03 网络响应扫描 | 响应与 SSE 帧无秘密/CoT | Playwright 抓全部 response body + SSE 帧 + response headers | 无 `sk-`、无 `reasoning_content`、无 `Authorization`、无 `api.deepseek.com` |
| SEC-04 日志扫描 | 日志脱敏 | 跑完主链路后扫描 `data/qa-logs/*.log` | 无 `sk-`、无 `Authorization`、无完整 prompt（含 topic 全text 以外的上下文原文）、无堆栈中的绝对路径 |
| SEC-05 XSS 注入 | 三处渲染点不执行脚本 | 在 topic、专家名（fixture 注入）、发言内容、insight 文本、summary 文本各注入：`<script>window.__xss=1</script>`、`<img src=x onerror=window.__xss=1>`、`"><svg onload=window.__xss=1>`、`javascript:alert(1)`、`{{7*7}}` | `window.__xss` 恒为 undefined；无 dialog；`innerHTML` 中不出现可执行标签（作为文本节点渲染）；页面不破版 |
| SEC-06 超长与畸形输入 | 不崩溃、不越界 | topic 199/200/201 码点（含中文、emoji、组合字符 `👨‍👩‍👧‍👦`）；body 1KB/16KB/17KB；`expertCount` = 0/-1/2.5/1e9/"4"/null；非 JSON body；`{"__proto__":{"polluted":1}}`；`after` = -1/0/1e9/abc/NaN；id 非 UUID/超长 300 字符 | 一律 400/404 且 `error.code` 合法；无 5xx；`Object.prototype.polluted` 未定义；进程不退出 |
| SEC-07 错误信息泄露 | 不暴露内部细节 | 触发 404/409/422/429/500；并构造一次内部错误（如非法分页参数导致的 DB 报错路径） | 响应体仅 `{error:{code,message,details?}}`；`assertNoSecrets` + 不含 `stack`/`at ` /`node_modules`/`SQLITE_`/`D:\\`/`E:\\` |
| SEC-08 CORS | 只允许本地前端 | 从 `http://evil.com`、`http://localhost:3000`、`null` Origin 发请求；再从 `http://localhost:5173` 发 | 非白名单无 `Access-Control-Allow-Origin`；白名单返回；`Allow-Credentials` 不为 true；OPTIONS 预检正确 |
| SEC-09 越权/横向 | 会话之间不能互相读 | 用 A 的 id 去读 B 的 messages/insights/events；随机 UUID；`after` 超大值 | 均为 404 或空集，**不返回其他会话的任何字段**；DB 层抽查 repository 无无会话条件查询（代码走查 1 次） |
| SEC-10 限流 | 限流生效且可读 | 1 分钟内 `POST /api/discussions` 11 次 | 第 11 次 429 + `error.code=RATE_LIMITED` + 前端 toast；之后恢复可创建 |
| SEC-11 CoT 与原始结构泄露 | 不展示内部推理与原始 JSON | 全流程 DOM + 网络 + SSE 扫描 `reasoning_content`、`thinking`、`chain_of_thought`、`scene` 及 ChatML 类控制标记；summary/insight 文本过 `assertNoJsonLeak` | 全部 0 命中；专家状态区文本仅来自 `focus`/`stance` 等公开字段 |

**Key 处理纪律（测试自身也要遵守）**：

- 测试**不读取、不复制、不打印**任何 Key 文件；只用 `DEEPSEEK_API_KEY` 是否存在的布尔判断。
- 扫描报告只写"文件名:行号/mock 命中数"，不回显内容。
- real smoke 由 PM 执行，QA 只验收其证据文件（不含 Key）。

---

## 12. 可访问性与视觉

### 12.1 A11Y 用例

| 用例 | 检查 | 断言 | 自动化 |
| --- | --- | --- | --- |
| A11Y-01 键盘全流程 | 仅用键盘走：首页卡片 → 创建 → 人数选择 → 提交 → 确认阵容 → 结束 → 回放控制 → 返回 | 所有关键操作可 Tab 到达；`document.activeElement` 序列可枚举；焦点环可见（`outline` 非 `none`，宽度 ≥2px）；Enter/Space 可激活；Esc 关闭抽屉 | 自动 |
| A11Y-02 axe 扫描 | 首页/创建/直播/回放 × 1440 与 390 两档 | critical == 0，serious == 0；若有例外须逐条记录并获 PM 书面接受 | 自动 |
| A11Y-03 对比度 | 正文/次要文本/按钮/状态标签/专家色标签 | 正文 ≥4.5:1；大字（≥18.66px bold 或 24px）与图标 ≥3:1；专家色若作前景文字必须达标，否则必须有文字标签 | 自动（axe + token 静态计算） |
| A11Y-04 reduced motion | `emulateMedia({reducedMotion:'reduce'})` | 无 infinite 动画（`animation-iteration-count` 不为 infinite 或 duration 为 0）；消息仍能正常出现（功能不依赖动画） | 自动 |
| A11Y-05 颜色非唯一载体 | 专家/共识/分歧/状态 | 专家条目同时有姓名文本 + 首字头像；三区各有文字标题；live/ended 有文字而非仅颜色点 | 自动（DOM 结构） |
| A11Y-06 语义与读屏 | transcript 新消息、状态变化、toast | `transcript-list` 有 `role=log` + `aria-live=polite`；toast 有 `role=status`；按钮有可访问名（无 `button` 空名） | 自动 |
| A11Y-07 移动端输入可用 | 390×844 下聚焦输入框 | 输入框不被底部 Tab/键盘遮挡（`getBoundingClientRect` 在视口内）；可完成提交 | 半自动（Playwright 视口 + 人工 DevTools 键盘模拟） |
| A11Y-08 缩放可用 | 浏览器 150% 缩放 / 320px 宽 | 无横向滚动条；文字不被裁切；仍可完成创建 | 半自动 |

### 12.2 视觉与响应式用例

| 用例 | 视口 | 断言 | 证据 |
| --- | --- | --- | --- |
| VIS-01 超宽 | 2560×1440 | 三栏 + 顶部 + 底部控制条；transcript 行宽不过宽（≤ 约 80 中文字符/行）；无拉伸变形 | 截图 |
| VIS-02 桌面 | 1440×900 | 四区齐全、比例合理（transcript 主区最宽）；无整页滚动 | 截图 + 尺寸断言 |
| VIS-03 窄屏 | 390×844 | 单栏 + 底部 Tab（讨论/专家/共识）；切换后各 Tab 独立滚动；页面不整体滚动 | 截图 + 断言 |
| VIS-04 平板 | 834×1112、768×1024 | 两栏 + 共识抽屉；抽屉可开合且开合后布局不塌 | 截图 |
| VIS-05 独立滚动 | 三档 | 见 §9.7 三条硬断言 | 计算值 |
| VIS-06 长内容压力 | 1440×900，注入 40 条长消息 + 20 条洞察 | 面板内滚动流畅；页面高度不变；无布局抖动（CLS 采样 <0.1） | 截图 + CLS |

**视觉走查清单（人工，半自动）**：深色舞台基调成立；专家色与头像/边框/发言标记一致；发言者有聚光/高亮反馈；动效克制不喧宾夺主；空态不空洞；错误态不吓人；三档截图与设计意图一致。走查结论写"符合/偏差项/建议"，不阻塞发版（除非影响可读性 → 按 P1 处理）。

---

## 13. 缺陷分级与发版门禁

### 13.1 缺陷分级（此处 P0/P1/P2 指**缺陷等级**，与 §2 的需求优先级无关）

| 等级 | 定义 | 判定例子 | 处理 |
| --- | --- | --- | --- |
| **P0 阻断** | 用户无法完成核心任务，或造成安全事故/数据污染 | 主链路任一步走不通；两会话串线；Key/CoT 泄露；白屏/崩溃；会话永久 live 无法结束；回放与直播内容不一致；结束后仍产生新发言；页面整体滚动导致三档布局失效 | 立即修，修完必须回归 + 出证据；未清零禁止发版 |
| **P1 严重** | 核心 AC 部分不满足，但有绕过路径 | 断线后需手动刷新才恢复；错误态显示技术细节；某档视口下可用性明显下降；键盘无法完成关键操作；共识缺依据；单条发言超长；总结缺一类内容；限流未生效 | 发版前必修；若因时间必须延期，需 PM 书面接受并写进 README"已知问题" |
| **P2 一般** | 不影响完成任务，体验/文案/细节问题 | 文案不统一；间距/对齐；动效不够顺；非关键文本对比度不足；P1 功能的小缺陷；极端边界（如 201 字符提示语不精确） | 记录，不阻塞；有余量再修 |

分级争议：QA 提出等级 → owner 可申诉 → PM 终裁（记入缺陷单，不口头改）。

### 13.2 发版门禁（G6 前必须全部满足）

| # | 门禁项 | 通过标准 | 证据 |
| --- | --- | --- | --- |
| G-1 | 无 P0/P1 缺陷 | 缺陷清单中 P0 == 0、P1 == 0（或有 PM 书面接受的 P1 例外清单） | `docs/QA-REPORT.md` 缺陷汇总表 |
| G-2 | 主链路 E2E 通过 | E2E-01 全 20 步通过，连跑 3 次稳定 | Playwright HTML 报告 + trace |
| G-3 | 必测场景通过 | §9 的 E2E-02/03/05/06/07 全通过 | 各场景报告 + 截图 |
| G-4 | 压测通过 | PERF-05 全部 P0 指标达标；P1 超阈值有书面接受 | 压测 JSON + 分布数据 |
| G-5 | Key 扫描通过 | SEC-01/02/03/04 命中 0 | 扫描脚本输出（脱敏） |
| G-6 | 追溯矩阵覆盖 | 39 条 AC 全部有用例；P0 子集全部有"通过"证据 | 矩阵勾选表（§7 + 附录 A） |
| G-7 | 单测/接口/组件测试通过 | 各层全绿；无 skip 的 P0 用例；无 flaky（连跑 3 次一致） | 各层测试报告 |
| G-8 | README 可复现 | 干净目录按 README 四步跑通，首页可用 | 走查记录 + 截图 |
| G-9 | 无未验证的"声称" | README/PRD/报告中没有与证据矛盾的表述（如无 WebKit 证据却写"跨浏览器"） | 文档对照检查 |

> QA 出结论，**PM 签字**。QA 不给自己签字（SOP §3.5）。

### 13.3 证据要求（什么算"有证据"）

| 证据类型 | 具体要求 | 归档位置 |
| --- | --- | --- |
| 自动化报告 | Playwright HTML + JUnit XML；保留失败用例的 trace.zip 与视频 | `e2e/artifacts/<date>/` |
| 截图 | 三档 × 四页面（首页/创建/直播/回放）至少 12 张；失败态各 1 张 | 同上 |
| 数据断言 | DB 查询结果导出（CSV 或 JSON），含查询语句 | 同上 |
| SSE 抓帧 | 关键用例的帧序列 JSON（含 seq、type、discussionId、到达时间） | 同上 |
| 压测报告 | JSON + 分布数据 + 结论段落 | 同上 |
| 安全扫描 | 脱敏后的命中清单（无内容回显） | 同上 |
| 人工走查 | 表格式清单，每项"符合/偏差 + 截图编号 + 判定人" | `docs/QA-REPORT.md` 附录 |
| 缺陷单 | 每单含复现步骤、期望/实际、环境、证据链接、等级、owner | 缺陷清单 |

**不算证据**：口头确认、"我本地跑过"、无时间戳的截图、只贴通过率的截图、无 trace 的 E2E 失败。

---

## 14. 对 PRD / API / SSE 的可测性评审

> 这一节是本次 G1 交付的重点。每一项都给出：问题 → 影响哪条 AC/用例 → 建议修改（可执行）。

### 14.1 哪些 AC 不可观测 / 不可自动验证

| # | AC | 为什么不可观测 | 影响的用例 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | **AR-02 串联不同专家** | `intent` 枚举只有 `opening/probe/rebut/support/extend/summary`，没有"串联/衔接"语义；也没有字段说明主持人回应了谁 | TC-AR-02-04 | 二选一：① 新增 `intent: "bridge"`；② 在 `turn.started` 增加 `references: ["e_01","e_03"]`（被回应/被串联的专家或 messageId 列表）。推荐 ②，复用性强且不破坏现有枚举 |
| 2 | **AR-03 "基于当前 transcript 决定"** | 只能从结果反推（非轮转、连续≤2），无法证明"真的看了 transcript" | TC-AR-03-02 | 增加对抗用例：mock 注入"只有 X 说话的 transcript"，断言下一位 speaker 变化（可自动）；并接受"直接证明不可行"的结论，写入报告 |
| 3 | **AR-07 / FR-09 "不编造一致"** | "依据是否支撑结论"是语义判断 | TC-AR-07-03 | 结构化部分（依据非空、id 存在、类型不得越级）自动验证；语义部分改为 20 条抽样人工 + eval 报告给出支持率，QA 只验收抽样表 |
| 4 | **AR-01 "立场互补"** | "互补"是语义；可结构化的是"不重复" | TC-AR-01-02/03 | 把 AC 拆成可判定子项：职业组不重复、立场相似度 <0.9、≥3 种取向关键词、主持中立词；互补性靠 3 场人工抽查 |
| 5 | **FR-06 "不出现固定轮转"** | 严格证明需要知道模型输入输出全貌 | TC-FR-06-04 | 定义 3 个可判定代理指标（见 §9 步骤 8），并明确"代理指标通过 ≠ 行为达标"，行为达标以 AR-11 eval 为准 |
| 6 | **NFR-01 延迟目标** | mock 没有真实模型延迟；real 只有 1 次 smoke 不足以算 p95 | PERF-02/03/04 | 明确分层：mock 只验"管道开销"（阈值另设，如 p95 <300ms）；真实延迟由 real smoke 的日志记录单次值 + eval 报告多轮统计供给，不作为发版门禁的 p95 判据 |
| 7 | **NFR-03 "p95 事件延迟 <500ms"** | 事件 payload 无服务端发送时间，只能用 `createdAt`（落库时间）近似 | PERF-05 | ① SSE 事件 payload 增加 `sentAt`（服务器发出时刻）；或 ② 服务端日志记 `sse.emit`（reqId + seq + ts），压测脚本与日志对齐。推荐 ②，避免改契约 |
| 8 | **NFR-11 对比度** | 深色渐变背景 + 半透明叠层，运行时对比度计算不稳定 | A11Y-03 | 前端交付 `design-tokens.json`（前景/背景/专家色成对），QA 静态计算 + axe 运行时抽查双向验证 |
| 9 | **FR-14 "高质量样例"** | "高质量"主观 | TC-FR-14-01 | 定义为可检查清单：5 条覆盖 5 种状态、字段非空、颜色唯一、立场 ≥3 类、样例 1 含 ≥8 轮 + ≥2 洞察 + 总结。清单进 PRD 附录 |
| 10 | **AR-11 行为评测** | QA 无法判断 prompt 好坏，也无法复跑真实模型 | TC-AR-11-01 | 只验收"报告存在 + 7 项指标齐全 + 议题 ≥5 + 有可复查样本"，明确写入报告边界 |

### 14.2 需要补的字段 / 事件 / 测试钩子（按优先级）

| # | 建议 | 服务于 | 优先级 | 成本 |
| --- | --- | --- | --- | --- |
| A | **新增 `GET /api/discussions/:id/state`**：返回纯由事件重放得到的投影快照 `{status, turnCount, lastSeq, messages[], insights[], summary}`，**不读投影表**（或与投影表做双读校验） | E2E-05 一致性、TC-RP-01~05、TC-NFR-04-03 | **P0（强烈建议）** | 小（复用 reducer） |
| B | **`GET /api/health` 扩展** `llmMode`、`mockScenario`、`dbPath`、`version`、`uptimeMs`、`rssBytes`、`activeSseCount` | 环境自检、TC-NFR-07-01/03、PERF-05 内存与连接采样 | **P0** | 小 |
| C | **测试钩子**：`x-qa-scenario`（按会话注入故障）+ 页面内 SSE 帧缓冲 `window.__qa.sse`；均需 `LLM_MODE=mock` 且非 production 才生效 | 并行异构场景、E2E-03/04、SEC-03 | **P0** | 中 |
| D | **`stream.ready` 增加 `replayedUntil`**（或新增无 id 的 `stream.replay.done` 事件） | TC-SSE-02/05 判断"补发结束、进入实时" | **P0** | 小 |
| E | **消息中止标记**：`message.completed.truncated: boolean`，或新增 `message.aborted`（带 `reason`） | TC-EN-05、TC-RP-02"不得留下半条" | **P0** | 小 |
| F | `turn.started` 增加 `references: string[]`（被回应/串联对象） | AR-02 串联、AR-03 可解释性 | P1 | 小 |
| G | 回合硬上限行为定义为**可观测**：到 14 轮由服务端自动触发 summarizing，并产生 `discussion.limit_reached`（或至少在日志有明确 phase） | TC-FR-06-03 | P1 | 小 |
| H | `POST /end` 幂等返回码固定（建议 `200` + `discussion.status` 当前值 + `alreadyEnded: true`） | TC-EN-01 | P1 | 极小 |
| I | `GET /events` 与 SSE 支持 `limit`（SSE 补发分批，超量时给 `hasMore` + 让客户端续拉） | TC-SSE-11 | P2 | 中 |
| J | 响应头 `X-Request-Id`；日志同名字段；错误响应 `details.reqId` | NFR-09、SEC-07、缺陷定位 | P1 | 小 |
| K | mock 记录 `QA_LLM_LOG`（JSONL：`{reqId, discussionId, kind, model, thinking, stream, promptDigest, includedMessageIds[], usage}`）——**只记 id 与摘要，不记全文** | AR-05/AR-10、TC-FR-12-05、TC-FR-11-04 | **P0** | 小 |
| L | mock 支持 `echoDiscussionTag`（内容前缀会话标记） | PERF-05 内容级串线检测 | P1 | 极小 |
| M | 可选：`POST /api/discussions/:id/_qa/pause`（仅 mock + 非 production），暂停 runner | 结束/刷新/并发类用例的稳定时序 | P2（不批则用时序等待替代） | 中 |
| N | 前端 DOM 契约（§5.2 的 testid 与 `data-*`）写入 `packages/shared` 常量并在 FE-01 确认 | 全部 E2E | **P0** | 小 |

> **A/B/C/D/E/K/N 七项建议在 G1 冻结前落定**；没有它们，回放一致性、并行隔离、故障注入三类用例都要降级为人工，而这三类恰好是本题最看重的"工程质量"证据。

### 14.3 哪些状态转换没有定义

| # | 缺口 | 后果 | 建议 |
| --- | --- | --- | --- |
| 1 | `failed` 之后 `regenerate` 成功后回到 `generating` 还是直接 `ready`？ | TC-FR-02-04 无法断言中间态 | 定义为 `failed --regenerate--> generating --> ready/failed`，并在 API 契约 §2 状态表补一行 |
| 2 | `live` 中 LLM 连续失败的终止条件未定义（几次失败进入 failed？） | TC-AR-09-06 只能断言"不永久 live"，不能断言具体终态 | 定义：连续 3 次不可恢复失败 → 用模板总结 → `ended`（保留可回放）；或 → `failed`（不可回放）。二选一，推荐前者（体验更好） |
| 3 | `summarizing` 中总结失败无出口 | 会话可能卡在 summarizing（PRD §10.4 禁止） | 定义：总结失败 → 重试 1 次 → 仍失败则写模板总结 + `ended` + 标记 `summary.fallback=true` |
| 4 | `draft` 状态实际不可达（POST 直接 generating） | ER/API 有 `draft`，但没有任何接口能让会话停在 draft，测试无法构造 | 明确 `draft` 为内部瞬时态、不对外可观测；或提供创建草稿接口。推荐前者，删掉 API 状态表中的 draft 行 |
| 5 | 进程重启后 `live` 会话的对外状态 | 前端遇到该状态不知如何渲染 | 统一映射为 `failed` + `error_code=INTERRUPTED`，UI 文案"讨论已中断，可查看已产生内容"；且 `GET /events` 仍可回放已落库部分 |
| 6 | `confirm` 返回的 `lastSeq` 是否已包含 `discussion.started` | 若不含，前端 `after=lastSeq` 会漏掉 started 事件 | 明确"返回时 lastSeq 为该时刻已持久化的最大 seq（含 started）"，并在契约里写清 |
| 7 | `insight.updated` 与 `discussion.ended` 的先后优先级 | 最后一批洞察可能丢在 ended 之后 | 明确：`end` 必须先 flush 待发洞察，再发 summary，再 ended |
| 8 | `ready` 长期未确认是否有超时/清理 | 不影响 P0，但首页可能有僵尸卡片 | 明确"不清理"，测试不覆盖 |
| 9 | 结束与流式并发的中间态 | TC-EN-05 断言不稳定 | 明确"结束请求到达后：正在流式的消息要么完成并落 completed，要么丢弃且不留半条；两者都必须先于 summary.completed" |
| 10 | `error` 事件是否可恢复不改变讨论状态 | TC-AR-09-01 无法断言 recoverable 后的状态 | 明确"`recoverable=true` 不改变 discussion.status，仅前端提示" |

### 14.4 哪些失败路径没有兜底

| # | 失败路径 | 现状 | 建议 |
| --- | --- | --- | --- |
| 1 | 创建讨论同步失败后，首页是否出现 failed 卡片 | 契约说"保留 discussion（failed）"，但未明确列表是否显示 | 明确列表显示（带"生成失败/重试"），否则用户无处重试 |
| 2 | 前端连 SSE 时 404（会话不存在） | 未定义前端行为 | 显示"讨论不存在" + 返回首页，不无限重连 |
| 3 | 补发事件量过大（>500） | `GET /events` 有 limit，SSE 补发无分批 | 明确分批 + `hasMore`，或声明 MVP 单场上限（14 轮 × 约 4 事件 ≈ 60 条）不可能超限，并写成显式约束 |
| 4 | 20 条连接同时断线重连（惊群） | 无连接上限与退避约定 | 服务端设 `maxSsePerSession`（如 8）+ 超限 429；前端指数退避（1s/2s/4s，上限 10s） |
| 5 | 客户端发现 seq 跳号、拉详情后仍缺 | 只定义了"重新拉详情补齐" | 定义二次兜底：连续 2 次补齐失败 → 提示"实时连接异常，请刷新"，并停止无限重试 |
| 6 | `LLM_MODE` 配错 | 可能静默走 real（烧钱） | fail-fast：启动校验枚举值 |
| 7 | 数据库不可写（磁盘满/权限） | 未定义 | 启动时自检写权限；运行期 500 + 可读文案 + 日志；不泄漏路径 |
| 8 | 构建期误引入 `VITE_DEEPSEEK_API_KEY` | 无守卫 | 构建脚本加 bundle 扫描（SEC-02 进 CI）；ESLint 规则禁止 `VITE_*KEY*` |
| 9 | 字符计数口径不一致（`length` vs 码点） | 200 字与 120 字可能差一倍 | 统一"按 Unicode 码点计"，写入 API 契约与 ER 字段说明；用 emoji 用例锁定 |
| 10 | 空 insights 首屏 | 未定义空态 | 明确三区各有空态文案，属 FR-15 范围（TC-FR-09-05） |
| 11 | 前端未处理未知事件类型 | 契约说"忽略并记录"，但没定义记录去哪 | 明确：忽略 + `console.warn`（生产静默）+ 不崩溃；加 1 条用例（注入未知事件） |
| 12 | 服务端返回超大 payload（如 insight 全量含长文本） | 无上限 | 定义单事件 payload 上限（如 16KB）并在测试里构造超限样本 |

### 14.5 72 小时内最大的质量风险

**结论：最大风险不是"功能没做完"，而是"回放一致性与多会话隔离只有契约保证、没有接口可验证"。**

理由：

1. 这两条是产品可信度的地基（PRD §1.4 第 4、5 条成功标准），也是最容易被"看起来能用"掩盖的缺陷：前端 reducer 与后端投影对边界事件（`roster.ready` 重发、`insight.updated` 全量替换、消息中止、补发去重）理解只要有一处理解不同，就会出现"直播对、回放错"或"两会话偶尔串一条"。这类缺陷复现概率低、定位成本极高，在 72 小时末尾几乎不可能修。
2. 目前契约里**没有服务端投影接口**（§14.2-A）、**没有补发完成标记**（D）、**没有中止标记**（E）。缺这三样，"一致性"只能靠人眼看两次，属于"不可证明"。
3. 次风险：**mock 与真实模型的行为差**。E2E 全绿但真实链路可能在 JSON 合法性、空输出、超时上完全不同；而真实调用预算只有约 ¥10 和 1 次 smoke。缓解：`mixed` 场景把真实世界已知的失败形态前移到 mock（§6.4），并把 real smoke 提前到 G4 而不是 G6。
4. 第三风险：**时间压缩导致"门禁用例被跳过"**。缓解：门禁子集（§7.4）从 G3 就开始跑，不等全部用例写完；E2E-01 在 G3 末必须能跑（哪怕只覆盖 6 步），逐步加步而不是最后一次性写。
5. 第四风险：**mock 反过来掩盖真实缺陷**——例如 mock 太快，导致 20 条 SSE 的并发问题在压测中不出现。缓解：压测必须用 `QA_DELTA_INTERVAL_MS=50` + 注入随机 ±20ms 抖动 + 5 会话不同 scenario。

**给 PM 的一句话建议**：G1 冻结前把 §14.2 的 A/B/C/D/E/K/N 七项写进契约，否则 G5 的"回放一致""并行隔离"验收会退化成人工确认，而这正是面试官最可能追问的两点。

---

## 15. 排期、交付物与节奏

### 15.1 任务拆解（对齐 TASKS §5 与倒排节点）

| ID | 时间 | 内容 | 出口条件 |
| --- | --- | --- | --- |
| **QA-01** | 10/31 深夜（本文件） | 测试计划 v0.1、追溯矩阵、可测性评审 | PM 确认 §14 建议是否进契约 |
| QA-02 | 11/1 上午（G2） | Playwright 骨架、fixtures、mock 场景引擎对接、DB 只读断言工具、`e2e/fixtures` 全部负例文件 | 空库上跑通"首页加载 + 创建（mock）"2 条冒烟 |
| QA-03 | 11/1 下午–晚（G3） | 主链路 E2E 分步落地（先 1–8 步，再 9–20 步）、接口层补齐（I 层验收） | E2E-01 至少跑到第 12 步 |
| QA-04 | 11/2 上午（G4–G5） | E2E-02/03/05/06/07、压测脚本、安全扫描、a11y/三档截图、`QA-REPORT.md` | 门禁子集全绿或缺陷清零计划确定 |
| RC 回归 | 11/2 15:00 | 全量回归 + 三次稳定性验证 + 报告定稿 | G-1~G-9 全部满足 |
| 交付 | 11/2 17:00 | 证据归档、README 测试章节校对 | PM 签字 |

**风险预案**：若 11/1 晚主链路仍跑不到第 12 步，则砍掉 P1 全部用例与 WebKit，把人力压在门禁子集 45 条上，并在报告里明示未覆盖项（不允许"假装覆盖"）。

### 15.2 我的交付物清单

| 文件 | 说明 | 状态 |
| --- | --- | --- |
| `docs/QA-PLAN.md` | 本文件（含追溯矩阵、可测性评审） | ✅ 本阶段产出 |
| `e2e/` | Playwright 配置、页面对象、9 组场景（E2E-01~09）+ SSE/回放/恢复/结束四个专项、fixtures | QA-02~04 |
| `e2e/perf/sse-load.mjs` | 自研 SSE 压测脚本（仅 Node 内置模块） | QA-04 |
| `e2e/perf/rest-baseline.*` | autocannon 配置与结果解析 | QA-04 |
| `e2e/security/scan-bundle.*`、`scan-logs.*` | Key 与日志扫描 | QA-04 |
| `e2e/a11y/` | axe 配置与基线例外清单 | QA-04 |
| `e2e/artifacts/<date>/` | 报告、截图、trace、压测数据 | 持续 |
| `docs/QA-REPORT.md` | 测试报告：结论、指标、缺陷汇总、未覆盖项、证据索引 | QA-04 |
| 缺陷单 | 每条含复现/期望/实际/证据/等级/owner | 持续 |

### 15.3 测试节奏

- **每次改动**：U/C/I 三层（各 owner 自跑，测试验收）。
- **每次 PR**：门禁子集中已实现的部分 + E2E-01。
- **每日 1 次**：全量 E2E + 压测 + 安全扫描 + 三档截图。
- **稳定性**：门禁用例连跑 3 次；flaky 连续 2 次即开缺陷并降级，禁止静默重试。
- **真实 smoke**：G4 一次（8 轮左右）、G5 一次（完整 10 轮），由 PM 执行并提交耗时/成本/错误证据。

---

## 16. 需要 PM 裁决的事项

| # | 事项 | 我的建议 | 不决策的后果 |
| --- | --- | --- | --- |
| 1 | §14.2 的 A/B/C/D/E/K/N 七项是否写入契约（投影接口、health 扩展、测试钩子、补发完成标记、中止标记、LLM 调用记录、DOM 契约） | **全部写入**，作为 NFR-07"可测试"的具体条款 | 回放一致性、并行隔离、故障注入三类用例降级人工，G5 验收失去硬证据 |
| 2 | AR-02「串联」如何表达（新增 `intent: bridge` vs `turn.started.references`） | 选 `references: string[]`，不动 intent 枚举 | AR-02 只能半自动，主持人职责验收靠人眼 |
| 3 | `live` 中连续 LLM 失败后的终态（模板总结 → ended / → failed） | 模板总结 → `ended`（可回放），并标 `summary.fallback=true` | 失败讨论会变成不可回放的死会话，且"永不卡 live"无法断言具体终态 |
| 4 | `draft` 是否保留为对外状态 | 删除，仅作内部瞬时态 | 测试无法构造该状态，状态表出现无意义行 |
| 5 | **HTML 标签输入的处理方式**：API 契约 §6 写"校验禁止 HTML 标签（400）"，NFR-06 写"XSS 转义" | 二选一并写死：① 拒绝（400，需在前端提示）；② 接受原文 + 渲染转义（需所有渲染点走 textContent）。**推荐 ②**，因为议题里出现 `A<B` 这类内容是合理输入 | 现在两条路线冲突，SEC-05 用例无法确定期望结果，容易出现"接口拒绝但前端仍渲染原文"的空档 |
| 6 | NFR-01 的 mock 口径：mock 下延迟阈值是否另设 | mock 只验管道开销，阈值 p95 <300ms（首 token）/ <500ms（轮间），真实 p95 由 real smoke + eval 提供、不做门禁 | 会用"mock 的 5s"假装证明"真实 5s"，报告不可信 |
| 7 | PERF-05 的 P1 阈值（RSS <200MB、CPU <80%）与 SSE 每会话连接上限 | 接受建议值；`maxSsePerSession=8`，超限 429 | 压测结论无法判定合格 |
| 8 | P1 缺陷的例外接受机制（谁签字、写在哪） | 只能 PM 书面接受，写进 `QA-REPORT.md` 与 README"已知问题" | 门禁会被口头豁免，失去意义 |
| 9 | real smoke 的执行人、时机与成本预算（2 次 × ¥0.5） | PM 执行，G4/G5 各 1 次，QA 验收证据 | QA 不能调真实模型，没人跑就永远是 mock 证据 |
| 10 | 是否要 WebKit 兼容 | 不做门禁，README 不声称跨浏览器 | 无证据的兼容性声称会在评审中被追问 |
| 11 | 样例数据的验收清单（§14.1-9 的可检查定义） | 写进 PRD 附录或 ER §7 | "高质量"无法判定 |
| 12 | DOM 契约命名：FE-01 的 `message-{id}` 内插式 testid vs 本文件的「静态 testid + `data-*`」（§5.2.1） | 采用静态 testid + `data-*`，合并成一份常量进 `packages/shared` | E2E 选择器两套并存，断言可维护性下降，G2 起返工 |

---

## 附录 A 用例编号总览

| 前缀 | 范围 | 数量 | 说明 |
| --- | --- | --- | --- |
| `TC-FR-xx-yy` | FR-01~17 功能用例 | 65 | 单元/组件/接口/E2E 混合 |
| `TC-AR-xx-yy` | AR-01~11 行为用例 | 35 | 含 3 条半自动、2 条人工 |
| `TC-NFR-xx-yy` | NFR-01~11 非功能用例 | 17（专有） | 交叉项见下 |
| `E2E-xx` | 端到端场景组 | 9 组 | E2E-01~09 |
| `TC-SSE-xx` | SSE 断线补发专项 | 12 | 归入 E2E-03 |
| `TC-RP-xx` | 回放一致性专项 | 6 | 归入 E2E-05 |
| `TC-RC-xx` | 刷新/重启恢复专项 | 7 | 归入 E2E-06 |
| `TC-EN-xx` | 结束幂等专项 | 6 | 归入 E2E-07 |
| `SEC-xx` | 安全专项 | 11 | 含 FR-16、NFR-06 |
| `PERF-xx` | 性能/压力专项 | 9 | 含 NFR-01/03/08 |
| `A11Y-xx` | 可访问性专项 | 8 | 含 NFR-11 |
| `VIS-xx` | 视觉/响应式专项 | 6 | 含 NFR-05 |

用例书写规范（QA-02 起强制执行）：

1. 标题 = 「操作 + 期望」，不出现"正常""正确"等不可判定词。
2. 必填：前置条件、步骤、断言（含具体值/数量/时间窗）、证据、失败等级。
3. 断言必须是"可计算"的：数量、集合、相等、时间窗、正则、DOM 属性。
4. 涉及时间的断言必须给明确窗口（如 3000ms），不允许"稍等"。
5. 涉及"不存在"的断言必须给扫描范围（哪个 DOM 子树、哪段响应体、哪个目录）。

## 附录 B 缺陷单模板

```text
标题：[P0/P1/P2][模块] 一句话现象
环境：commit / 模式(mock|real) / 场景 / 浏览器与视口 / OS
复现步骤：1..N（可直接照做，含 mock 场景名与 fixture）
期望：
实际：
证据：trace / 截图 / 帧序列 / DB 查询 / 日志片段（脱敏）
影响：哪些 AC、哪些用例失败、是否可绕过
首次发现：用例 ID + 时间
owner：
```

## 附录 C `docs/QA-REPORT.md` 目录（QA-04 产出，先约定结构）

```text
1. 结论（是否放行 + 未覆盖项声明）
2. 环境与版本（commit、mock/real、浏览器）
3. 门禁 G-1~G-9 逐项结论表（含证据链接）
4. 追溯矩阵覆盖结果（39 条 AC 的状态：通过/失败/未测，未测必须写原因）
5. 缺陷汇总（P0/P1/P2 计数与清单；P1 例外的 PM 接受记录）
6. 性能与压力结果（分布、阈值对照）
7. 安全扫描结果（脱敏）
8. 可访问性与视觉结果（axe 摘要、三档截图索引、对比度表）
9. 已知限制与结论边界（mock 能证明什么、不能证明什么）
10. 附录：如何本地复现全部测试
```

## 附录 D 术语

| 术语 | 含义 |
| --- | --- |
| AC | 验收标准（Acceptance Criteria） |
| mock LLM | 在 adapter 层替换模型 HTTP 调用的测试模式，不调真实模型 |
| S_live / S_replay / S_evt | 直播终态 / 回放末尾 / 事件重放的规范化状态快照 |
| 串线 | 不同讨论的事件/消息/洞察互相混入 |
| 半自动 | 自动执行 + 人工判定一次，判定结论需留记录 |
| 门禁子集 | §7.4 列出的约 45 条，发版前必须全绿 |

---

## 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v0.1 | 2026-10-31 | 首版：范围、追溯矩阵（39/39）、9 组 E2E 场景、145 条用例设计、mock 策略、压力/安全/a11y 方案、门禁；可测性评审 46 项（不可观测 10 / 契约补充 14 / 状态缺口 10 / 兜底缺口 12）；新增 §5.2.1 与 FE-01 的 testid 对齐建议 |

