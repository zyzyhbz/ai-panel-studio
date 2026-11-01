# Agent 集成接口（给后端）v1.0

- 日期：2026-11-01
- Owner：AI/Agent 工程师
- 状态：**已可 import**（`@ai-panel/agent` 0.2.0），对应任务 AI-02 / AI-03
- 权威契约：[06-G1契约决议](06-G1契约决议.md)；行为规范：[AGENT-BEHAVIOR](AGENT-BEHAVIOR.md)；Prompt 清单：[prompts/00-INVENTORY](prompts/00-INVENTORY.md)
- 验收命令：`.\scripts\pnpm.ps1 --filter @ai-panel/agent typecheck` / `test`

---

## 0. 一句话

后端不再需要自己写 prompt 或解析 LLM 输出：**投影快照 → 调 builder → 交给 client → 用 parse 校验 → 用 policy 收口**。
本包不读 env、不读 Key、不发 HTTP；`LLMClient` 由后端注入。

```ts
import {
  buildEligibility, buildDecisionPrompt, buildSpeechPrompt, buildInsightPrompt,
  buildSummaryPrompt, parseDecisionOutput, sanitizeDecision, validateSpeech,
  parseInsightOutput, normalizeInsights, parseSummaryText, buildFallbackSummary,
} from "@ai-panel/agent";
```

---

## 1. 分工（G1 决议 §1.11）

| 部分 | Owner | 位置 |
| --- | --- | --- |
| `LLMClient` / `PromptSpec` / mock / fixtures | AI/Agent | `packages/agent/src/llm` |
| 真实 DeepSeek HTTP、超时、重试、限流、Key、错误映射 | 后端 | `apps/server/src/llm` |
| 事件/schema/DB/SSE | 后端 | `apps/server/**` |

**替换方式**（后端当前已有同形实现，改动只有 3 处，调用点不动）：

1. `apps/server/src/llm/types.ts` → 删掉本地定义，改成
   ```ts
   export * from "@ai-panel/agent";
   ```
   本包的 `LLMClient` / `PromptSpec` / `LlmMockMeta` / `MockScenario` / `LlmError` **字段与后端现有本地定义完全一致**（`json()` / `stream()` / `mode` / `model`），所以 `mock.ts`、`deepseek.ts` 无需改。
2. `apps/server/src/llm/prompts.ts` → 改成从 `@ai-panel/agent` 转出 builder（见 §5 的入参映射），删 `prompts.shim.ts`。
3. 可选：`apps/server/src/llm/fixtures.ts` 可以继续用；本包的 `TOPIC_FIXTURES` 是给 eval 的 5 个议题，两者不冲突。

> 注意：`PromptSpec` 增加了若干**可选**字段（`id/version/timeoutMs/estimatedInputTokens/includedMessageIds/thinking`）。
> 后端按 `spec.thinking` 转发；全局 `DEEPSEEK_THINKING=disabled` 优先。JSON 控制调用（ROSTER/DECIDE/INSIGHT）默认关 thinking，SPEECH/SUMMARY 默认开。

### 1.1 mock 分工（PM 已裁决 2026-11-01）

| mock | 位置 | 用途 | 备注 |
| --- | --- | --- | --- |
| 运行时 mock | `apps/server/src/llm/mock.ts`（后端） | 产品运行期 `LLM_MODE=mock` | 绑定 `QA_LLM_LOG`、`x-qa-scenario`、seed 数据；**继续保留，不替换** |
| 评测 mock | `packages/agent/src/llm/mock-client.ts`（本包） | `evals/` 与单测 | 5 个议题 fixture，故障注入；不依赖 server、不写日志文件 |

结论：

- **不要让后端切到本包 mock**，两套目的不同，不算重复实现；
- 契约 §1.11 "mock 在 agent" 已满足（本包确实提供实现），但运行期仍以后端 mock 为准；
- 唯一的硬要求：两边实现同一个 `LLMClient` 接口，将来若要合并，只需换注入点。

---

## 2. `PromptSpec`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | `roster\|decision\|speech\|insight\|summary` | ✓ | 调用类型 |
| `system` / `user` | `string` | ✓ | 直接拼成两条 message |
| `responseFormat` | `text \| json_object` | ✓ | roster/decision/insight 为 json |
| `temperature` / `maxOutputTokens` | `number` | ✓ | 已按类型预设 |
| `id` | `P-ROSTER` … | | 日志用 |
| `version` | `"2.0.0"`（ROSTER 仍 `1.0.0`） | | 日志用，**不要写进事件 payload**；与 `docs/prompts/runtime/` 文件名一一对应 |
| `timeoutMs` | `number` | | 建议超时 |
| `estimatedInputTokens` | `number` | | 预算核对用（≤3.5k） |
| `includedMessageIds` | `string[]` | | QA_LLM_LOG.includedMessageIds |
| `thinking` | `"enabled" \| "disabled"` | | 按 prompt 分配：SPEECH/SUMMARY 开，ROSTER/DECIDE/INSIGHT 关；全局 disabled 优先 |

---

## 3. `LLMClient` 契约

```ts
interface LLMClient {
  readonly mode: "mock" | "real";
  readonly model: string;
  json<T>(req: LlmJsonRequest<T>): Promise<LlmJsonResult<T>>;
  stream(req: LlmStreamRequest): AsyncGenerator<string, LlmStreamResult, void>;
}
```

- `req.parse` **抛错 = 触发修复重试**。第一次 parse 失败时，client 用同一 `PromptSpec` 再问一次（可附带错误摘要），成功后 `repaired: true`。
- 失败必须抛 `LlmError`，`kind ∈ timeout | invalid_output | empty_output | network | auth | aborted`。
- `stream` 逐段 `yield` 增量文本；首 token 超时用 `firstTokenTimeoutMs`，整体用 `totalTimeoutMs`。
- **不得**把 `reasoning_content` 拼进增量；provider 返回了也要丢弃。

---

## 4. 输入：`DiscussionSnapshot`

后端把 DB 投影成这个结构（只读、无副作用）：

```ts
interface DiscussionSnapshot {
  discussionId: string;
  topic: string;
  expertCount: number;          // experts.filter(role==='expert').length
  status: DiscussionStatus;
  turnCount: number;            // completed 的发言数，含主持
  plannedTurns: number;         // plannedTurnsFor(expertCount)
  maxTurns: number;             // maxTurnsFor(expertCount)
  experts: ExpertPersona[];     // 含 host（role='host'）
  messages: TranscriptMessage[];// 按 turnIndex 升序，只含 completed
  insights: InsightItem[];      // 当前快照
  summary?: string | null;
}
```

字段映射（DB → agent）：

| agent 字段 | DB 列 | 备注 |
| --- | --- | --- |
| `ExpertPersona.focusArea` | `experts.focus_area` | 原 `focus` 改名 |
| `ExpertPersona.stanceAxis` | `experts.stance_axis` | v1.0 新增 |
| `ExpertPersona.polarity` | `experts.polarity` | 5 值枚举 |
| `ExpertPersona.color` | `experts.color` | hex |
| `TranscriptMessage.charCount` | `messages.char_count` | 落库前由 `validateSpeech` 提供 |
| `TranscriptMessage.targetMessageId` | `messages.target_message_id` | 可空 |
| `TranscriptMessage.references` | `messages.references_json` | 可空，JSON 数组 |
| `TranscriptMessage.degraded` | `messages.degraded` | 0/1 |
| `InsightItem.firstSeenTurn` | `insights.first_seen_turn` | v1.0 新增 |

> `insights.status` 已按 v1.0 删除，本包不读也不写。

---

## 5. 五类调用（含入参映射）

### 5.1 阵容 `P-ROSTER`

```ts
const spec = buildRosterPrompt({ topic, expertCount, avoidNames });
const { value } = await client.json({
  prompt: spec, signal, timeoutMs: spec.timeoutMs ?? 20_000,
  parse: (raw) => parseRosterOutput(raw),   // 失败抛 AgentParseError → client 自动修复重试
  meta,
});
const roster = normalizeRoster(value, { expertCount, avoidNames }); // → color hex / 去重 / 多样性告警
// roster.host / roster.experts 可直接入库；roster.needsRetry === true 时建议再生成一次
```

- 输入：`topic`（2–200 字）、`expertCount`（3–6）、`avoidNames?`。
- 输出：`RosterOutput`（`host` + `experts`）。
- 颜色：`colorKey`（调色板）与 `color`（hex）**二选一**；后端既有 fixtures 用 hex，可直接通过。
- `normalizeRoster` 负责：id 分配（`e_host` / `e_1..e_n`）、hex 解析、姓名去重、颜色去重、多样性告警。
- 失败降级：`roster.degraded === true` 表示用过模板位；`needsRetry === true` 建议重试一次，仍失败就直接用（不阻塞建局）。

### 5.2 发言决策 `P-DECIDE`

```ts
const snapshot = projectDiscussion(...);
const eligibility = buildEligibility(snapshot);      // allowedSpeakers / 义务 / 收尾判定
const spec = buildDecisionPrompt({ snapshot, eligibility });
const { value } = await client.json({
  prompt: spec, signal, timeoutMs: spec.timeoutMs ?? 8_000,
  parse: parseDecisionOutput, meta,
});
const { decision, repaired, issues } = sanitizeDecision(value, snapshot, eligibility);
// decision 一定合法：speakerId ∈ eligibility.allowedSpeakers
```

- `eligibility.mustClose === true` 时，`sanitizeDecision` 会强制 `intent=summary` 且 speaker 为主持人。
- 决策失败**不要重试第二次**：直接
  ```ts
  import { selectFallbackSpeaker } from "@ai-panel/agent";
  const { decision } = selectFallbackSpeaker(snapshot, eligibility);
  ```
- 公开给事件的字段：`decision.speakerId / intent / turnFocus / targetMessageId / references`。
  **`reasonCode` 只进日志，绝不进事件或 UI。**

### 5.3 发言 `P-SPEECH`

```ts
const speaker = snapshot.experts.find(e => e.id === decision.speakerId)!;
const spec = buildSpeechPrompt({ snapshot, decision, speaker });
let buffer = "";
for await (const delta of client.stream({ prompt: spec, signal, firstTokenTimeoutMs: 6_000, totalTimeoutMs: 20_000, meta })) {
  buffer += delta;
  emit("message.delta", { messageId, speakerId: speaker.id, delta, turnIndex });
}
const check = validateSpeech(buffer, { recent: snapshot.messages.slice(-3), isHost: speaker.role === "host" });
// check.text 写 message.completed.message.content；check.charCount 同名字段；
// check.ok === false → degraded = true（repeated / meta / too_long 等）
```

- 主持人单条上限 60 字，专家 120 字，`validateSpeech` 已按 `isHost` 处理。
- **不要**在这里再调一次模型做"改写"：截断/清洗已经足够，重写会引入新内容。

### 5.4 共识 `P-INSIGHT`

```ts
const spec = buildInsightPrompt({ snapshot, maxNew: 2 });
const { value } = await client.json({ prompt: spec, signal, timeoutMs: 15_000, parse: parseInsightOutput, meta });
const result = normalizeInsights(value.insights, snapshot, { turnIndex: snapshot.turnCount + 1 });
// result.insights 是全量快照（含 stable id、firstSeenTurn）；result.rejected 记录被丢原因
emit("insight.updated", { insights: result.insights });
```

- 校验内容包括：证据 id 必须在 `snapshot.messages` 内、共识/分歧需 ≥2 位不同发言者、数字必须可溯源、与已有条目去重、每类上限 8/6/6、本轮新增 ≤2。
- **失败保留上一版快照，不推空**；首 2 轮允许空。
- **"洞察恒为 0 条"怎么排查**：把 `result.rejected` 用 `summarizeInsightRejections()` 压成一行写日志，常见的三种：
  - `evidence_unknown`：模型给了不存在的 messageId（多半是 prompt 没带 id，或 mock 自己编 id）；
  - `need_two_speakers`：共识/分歧只有一位发言者的证据；
  - `over_max_new`：一次刷新想塞超过 2 条同类（按类型分别计上限）。
- 触发频率：每 2 条专家发言一次 + 收尾前一次；必须早于 `discussion.ended`。

### 5.5 总结 `P-SUMMARY`

```ts
const spec = buildSummaryPrompt({ snapshot, closingLine });
let text = "";
for await (const delta of client.stream({ prompt: spec, signal, firstTokenTimeoutMs: 6_000, totalTimeoutMs: 25_000, meta })) text += delta;
try {
  const summary = parseSummaryText(text);       // 有 JSON 痕迹会抛 AgentParseError
  emit("summary.completed", { summary: { content: summary.content, isFallback: false } });
} catch {
  emit("summary.completed", { summary: { content: buildFallbackSummary(snapshot), isFallback: true } });
}
```

- 模板总结**只重排既有 insights**，不引入新主张，可直接落库。
- 最终 `summary` 都不能生成时，契约允许 `summary: null` 的 `discussion.ended`。

---

## 6. 失败 → 行为对照

| 现象 | 判定 | 后端动作 |
| --- | --- | --- |
| `LlmError(kind=timeout)` | 超时 | 决策：走 `selectFallbackSpeaker`；发言：`turn.aborted(reason=llm_timeout)`；共识：保留旧快照；总结：`buildFallbackSummary` |
| `LlmError(kind=invalid_output)` | 两次 parse 都失败 | 同上，按阶段降级；**不要**让会话停在 live |
| `LlmError(kind=empty_output)` | 空内容 | 同上 |
| `sanitizeDecision` 返回 `repaired=true` | 决策被修正 | 正常继续，`issues` 只写日志 |
| `validateSpeech().ok=false` | 超长/重复/元叙述 | 继续落库，`message.degraded=true` |
| `normalizeInsights().rejected.length>0` | 部分条目被丢 | 推剩余全量快照，记指标 |
| `parseSummaryText` 抛错 | JSON 泄漏/过短 | 重试 1 次 → 模板总结（`isFallback=true`） |

连续失败计数在**后端**：同一会话连续 3 次任意阶段失败 → 强制 `summarizing`（模板总结）→ `ended`。

---

## 7. 约束与红线

- 本包**不读** `process.env`、**不读** Key、**不发** 网络请求、**不碰** DB/SSE。
- `Scheduler` / `ContextAssembler` / `Guard` 都是纯函数：同一 `snapshot` 输入必须得到同一输出（已用稳定哈希替代随机）。
- `reasoning_content`、决策理由、候选打分**永远不出本包**（`sanitizeDecision` 只返回公开字段）。
- 每轮上下文预算：决策 2.6k / 发言 3.0k / 共识 2.4k / 总结 3.5k tokens（`estimatedInputTokens` 可核对）。

---

## 8. 最小可运行示例（一轮）

```ts
const snapshot = projectDiscussion(discussionId);
const eligibility = buildEligibility(snapshot);

// 1) 决策
const decisionSpec = buildDecisionPrompt({ snapshot, eligibility });
const { value: rawDecision } = await client.json({
  prompt: decisionSpec, signal, timeoutMs: 8_000, parse: parseDecisionOutput, meta,
});
const { decision } = sanitizeDecision(rawDecision, snapshot, eligibility);

// 2) 落 turn.started（messageId 预分配）
const messageId = newMessageId();
appendEvent("turn.started", {
  turnIndex: snapshot.turnCount + 1,
  speakerId: decision.speakerId,
  messageId,
  intent: decision.intent,
  turnFocus: decision.turnFocus,
  targetMessageId: decision.targetMessageId,
  references: decision.references,
});

// 3) 发言
const speaker = snapshot.experts.find((e) => e.id === decision.speakerId)!;
const speechSpec = buildSpeechPrompt({ snapshot, decision, speaker });
let text = "";
for await (const delta of client.stream({ prompt: speechSpec, signal, firstTokenTimeoutMs: 6_000, totalTimeoutMs: 20_000, meta })) {
  text += delta;
  broadcastDelta(messageId, delta);
}
const check = validateSpeech(text, { recent: snapshot.messages.slice(-3), isHost: speaker.role === "host" });
appendMessage({ id: messageId, content: check.text, charCount: check.charCount, degraded: !check.ok, ... });
appendEvent("message.completed", { message: { ... } });
```

---

## 9. 已知未完成（AI 侧）

| 项 | 状态 | 影响 |
| --- | --- | --- |
| `evals/` 基线脚本 | ✅ 已完成（`evals/run.ts`，5 议题 15 项门禁全通过） | — |
| `docs/prompts/runtime/*.md` 全文 | ✅ 已完成（5 份 + README） | — |
| 真实模型 smoke | ⛔ 未做（不读 Key，由后端在 `real` 模式跑） | 需要一次真实链路验证 + AI-04 调优 |
| `turn.aborted` 触发后的 `turnCount` 对账 | 属后端 runner 职责 | 契约 §1.3 已定：aborted 不计入 |

---

## 10. 深度讨论改版（v2，2026-11-01）

> 本节优先于前文冲突处（尤其 §5.2 决策、§5.5 总结、轮次口径）。

### 10.1 轮次：不再是目标，只有"保底"和"上限"

```ts
coverageFloorFor(n) = min(12, 2 * n + 2)   // n=3→8, n=4→10, n=5→12, n=6→12
MAX_TURNS = 36
```

- `plannedTurns` 字段**不再参与收束判定**，只作 UI 的"覆盖保底"提示；`planText` 已改成「覆盖保底 x / 安全上限 36」。
- `turnIndex <= coverageFloor` 时 `canClose=false`，即使饱和也不许收。
- `turnIndex >= 36` → `mustClose=true`（`closeReason="hard_cap"`），总结必须列出未解决争点。

### 10.2 收束信号：`saturation.ready`（五项全满足）

```ts
interface Saturation {
  ready: boolean;
  reasons: string[];              // 未满足项，可直接进日志/prompt
  openChallengeCount: number;     // 全部未回应挑战
  blockingChallengeCount: number; // 最近 4 轮内、未承认的挑战（只有它阻塞收束）
  acceptedUnresolved: string[];   // 允许带进总结的"仍未解决"
  newClaimTurns: number;          // 最近 4 轮有新洞察的轮数
  expertsSpokenTwice: number;
  unresolvedTensions: number;     // 旧的未解决张力（不阻塞）
  newTensionCount: number;        // 最近 4 轮新增张力（阻塞）
  hostPressed: boolean;           // 主持人做过 probe 或 mediate
}
```

1. 每位专家 ≥2 次；
2. `blockingChallengeCount === 0`（**超窗口的旧挑战不阻塞**，进 `acceptedUnresolved`）；
3. 最近 4 轮没有新洞察；
4. 最近 4 轮没有**新增**张力（旧 divergence/open 允许保留）；
5. 主持人已做过张力指认/追问。

`mustClose = (turnIndex >= 36) || (canClose && saturation.ready)`。

### 10.3 `action=close`

- 模型可以输出 `action:"close"`，但只有 `eligibility.mustClose === true` 时才被接受（主持人 + `summary`）；
- 否则 `sanitizeDecision` 记 `CLOSE_NOT_ALLOWED` 并把 action 改回 `next`；
- 后端 runner 建议：只在 `mustClose` 时把这一轮交给主持人收尾，不要自己按轮数硬切。

### 10.4 决策的新优先级

`sanitizeDecision` 的兜底 `selectFallbackSpeaker` 已改为：**优先让"欠一个回答"的人接账**
（`eligibility.prioritySpeakerIds`，权重 3.2），并返回 `reasonCode="answer_challenge"` + 指向挑战消息的
`targetMessageId`。决策 prompt 里同样把这一条放在第 1 优先级。

### 10.5 `turnFocus` 规则变严

- 4–24 字，必须是**争点/问题**：以 `？` 结尾，或含 是否/该不该/到底/谁/为什么/怎么/能不能/A 还是 B；
- 名词标签（"岗位结构"）会被改写为「立场轴？」并记 `FOCUS_INVALID`；
- `decisionOutputSchema` 的 `turnFocus` 上限已从 20 改到 24。

### 10.6 thinking 与超时

| 项 | v2 |
| --- | --- |
| thinking | SPEECH/SUMMARY `enabled`；ROSTER/DECIDE/INSIGHT `disabled`；全局 `DEEPSEEK_THINKING=disabled` 优先 |
| decision 超时 | 45s |
| speech 超时 | 首 token 20s / 总 90s |
| insight 超时 | 45s |
| summary 超时 | 90s |
| roster 超时 | 30s |

公开状态只显示"思考中"：`reasoning_content` 仍必须在 adapter 层剥离，永不进入 `content`/事件/日志。

### 10.7 总结

`buildSummaryPrompt` 会把 `saturation.acceptedUnresolved` 注入为「仍未解决（第 3 段必须点到 1–2 条）」；
到 36 轮硬收时额外要求说明"哪些问题没被解决"。模板兜底 `buildFallbackSummary` 不变。

---

## 11. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1.0 | 2026-11-01 | 对齐后端既有 `LLMClient`/`PromptSpec` 形状，五类 builder + parse + policy 全部可 import |
| v2.0 | 2026-11-01 | 深度讨论改版：debateMap、saturation 收束、coverageFloor/36 上限、action=close、thinking + 新超时、turnFocus 争点化 |
