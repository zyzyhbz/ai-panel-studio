# AI Panel Studio

> 一场由 AI 驱动、实时推进的圆桌讨论。输入议题，生成主持人与立场互补的专家，观看观点碰撞、实时共识/分歧，并完整回放。

## 状态

**G2 完成，RC 候选**。主链路、UI、E2E、真实 DeepSeek smoke 均已跑通。

| 项 | 结果 |
| --- | --- |
| 全仓 typecheck | 通过 |
| 单测/组件/接口测试 | agent 86 + web 36 + server 19 |
| Playwright E2E | **20 passed / 0 failed / 0 skipped** |
| 5 会话 / 20 SSE 压力 | **PASS**：20 连接、0 串线、p95 2ms（mock） |
| 真实 DeepSeek smoke | 12 轮 / 6 洞察 / 27s / 总结正常 |
| Key 扫描 | 无 Key 材料进入前端产物 |
| 截止 | 2026-11-02（内部 17:00 提交） |

- 运行时：Node.js 24.20.0（`.nvmrc`）
- 技术栈：React 19 + Vite + TypeScript / Fastify 5 + TypeScript / SQLite / SSE
- 模型：DeepSeek API（默认 `deepseek-flash`，实时链路关闭 thinking）

## 这是什么

不是聊天机器人，也不是会议纪要工具，而是一个“AI 圆桌演播厅”：

- 主持人负责开场、追问、串联、收尾
- 专家根据 transcript 自主发言，不机械轮流
- 共识/分歧/待验证问题实时更新，且有发言依据
- 讨论过程可回放，直播与回放共用同一套状态还原
- 多个议题并行，事件与上下文严格隔离

## 架构

```text
apps/web        React + Vite + Tailwind
      │  REST + SSE
apps/server     Fastify + SQLite + SessionRunner
      │
packages/agent  prompt / context / policy / mock / eval
packages/shared 枚举、契约常量、纯函数
```

关键设计：

- **事件溯源**：语义事件落库；`message.delta` 只走 SSE，`message.completed` 落库。
- **直播/回放共用 reducer**：回放每次 seek 从零 reduce，不调用 LLM。
- **SSE 自管重连**：带准确 `after`，检测 seq 空洞后回读投影。
- **两套 mock**：运行期 mock 绑定 QA 钩子/日志；agent mock 只服务 eval/单测。

## 目录

```text
apps/
  web/           前端
  server/        后端
packages/
  agent/         Agent 行为与上下文
  shared/        共享枚举与常量
evals/           Agent 行为评测（5 议题）
e2e/             Playwright 端到端测试
docs/            PRD、ER、API、SSE、Prompt、工作流、审计
scripts/         数据库迁移/种子/检查
data/            本地 SQLite（gitignored）
```

## 快速开始

### 本机（Windows）

本机 `node` 默认是 v20、`pnpm` 是 DSH 的 Electron shim，直接跑会 ABI 不匹配。统一用包装脚本：

```powershell
cd D:\AI开发\ai-panel-studio
.\scripts\pnpm.ps1 install
.\scripts\pnpm.ps1 db:reset
.\scripts\pnpm.ps1 db:seed
.\scripts\pnpm.ps1 dev
```

打开 `http://127.0.0.1:5173`。默认 `LLM_MODE=mock`，无需 Key。

### 标准环境

```bash
pnpm install
pnpm db:reset
pnpm db:seed
pnpm dev
```

生产演示：

```bash
pnpm build
pnpm start        # Fastify 托管 API + web/dist
```

### 环境变量

复制 `.env.example` 为 `.env.local`（gitignored）：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LLM_MODE` | `mock` | `mock` / `real`；real 无 Key 时启动失败 |
| `DEEPSEEK_API_KEY` | 空 | 只允许服务端；禁止 `VITE_` 前缀 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容 |
| `DEEPSEEK_MODEL` | `deepseek-flash` | 实时链路 |
| `DEEPSEEK_THINKING` | `disabled` | 关闭 thinking |
| `MOCK_DELAY_MS` | `0` | mock 演示可设 `800`，看到直播过程 |
| `DATABASE_PATH` | `./data/app.db` | SQLite 路径 |
| `PORT` / `HOST` | `3001` / `127.0.0.1` | API |

> 本机 `HTTPS_PROXY` 指向不可用端口；`scripts/pnpm.ps1` 只清空当前进程代理。真实 Key 写入 `.env.local`，不提交、不打印。

### 两种演示模式

```powershell
# 1) 默认 mock：快、零成本、适合自动化
.\scripts\pnpm.ps1 dev

# 2) 真实模型：读取 .env.local 的 Key，约 30s 一场
$env:LLM_MODE="real"
.\scripts\pnpm.ps1 --filter @ai-panel/server dev
```

真实 smoke 记录见 [REAL-SMOKE.md](docs/REAL-SMOKE.md)。

## 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 + `llmMode/dbReady/activeSseCount` |
| GET | `/api/discussions` | 列表，支持 `status=all/active/ended/failed` |
| POST | `/api/discussions` | 创建 + 生成阵容，`clientRequestId` 幂等 |
| GET | `/api/discussions/:id` | 详情（experts/messages/insights/summary/activeTurn） |
| GET | `/api/discussions/:id/state` | 事件重放投影（QA 一致性用） |
| POST | `/api/discussions/:id/confirm` | 确认并开始 |
| POST | `/api/discussions/:id/end` | 结束并总结（3s 宽限） |
| POST | `/api/discussions/:id/roster/regenerate` | 重新生成阵容 |
| GET | `/api/discussions/:id/events` | 回放事件 |
| GET | `/api/discussions/:id/stream` | SSE 实时流 |

完整字段/错误码见 [API 契约](docs/03-API契约.md)、[SSE 事件契约](docs/04-SSE事件契约.md)。

## 测试

```powershell
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 test
.\scripts\pnpm.ps1 --filter @ai-panel/web build
.\scripts\pnpm.ps1 exec playwright test --config e2e/playwright.config.ts
.\scripts\pnpm.ps1 check:key
```

当前基线：

```text
agent:  86 passed
web:    36 passed
server: 19 passed
e2e:    20 passed / 0 failed / 0 skipped
```

E2E 用本机 Chrome（`channel: "chrome"`），不下载 Playwright 浏览器；产物写 `%TEMP%\ai-panel-e2e`，避免中文路径编码问题。

## 已完成能力

- 首页：进行中/待确认/最近结束；5s 轮询；空态/错误态
- 创建：2–200 字、3–6 位专家、`clientRequestId` 幂等
- 阵容：主持人 + 专家，姓名/职业/Title/立场轴/极性/关注领域/专属色
- 演播厅：SSE 流式、专家三态、transcript、共识/分歧/待验证、总结
- 回放：时间线、播放/暂停/1x/1.5x/2x、跳转，与直播共用 reducer
- 多讨论并行隔离；SQLite WAL + 事件投影；断线补发/去重
- 真实 DeepSeek smoke；mock 5 议题 eval（15/15 门禁）

## 已知限制 / 后续改进

- 真实模型只做了 1 次 smoke，未做 5 议题 × 多轮真实 eval；行为质量以 mock 基线 + 单次真实 smoke 为证据。
- 限流中间件未实现（本地单人场景，`RATE_LIMIT_ENABLED` 默认关）。
- 视频/音频录制、语音、登录/多租户、多人协作、议题树、联网搜索均为非目标。
- P1：导出、搜索/筛选、立场图谱、从洞察跳转发言、暂停/继续讨论。
- 首页空态/列表态 CTA 已统一 `data-testid="new-discussion"`。

## 文档

- [远程作业原文](docs/00-远程作业原文.md)
- [PRD v1.0](docs/PRD.md)
- [PRD 作业要求对照审计](docs/07-PRD作业对照审计.md)
- [技术选型](docs/01-技术选型.md)
- [角色与协作 SOP](docs/02-角色与协作SOP.md)
- [ER 图](docs/ER.md)
- [API 契约](docs/03-API契约.md)
- [SSE 事件契约](docs/04-SSE事件契约.md)
- [G1 契约决议 v1.0](docs/06-G1契约决议.md)
- [Agent API](docs/AGENT-API.md)
- [工作流说明](docs/WORKFLOW.md)
- [Prompt 记录](docs/PROMPT-LOG.md) / [runtime prompts](docs/prompts/runtime/README.md)
- [真实 smoke](docs/REAL-SMOKE.md)
- [5 会话/20 SSE 压力报告](docs/PERF-REPORT.md)
- [QA 报告](docs/QA-G2-REPORT.md)
- [交付清单](docs/05-交付清单.md)

## 角色

| 角色 | 负责 |
| --- | --- |
| PM | 需求、契约、任务、集成、交付 |
| AI/Agent | prompt、上下文、发言策略、行为 eval |
| 前端 | 演播厅 UI、交互、响应式、SSE 客户端 |
| 后端 | SQLite、API、SSE、会话运行时 |
| 测试 | 独立验收、E2E、压力、回归 |
