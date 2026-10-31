# 断电暂停状态（2026-10-31 23:45）

## 原因

用户通知：2026-10-31 24:00 左右停电。已在 23:43 中断四个智能体并停止后台 dev server。

## 当前进度

- G0/G1 已完成并提交：PRD、技术选型、四角色 SOP、ER、API/SSE 基线、契约 v1.0 决议、四份设计评审。
- 单仓脚手架已提交：Vite + React、Fastify、shared/agent 包、pnpm workspace、Node 24 + better-sqlite3 安装验证、health 烟测通过。
- G2 进行中，工作区有未提交 WIP：
  - 后端：`apps/server/src/{config,db,http,lib,llm,repositories,services,session}`、`types.ts`（未完成/未联调）
  - 前端：`apps/web/src/{api,components,domain,features,lib,stores}`（未完成/未联调）
  - AI/Agent：`packages/agent/src/{context,core,llm,parse,policy,prompts,schema}`（未完成）
  - 测试：`e2e/` fixtures/helpers（fixtures 已生成，测试未跑）
- 未做：依赖变更、类型检查、构建、联调、数据库迁移、E2E。

## 恢复顺序（重要）

1. `git status` 看清 WIP；先跑 `.\scripts\pnpm.ps1 typecheck`，修编译错误，不要继续加功能。
2. 后端优先：`db:migrate` → `db:seed` → `GET /api/health` 的 `dbReady:true` → `GET /api/discussions`。
3. 前端优先：`pnpm --filter @ai-panel/web typecheck` → 首页/创建/Lobby 能跑。
4. AI：`packages/agent` 的 `LLMClient` 接口 + mock 先稳定，再接后端。
5. QA：fixtures 先校验 JSON 合法，再接 Playwright。
6. 全部通过后再提交 `feat(api)` / `feat(web)` / `test`，不要把一个巨型 WIP 留在历史里。

## 环境命令

```powershell
cd D:\AI开发\ai-panel-studio
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 --filter @ai-panel/server test
.\scripts\pnpm.ps1 --filter @ai-panel/web test
.\scripts\pnpm.ps1 dev
```

- Node 24.20.0；不要用默认 `node`（v20）或 DSH 的 Electron pnpm shim。
- 默认 `LLM_MODE=mock`；不要读 Key 文件。
- 端口：web 5173 / api 3001。

## 风险

- WIP 文件可能是“写到一半”的状态，恢复后先编译，不要假设可用。
- `e2e/tools/emit-fixtures.mjs` 是生成器，可能被补丁破坏；优先校验，不要直接跑。
- 截止仍为 2026-11-02；停电后需重新评估时间，必要时砍 P1/P2，保 P0。
