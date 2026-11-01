# 5 会话 / 20 SSE 压力测试报告

- 日期：2026-11-01
- 环境：Windows 11 / Node 24.20.0 / Fastify 5 / SQLite WAL / `LLM_MODE=mock`
- 脚本：`scripts/perf/sse-load.mjs`
- 原始结果：`data/perf-report.json`
- 结论：**PASS**

## 1. 测试方法

- 并发创建 **5 个讨论**，每个 4 位专家、`x-qa-scenario: slow`。
- 每个讨论 confirm 后，开 **4 个独立 SSE 连接**，共 **20 个连接**。
- 每个连接从 `after=0` 开始，接收完整持久化事件 + 实时 delta。
- 校验：
  - 每个事件 `data.discussionId` 必须等于本连接所属 discussion；
  - 同一连接内 `seq` 必须严格递增，不允许重复/乱序；
  - 每个会话必须有 `message.completed`、`insight.updated`、`summary.completed`、`discussion.ended`；
  - 5 个会话全部到达终态；
  - `/api/health.activeSseCount` 在 20 连接建立后应为 20；
  - 消息投递延迟：`message.completed.message.createdAt` 到客户端收到事件的时间。
- 超时：120s；实际约 **9.1s** 完成。

## 2. 结果

```text
sessions=5
connections=20 / 20
activeSseCount=20
terminated=5 / 5
failures=0
duration=9,078ms

每个会话：
  message.completed = 48（12 条 × 4 连接）
  insight.updated   = 24（6 次 × 4 连接）
  summary.completed = 4
  discussion.ended  = 4

消息投递延迟（mock）：
  samples = 240
  p95 = 2ms
  max = 4ms
```

## 3. 隔离结论

- **0 次跨会话串线**：所有事件 `discussionId` 与连接所属会话一致。
- **0 次 seq 非单调/重复**：每个连接独立校验通过。
- **5 个会话全部 ended**，均有洞察与总结。
- 20 个 SSE 连接同时存在时，服务端 `activeSseCount=20`，连接上限 8/会话未触发（4/会话）。

## 4. 结论边界

- 本次是 **mock 模式、本地单进程、SQLite WAL** 的压力测试；它证明会话隔离、SSE 并发、事件顺序、终态收敛，不证明真实 DeepSeek 的吞吐/延迟。
- 真实模型的延迟与成本由 [REAL-SMOKE](REAL-SMOKE.md) 的单场 smoke 覆盖；未做 5 会话真实 API 压测（会产生 5 倍费用与外部限流影响）。
- 未测：多机部署、HTTP/2、CDN、10+ 会话、长时间稳定性。

## 5. 复现

```powershell
cd D:\AI开发\ai-panel-studio
# 先确保 mock server 在 3001
.\scripts\pnpm.ps1 --filter @ai-panel/server dev

# 另一个终端
E:\nodejs-v24.20.0\node.exe scripts\perf\sse-load.mjs
```

可用环境变量：`PERF_SESSIONS`、`PERF_CONNECTIONS_PER_SESSION`、`PERF_TIMEOUT_MS`、`PERF_BASE_URL`。
