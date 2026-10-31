# AI Panel Studio

> 一场由 AI 驱动、实时推进的圆桌讨论。输入议题，生成主持人与立场互补的专家，观看观点碰撞、实时共识/分歧，并完整回放。

## 状态

**G2：并行开发中**。仓库已包含可运行的单仓脚手架（Vite + Fastify + shared/agent 包），四个角色正在实现主链路。

- 截止：2026-11-02
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
packages/agent  prompt / context / policy / LLM adapter / eval
packages/shared Zod 契约、事件类型、纯 reducer
```

## 目录

```text
apps/
  web/           前端
  server/        后端
packages/
  agent/         Agent 行为与上下文
  shared/        契约与共享领域逻辑
evals/           Agent 行为评测
e2e/             Playwright 端到端测试
docs/            PRD、ER、API、SSE、Prompt、工作流
scripts/         数据库迁移/种子/检查
data/            本地 SQLite（gitignored）
```

## 快速开始

> G2 脚手架完成后生效。

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev          # web: 5173, api: 3001
```

> 本机当前 `HTTPS_PROXY` 指向不可用端口。若 `pnpm` 报 `ECONNREFUSED`，改用 `.\scripts\pnpm.ps1 install`（或 `scripts\pnpm.cmd`），该包装脚本只清空当前进程的代理变量。本机启动也用 `.\scripts\pnpm.ps1 dev`，确保 Node 24 + 正确 pnpm。

生产演示：

```bash
pnpm build
pnpm start        # Fastify 托管 API + web/dist
```

环境变量见 `.env.example`。API Key 只允许放服务端 `.env.local`，禁止 `VITE_` 前缀、禁止提交。

## 文档

- [远程作业原文](docs/00-远程作业原文.md)
- [PRD](docs/PRD.md)
- [技术选型](docs/01-技术选型.md)
- [角色与协作 SOP](docs/02-角色与协作SOP.md)
- [ER 图](docs/ER.md)
- [API 契约](docs/03-API契约.md)
- [SSE 事件契约](docs/04-SSE事件契约.md)
- [任务板](docs/TASKS.md)
- [G1 契约决议 v1.0](docs/06-G1契约决议.md)
- [工作流说明](docs/WORKFLOW.md)
- [Prompt 记录](docs/PROMPT-LOG.md)

## 角色

| 角色 | 负责 |
| --- | --- |
| PM | 需求、契约、任务、集成、交付 |
| AI/Agent | prompt、上下文、发言策略、行为 eval |
| 前端 | 演播厅 UI、交互、响应式、SSE 客户端 |
| 后端 | SQLite、API、SSE、会话运行时 |
| 测试 | 独立验收、E2E、压力、回归 |

## 非目标

视频录制、语音、登录/多租户、多人协作、云端扩展、议题树、联网搜索。详见 PRD §2.2。

## 交付

- GitHub/Gitee 源码链接
- 数据库初始化 + 5 条样例
- PRD/ER/API 文档
- Prompt 记录（≥5 段）
- 工作流说明（1–1.5 页）
- README、测试代码、测试报告
