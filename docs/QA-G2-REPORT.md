# QA-02 / QA-03 交付报告（E2E 骨架 + fixtures + 冒烟）

- 日期：2026-11-01
- 角色：测试
- 任务：QA-02（骨架与 fixtures）、QA-03（主链路 E2E v0）
- 关联：[QA 计划](QA-PLAN.md)、[契约 v1.0 决议](06-G1契约决议.md)、[TASKS §5](TASKS.md)
- 范围：只写了 `e2e/**` 与本文件；未改生产代码、未装依赖、未跑 git、未读 Key、未调真实模型

---

## 0. 一句话结论

E2E 骨架已可执行：**20 条用例（6 个 spec），最近一次全量运行 20 passed / 0 failed / 0 skipped（11.9s）**；fixtures **37 个 JSON，校验 PASS**；主链路能从首页跑到"SSE 收到首条 `message.completed`"并校验事件序；演播厅三栏布局已加回归用例（1440 不重叠 + 1024/390 无整页滚动）。已修掉"trace 写到中文路径导致 ENOENT"这一基建问题（产物改到 `%TEMP%\ai-panel-e2e`）。

---

## 1. 交付物

| 文件 | 说明 |
| --- | --- |
| `e2e/playwright.config.ts` | Chrome channel、baseURL 可覆盖、workers=1、**产物写纯 ASCII 绝对路径** |
| `e2e/global-setup.ts` | 启动前探测后端能力并写 `capabilities.json`；strict 模式下不可达即失败 |
| `e2e/helpers/env.ts` | 统一环境变量（baseURL / apiURL / strict / artifacts） |
| `e2e/helpers/api.ts` | Node fetch API client（health/list/create/detail/state/events/confirm/end） |
| `e2e/helpers/sse.ts` | **Node 侧 SSE 客户端**：解析帧、心跳、`retry`，支持 `waitForEvent`、seq 连续性/重发检测 |
| `e2e/helpers/dom.ts` | DOM 规范化（transcript/experts/insights/liveState）、页面与面板滚动度量、console/pageerror 采集 |
| `e2e/helpers/selectors.ts` | 选择器层：静态 testid 与前端"内插式 testid"双兼容 |
| `e2e/helpers/scan.ts` | Key / CoT / 原始 JSON / 堆栈扫描 + 网络响应体采集 |
| `e2e/helpers/capabilities.ts` | 能力矩阵探测（home/createForm/stage/replay/qaSse），缺失即 skip 并给原因 |
| `e2e/helpers/fixtures.ts` | Playwright fixture 扩展（api/backend/ui/diag）与 `requireCap` |
| `e2e/fixtures/**` | **37 个** JSON：5 议题 + 13 roster（含 8 负例）+ 6 decision + 5 speech + 4 consensus + 3 summary + 1 mixed 计划 + 4 事件序列 |
| `e2e/tools/emit-fixtures.mjs` | fixture 生成器（写盘前自检：颜色唯一、极性 ≥3、码点上限、事件终态配平） |
| `e2e/tools/validate-fixtures.mjs` | fixture 全量校验器（字段级，可 `--json` 输出报告） |
| `e2e/tools/inspect-page.mjs` | 页面诊断工具：打印 testid 清单、`data-*` 统计、滚动度量、console 错误 |
| `e2e/specs/*.spec.ts` | 5 个 spec：fixtures 契约 4 条、API 健康 3 条、web shell 2 条、创建表单 2 条、主链路 5 条 |

## 2. fixtures 校验（PM 优先项 1）

```
fixtures 校验：37 个文件
  按 schema：qa/events@1=4  qa/llm-fixture@1=31  qa/mixed-plan@1=1  qa/topics@1=1
  按 kind：consensus=4  decision=6  roster=13  speech=5  summary=3
  场景覆盖：duplicate, empty, invalid-json, long, mixed, normal, runaway, slow, timeout
结论：PASS（4 条 warning 均为"故意损坏变体"的设计意图）
```

- 5 个议题，`plannedTurns/maxTurns` 按 06 §1.6 公式校验通过。
- roster 字段对齐 06 §1.5：`stanceAxis`、`polarity`、`focusArea` 齐全；颜色唯一且避开语义色；极性 ≥3 类。
- 负例齐全：坏 JSON（截断）、空、超长（>120 码点）、重复、无依据 consensus、固定轮转、连续 3 次同人、runaway（20 轮不给 summary）。
- 事件序列满足 06 §1.3：`turn.started` 数 == `message.completed + turn.aborted` 数；`discussion.ended` 恰 1 个且在末尾；`summarizing → summary → ended` 顺序正确；`message.id` 均被 `turn.started` 预分配。

> 已知差异：服务端真实 expertId 形态是 `e_<uuid>`，fixture 用 `e_host`/`e_01`。测试不硬编码 id（用例里从 `/detail` 反查 hostId），但消费 fixture 的 mock 引擎需知道这点。

## 3. 冒烟 + 主链路：通过/失败清单（PM 优先项 3、4）

| # | 用例 | 结果 | 说明 |
| --- | --- | --- | --- |
| 1 | fixtures 4 条结构自检 | ✅ passed | 不依赖应用，永远可跑 |
| 2 | health 200 + 契约字段齐全 + 无 Key/堆栈 | ✅ passed | 断言 `llmMode=mock`（防真实模型烧钱） |
| 3 | health 不暴露 `dbPath`/绝对路径 | ✅ passed | 06 §1.9 |
| 4 | health `dbReady=true` 且 `journal_mode=wal` | ✅ passed | NFR-04；此前是 fixme，BE 接线后转真实断言 |
| 5 | 首页可打开、root 非空、无 console/pageerror、无 Key/JSON 泄露 | ✅ passed | 含首屏截图证据 |
| 6 | 首页不依赖后端也能给出可读状态 | ✅ passed | 白屏兜底 |
| 7 | 创建表单：空/1 码点/纯空白不可提交；200 码点可提交；201 被截断或拦截 | ✅ passed | 实测前端是"按钮禁用"式拦截，断言写成"禁用或报错"两可 |
| 8 | 合法议题提交后进入 generating/ready | ✅ passed | |
| 9 | 首页 → 创建 → Lobby → confirm → **SSE 收到首条 message.completed** | ✅ passed（应用稳定时） | 断言：`stream.ready` 先到；`turn.started` 早于同 messageId 的 completed；首条 `intent=opening` 且发言者=host；所有帧 `discussionId` 属于本会话 |
| 10 | 应用内确认阵容后演播厅渲染出消息 | ✅ passed | 见 §4 BUG-01 |
| 11 | BUG-01 对照组：直接打开已结束讨论能渲染 transcript | ✅ passed | 隔离"是渲染问题还是数据问题" |
| 12 | API 创建幂等：同 `clientRequestId` 只产生 1 条讨论 | ✅ passed | 06 §1.1，两次 200/201 同 id |
| 13 | 创建参数校验：短/超长/空白议题、人数 2/7 → 400 `VALIDATION_ERROR` | ✅ passed | FR-02 |
| 14 | **1440×900 三栏不重叠且铺满视口** | ✅ passed | 见 §3.1 实测几何 |
| 15 | **1440×900 首条消息可见且落在 stage 栏内** | ✅ passed | 空壳回归 |
| 16 | **1024×768 无整页滚动、主面板可滚** | ✅ passed | NFR-05 |
| 17 | **390×844 无整页滚动、主面板可滚** | ✅ passed | NFR-05 |

**结论**：最近一次全量运行 **20 passed / 0 failed / 0 skipped（11.9s）**。此前失败均因后端进程重启中途退出（`ECONNREFUSED`，基建问题非断言问题），改指向稳定实例后全绿。
`E2E_STRICT=1` 下"应用不可达"会直接失败而不是 skip，供发版门禁使用。

**运行基线**：`E2E_ARTIFACTS_DIR=%TEMP%\ai-panel-e2e`；`--list` 与报告中文正常（文件为 UTF-8，控制台需 `chcp 65001`）。

### 3.1 布局回归实测几何（1440×900，`.studio-*` 三栏）

修前：三栏子项都只有 `grid-area: stage` → 三栏重叠成一列，只剩 InsightPanel 可见。
修后实测（来自 `e2e/tools/inspect-page.mjs`）：

| 栏 | x | y | width | height |
| --- | --- | --- | --- | --- |
| rail | 0 | 64 | 302 | 780 |
| stage | 302 | 64 | 792 | 780 |
| insights | 1094 | 64 | 346 | 780 |
| viewport | — | — | 1440 | 900 |

- 三栏 x 区间首尾相接：`[0,302) [302,1094) [1094,1440)`，**无重叠**，合计正好铺满 1440。
- `scrollHeight == clientHeight == 900` → 无整页纵向滚动。
- 用例断言方式：两两做矩形相交判断（容差 1px）+ `rail.x ≤ 2` + `insights.right ≥ 1438`，因此"三栏回到重叠"这类回归会被直接抓住，不会因为选择器命中同一个元素而假绿。

## 4. 缺陷与观察

### BUG-01（P1，**已由前端修复**）：确认阵容后演播厅空壳

- 现象：应用内"创建 → 确认"后进入 `/d/:id`，顶部显示「直播中 · 第 0 轮 · 0 条洞察」，专家栏与 transcript 全空；同一 discussionId **直接打开 URL** 却能渲染 12 条消息。
- 证据：`test-failed-1.png`（首屏截图）、SSE 帧序列（同场 Node 直连能收到 opening，说明后端在正常推送）。
- 已排除：后端（SSE 与事件序正常）、测试环境（vite dev 与 preview 均复现）。
- 现状：前端修复后该用例**从 `test.fail`（预期失败）转为真实断言并通过**，保留为回归用例。

### BUG-02（P2，新）：首页空态 CTA 缺 testid

- 首页空态按钮「发起第一场讨论」没有 `data-testid`，只能靠 `button:has-text("发起")` 兜底定位。
- 影响：文案一改选择器就断。建议补 `data-testid="new-discussion"`（列表态已有同名 testid，空态应一致）。

### BUG-03（P1，**已由前端修复**）：三栏 grid-area 全部写成 `stage`，1440 下三栏重叠

- 现象：1440×900 下 rail / stage / insights 三栏重叠成一列，页面上只剩 InsightPanel 可见。
- 根因：`styles.css` 里三栏子项都只有 `grid-area: stage`。
- 修复：补 `.studio-rail{grid-area:rail}`、`.studio-stage{grid-area:stage}`、90rem 下 `.studio-insights{grid-area:insights}`。
- 回归：`e2e/specs/layout.stage.spec.ts` 4 条用例（1440 不重叠铺满 / 首条消息可见且在 stage 内 / 1024 无整页滚动 / 390 无整页滚动），实测几何见 §3.1。

### 观察 1：测试环境路径编码（已修）

项目路径含中文（`D:\AI开发\...`）时，Playwright 把 trace 写到仓库内 `.artifacts` 会在 `browserContext.close` 阶段按 cp936 拼路径，报 `ENOENT: D:\AI寮€鍙慭...`——表现为"用例失败但不是断言失败"。
**修复**：产物目录改为纯 ASCII 绝对路径 `%TEMP%\ai-panel-e2e`（可用 `E2E_ARTIFACTS_DIR` 覆盖），trace/screenshot/report 全部落在那里。

### 观察 2：联调期后端进程重启导致偶发 `ECONNREFUSED`

后端仍处于 `tsx watch` 联调状态，改动即重启，测试跑到一半会连不上 3001。表现：`TypeError: fetch failed / connect ECONNREFUSED`，与断言无关。
建议：联调期由 QA 指向一个**已构建的稳定实例**（`pnpm --filter @ai-panel/server build && start`，独立端口 + 独立 DB），避免用例被重启噪声污染。

### 观察 3：前端 testid 约定与 QA 计划 §5.2 未收敛

前端按 FE 计划 §13 用了内插式（`message-{id}`、`expert-card-{id}`、`insight-{type}-{id}`、`roster-expert-{id}`），而 QA 计划建议"静态 testid + data-*"。`selectors.ts` 已做双兼容，但缺少 `data-message-id`/`data-speaker-id`/`data-conn-state`/`data-turn-count` 等语义属性，使"按 id 去重""不串线""连接状态"这类断言只能靠 testid 前缀解析。
建议 G3 前收敛一次（改动很小，收益是所有批量断言稳定）。

## 5. 如何运行

```powershell
# 起服务（当前由其他 agent 起的 5173/3001 可直接复用）
.\scripts\pnpm.ps1 dev

# 全量
.\scripts\pnpm.ps1 exec playwright test --config e2e/playwright.config.ts

# 只跑冒烟 / 主链路
.\scripts\pnpm.ps1 exec playwright test --config e2e/playwright.config.ts e2e/specs/smoke.*.spec.ts
.\scripts\pnpm.ps1 exec playwright test --config e2e/playwright.config.ts e2e/specs/main-chain.spec.ts

# fixtures 校验（门禁脚本，可归档 JSON 报告）
.\scripts\pnpm.ps1 exec node e2e/tools/validate-fixtures.mjs
.\scripts\pnpm.ps1 exec node e2e/tools/validate-fixtures.mjs --json

# 页面诊断
.\scripts\pnpm.ps1 exec node e2e/tools/inspect-page.mjs /d/<id> --wait=3000
```

环境变量：`E2E_BASE_URL`（默认 5173）、`E2E_API_URL`（默认 3001）、`E2E_STRICT=1`（缺失能力=失败）、`E2E_ARTIFACTS_DIR`、`E2E_WEBSERVER_CMD`、`E2E_REFRESH_CAPS=1`。

> 中文显示：`playwright test --list` / 报告里中文是 UTF-8；Windows 控制台需 `chcp 65001` 或 `[Console]::OutputEncoding=[Text.Encoding]::UTF8`，否则显示成乱码（文件本身是正确的 UTF-8，已核对字节）。

## 6. 下一步（QA-03 续 / QA-04）

1. 主链路补 7–20 步：≥8 轮、共识/分歧三区、总结、回放、`/state` 三方一致性（用 `/state` + events + DOM，不 import 前端 reducer，遵 A3 裁决）。
2. SSE 断线重连/补发/去重（TC-SSE-01~12）：Node 直连可测服务端契约；前端侧等 `window.__qa.sse`。
3. 多会话隔离（TC-FR-12）：两会话 messageId 集合互斥 + mock 调用记录不含对方 messageId。
4. LLM 失败族：需要后端支持 `x-qa-scenario`（06 §1.9），实现后接 fixture。
5. 压力（5 会话/20 SSE）与安全扫描（Key/XSS/超长/CORS），门禁报告 `QA-REPORT.md`。
