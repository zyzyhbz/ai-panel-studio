# 运行时 Prompt 索引（v1.0.0）

- Owner：AI/Agent
- 实现唯一来源：`packages/agent/src/prompts/*.ts`；本目录是**同一文本的人读版**（改 prompt 必须两边一起改，并升版本号）
- 模型基线：`deepseek-flash`，**thinking 关闭**（AR-10），`DEEPSEEK_MODEL` 可覆盖
- 清单总表与版本规则：[../00-INVENTORY.md](../00-INVENTORY.md)

| # | Prompt | 版本 | 输出 | 参数（temp/max/超时） | 对应需求 | 文档 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `P-ROSTER` | 1.0.0 | JSON | 0.9 / 1200 / 20s | AR-01、FR-03 | [P-ROSTER](P-ROSTER.v1.0.0.md) |
| 2 | `P-DECIDE` | 1.0.0 | JSON | 0.3 / 160 / 8s | AR-03、AR-05 | [P-DECIDE](P-DECIDE.v1.0.0.md) |
| 3 | `P-SPEECH` | 1.0.0 | 纯文本流式 | 0.8 / 220 / 6s+20s | AR-02、AR-04、AR-06 | [P-SPEECH](P-SPEECH.v1.0.0.md) |
| 4 | `P-INSIGHT` | 1.0.0 | JSON | 0.2 / 900 / 15s | AR-07、FR-09 | [P-INSIGHT](P-INSIGHT.v1.0.0.md) |
| 5 | `P-SUMMARY` | 1.0.0 | 纯文本三段 | 0.5 / 500 / 25s | AR-08、FR-10 | [P-SUMMARY](P-SUMMARY.v1.0.0.md) |

## 三条硬约束（改 prompt 前先看）

1. **JSON 只出现在三类调用**（roster / decide / insight）。发言与总结是纯文本，避免流式首字是 `{"content":"`、也避免把 JSON 结构漏到 UI。
2. **prompt 里说的判定标准，必须与 `policy/` 的校验一一对应**。prompt 放宽而代码不放宽 = 模型白写；代码放宽而 prompt 不放宽 = 白白丢条目。
3. **版本号规则**：MAJOR = 输出 schema/行为语义变化（需 PM 批准）；MINOR = 上下文/规则变化；PATCH = 措辞。版本写日志，不写事件 payload。

## 与 devlog 的分工

- `runtime/`（本目录）：**产品运行时**的 prompt，由 AI/Agent 维护。
- `devlog/`：**开发过程**的 prompt（题目要求 ≥5 段，覆盖 SDD/DDD/TDD/E2E），由 PM 汇编进 `docs/PROMPT-LOG.md`。
  两者不要混放，否则交付物对不上。
