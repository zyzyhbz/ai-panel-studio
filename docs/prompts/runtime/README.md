# 运行时 Prompt 索引（v2.0 套件，深度讨论改版）

- Owner：AI/Agent
- 实现唯一来源：`packages/agent/src/prompts/*.ts`；本目录是**同一文本的人读版**（改 prompt 必须两边一起改，并升版本号）
- 模型基线：`deepseek-flash`；**thinking 按 prompt 分配**：SPEECH/SUMMARY 开，ROSTER/DECIDE/INSIGHT 关（JSON 控制调用防推理吃空输出）；全局 `DEEPSEEK_THINKING=disabled` 可一键全关
- 清单总表与版本规则：[../00-INVENTORY.md](../00-INVENTORY.md)
- 历史版本：`archive/`（v1 的 DECIDE/SPEECH/INSIGHT/SUMMARY，仅留档，不要按它改代码）

| # | Prompt | 版本 | 输出 | 参数（temp/max/超时） | 对应需求 | 文档 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `P-ROSTER` | **1.0.0**（文本未变） | JSON | 0.9 / 1200 / 30s | AR-01、FR-03 | [P-ROSTER](P-ROSTER.v1.0.0.md) |
| 2 | `P-DECIDE` | **2.0.0** | JSON | 0.3 / 240 / 45s | AR-03、AR-05 | [P-DECIDE v2](P-DECIDE.v2.0.0.md) |
| 3 | `P-SPEECH` | **2.0.0** | 纯文本流式 | 0.8 / 1200 / 首字 20s + 总 90s | AR-02、AR-04、AR-06 | [P-SPEECH v2](P-SPEECH.v2.0.0.md) |
| 4 | `P-INSIGHT` | **2.0.0** | JSON | 0.2 / 900 / 45s | AR-07、FR-09 | [P-INSIGHT v2](P-INSIGHT.v2.0.0.md) |
| 5 | `P-SUMMARY` | **2.0.0** | 纯文本三段 | 0.5 / 1400 / 90s | AR-08、FR-10 | [P-SUMMARY v2](P-SUMMARY.v2.0.0.md) |

> 版本与代码常量 `PROMPT_VERSIONS`（`packages/agent/src/prompts/common.ts`）一一对应：
> ROSTER=1.0.0，其余四项=2.0.0。**文档缺失/版本不一致视为 bug**（Prompt 记录必须与实现同步）。

## v2 的三条结构性变化（比措辞重要）

1. **上下文最前面是「当前争论结构」**（`debateMap`）：未回应的挑战、各方当前主张、未解决张力、被回避的前提、收敛度。
   persona 退到第二位——先看"谁欠谁一个回答"，模型才不会退回角色独白。
2. **每轮发言必须落到一个具体 messageId 上**，并明确 反对/支持/有条件同意/澄清 之一，再新增一个理由/反例/边界/代价。
3. **轮次不再是目标**：`coverageFloor = min(12, 2n+2)` 只是"不能太早收"的保底，`maxTurns = 36` 是安全上限，
   真正的收束信号是 `saturation.ready`（五点全满足，见 AGENT-BEHAVIOR §16）。

## 三条硬约束（改 prompt 前先看）

1. **JSON 只出现在三类调用**（roster / decide / insight）。发言与总结是纯文本，避免流式首字是 `{"content":"`、也避免把 JSON 结构漏到 UI。
2. **prompt 里说的判定标准，必须与 `policy/` 的校验一一对应**。prompt 放宽而代码不放宽 = 模型白写；代码放宽而 prompt 不放宽 = 白白丢条目。
3. **版本号规则**：MAJOR = 输出 schema/行为语义变化（需 PM 批准）；MINOR = 上下文/规则变化；PATCH = 措辞。版本写日志，不写事件 payload。

## 与 devlog 的分工

- `runtime/`（本目录）：**产品运行时**的 prompt，由 AI/Agent 维护。
- `devlog/`：**开发过程**的 prompt（题目要求 ≥5 段，覆盖 SDD/DDD/TDD/E2E），由 PM 汇编进 `docs/PROMPT-LOG.md`。
  两者不要混放，否则交付物对不上。
