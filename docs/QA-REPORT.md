# QA 最终报告（RC）

- 日期：2026-11-01
- 状态：RC 通过（P0 主链路）
- 环境：Windows 11 / Node 24.20.0 / Chrome（Playwright channel）/ SQLite WAL
- 关联：[QA-PLAN](QA-PLAN.md)、[QA-G2-REPORT](QA-G2-REPORT.md)、[REAL-SMOKE](REAL-SMOKE.md)

## 1. 结论

**P0 主链路通过，可以进入交付。** 没有未解决的 P0 缺陷；P1 有明确未实现清单，不阻塞本次 MVP。

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript 全仓 | 通过 | `pnpm typecheck` |
| 单元/组件/接口 | **162 passed**（agent 92 + web 42 + server 28） | `pnpm test` |
| Playwright E2E | **35 passed / 0 failed / 0 skipped** | `E2E_STRICT=1` |
| 真实 DeepSeek smoke | 36 轮 / 0 degraded / 184s / 7 洞察 / 30 条引用 | [REAL-SMOKE](REAL-SMOKE.md) |
| Key 扫描 | 通过 | `pnpm check:key` |
| 构建 | server + web 通过 | `pnpm build` |
| 三档布局 | 1440 三栏不重叠；1024/390 无整页滚动 | `layout.stage.spec.ts` |
| 多会话隔离 | server 集成测试覆盖 | `isolation.test.ts` |
| 5 会话 / 20 SSE 压力 | **PASS**：20 连接、0 串线、p95 2ms（mock） | [PERF-REPORT](PERF-REPORT.md) |

## 2. 覆盖范围

- 首页：列表/空态/错误态，5s 轮询，状态分流。
- 创建：2–200 码点、3–6 人、`clientRequestId` 幂等、参数校验。
- 阵容：主持人 + 专家、立场轴/极性/关注领域/颜色、确认/重生成。
- 演播厅：SSE 首包、opening、消息渲染、专家状态、洞察、总结、结束。
- 回放：时间线/播放/暂停/倍速/跳转，直播与回放共用 reducer。
- 断线/补发：`Last-Event-ID`、`stream.caught_up`、seq 跳跃回读投影。
- 布局：1440 三栏、1024 两栏、390 单栏，独立滚动。
- 安全：Key 不进入 bundle/网络/日志；错误不返回堆栈/JSON。

## 3. 关键回归

1. **BUG-01 直播页空壳**：confirm 后 16ms 已 ended，SSE 终态立即 close，前端未回读投影。修复为 confirm 后 `await refresh()` + `stream.ready` 状态不一致时 refresh；E2E 锁定。
2. **三栏重叠**：子项都写 `grid-area: stage`，媒体查询只改模板。修复 rail/stage/insights 的 grid-area；E2E 用矩形相交 + 铺满视口 + 首条消息落在 stage 区间锁定。
3. **洞察恒为 0**：agent 用会话内序号做全局主键，跨讨论撞 `insights.id`；改为 `sha256(discussionId:type:contentHash)` 派生；server 回归覆盖“同库两个讨论都有洞察且 id 不冲突”。
4. **真实模式请求参数**：`deepseek-flash` + `thinking:{type:"disabled"}` 被接受；真实 smoke 通过，无需退路。
5. **Playwright trace 中文路径 ENOENT**：产物改到 `%TEMP%\ai-panel-e2e`。

## 4. 未覆盖 / 已知限制

- **5 会话/20 SSE 压力测试已补做并通过**：20/20 连接、0 串线、0 seq 异常、5/5 ended、p95 2ms（mock）；见 [PERF-REPORT](PERF-REPORT.md)。该结果不证明真实模型吞吐。
- 真实模型只做 1 次 smoke，未做 5 议题真实 eval；行为质量以 mock eval（15/15）+ 单次真实 smoke 为证据。
- P1 未实现：导出、搜索/筛选、立场图谱、洞察跳转发言、暂停/继续、单独重生成专家。
- 限流中间件未实现（本地单人；`RATE_LIMIT_ENABLED` 默认关）。
- WebKit/Firefox 未测；只承诺 Chromium。
- 视频/语音/登录/多租户/多人协作/议题树/联网搜索为非目标。

## 5. 交付前仍需人工完成

- 重置并 seed 5 条样例，确认首页干净。
- `pnpm build` + `pnpm start` 冒烟一次。
- 生成 zip（排除 `node_modules/.git/data/.env.local`）。
- 创建 GitHub/Gitee 私有仓库并邀请指定账号。
- 按 PRD §12.4 发邮件到 `<招聘邮箱>`。
