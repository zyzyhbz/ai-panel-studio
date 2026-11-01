# Prompt 清单（运行时）v1.0

- 日期：2026-11-01（v0.1 为 2026-10-31 草案）
- Owner：AI/Agent 工程师
- 状态：**五类全部落地**。本文是索引；全文见 [`runtime/`](runtime/README.md)，代码实现见 `packages/agent/src/prompts/*.ts`
- 关联：[Agent 行为规范](../AGENT-BEHAVIOR.md)、[AGENT-API](../AGENT-API.md)、[PRD](../PRD.md) §7、[SSE 契约](../04-SSE事件契约.md)、[技术选型](../01-技术选型.md) §6
- 模型基线：`deepseek-flash`，**thinking 关闭**，`DEEPSEEK_MODEL` 可覆盖，**禁止硬编码**

## 0.0 目录（已按 PM 裁决落地）

```text
docs/prompts/
├── 00-INVENTORY.md      # 本文件：索引 + 参数基线 + 版本规则
├── runtime/             # 生产运行时 prompt 全文（5 份 + README）
│   ├── P-ROSTER.v1.1.0.md
│   ├── P-DECIDE.v2.0.0.md
│   ├── P-SPEECH.v2.0.0.md
│   ├── P-INSIGHT.v2.0.0.md
│   ├── P-SUMMARY.v2.0.0.md
│   └── archive/         # 旧版本留档
└── devlog/              # 开发过程 prompt（题目要求 ≥5 段，PM 汇编进 PROMPT-LOG）
    └── 01-g2-agent-package.md
```

---

## 0. 先厘清一个交付物陷阱

题目要求"核心 Prompt 记录文档（≥5 段，覆盖 SDD/DDD/TDD/E2E）"记录的是**引导 AI 写代码的开发过程 prompt**，不是本文件里的运行时 prompt。[PRD](../PRD.md) §12 把两者都映射到 `docs/prompts/`，容易混淆。建议目录分层（**需 PM 确认**）：

```text
docs/prompts/
├── 00-INVENTORY.md          # 本文件：运行时 prompt 清单（AI/Agent owner）
├── runtime/                 # 运行时 prompt 全文 P-*.md（AI/Agent owner，AI-02 填充）
└── devlog/                  # 开发过程 prompt 原文 ≥5 段（PM 汇编进 PROMPT-LOG.md）
```

理由：交付物检查表（[05-交付清单](../05-交付清单.md) §3）要求"Prompt 记录 ≥5 段，覆盖 SDD/DDD/TDD/E2E"；如果 `docs/prompts/` 里混着 5 个运行时 prompt，评阅时会对不上。

---

## 1. 五类 Prompt 总表（v2，深度讨论改版）

| # | ID | 名称 | 输出形态 | 调用时机 | 次数/场（n=4，最长 36 轮） | 对应需求 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `P-ROSTER@v1.1.0` | 阵容生成（按议题删题测试） | JSON | 创建/重生成 | 1（+≤2 修复） | AR-01、FR-03 |
| 2 | `P-DECIDE@v2.0.0` | 发言决策 | JSON | 每轮开头 | ≤36 | AR-03、AR-05 |
| 3 | `P-SPEECH@v2.0.0` | 专家发言 | 纯文本流式 | 每轮 | ≤30 | AR-02/04/06、FR-06/08 |
| 3b | `P-SPEECH/host@v2.0.0` | 主持发言（同族变体） | 纯文本流式 | 开场/追问/串联/转向/收尾 | ≤6 | AR-02、FR-06/10 |
| 4 | `P-INSIGHT@v2.0.0` | 共识/分歧提炼 | JSON | 每 2 条专家发言 + 收尾前 | ≤16 | AR-07、FR-09 |
| 5 | `P-SUMMARY@v2.0.0` | 总结 | 纯文本三段 | `saturation.ready` 或到 36 轮 | 1 | AR-08、FR-10 |

> v2 变化：决策按"谁欠谁一个回答"选人（`answer_challenge`/`pressure_test`）；发言必须回应具体 `messageId` 并新增一个理由/反例/边界/代价；总结要把"仍未解决"写进第 3 段。全文见 [runtime/](runtime/README.md)。
> 轮次不再是目标：`coverageFloor=min(12,2n+2)` 保底、`saturation.ready` 决定收束、36 是安全上限。

> `P-SPEECH/host` 与 `P-SPEECH` **共用输出 schema 与后置校验**，只换"角色段 + 任务段"，因此算一类（五类），不算第六类。理由：分成两个 ID 会让"1–2 句/≤120 字"这类规则在两处漂移；实测两者的输出约束完全一致，仅分型指令不同。

**为什么发言不用 JSON**：JSON 包装会让流式首字变成 `{"content":"`，前端必须先剥壳，断流时还会留下半截 JSON。AR-04 的长度约束用**后置校验**（句数/字数/重复）保证，成本为零，且不牺牲首字延迟。

---

## 2. 通用参数与调用策略（v2）

| 参数 | P-ROSTER | P-DECIDE | P-SPEECH | P-INSIGHT | P-SUMMARY |
| --- | --- | --- | --- | --- | --- |
| model | `deepseek-flash` | 同 | 同 | 同 | 同 |
| thinking | enabled（advisory） | enabled | enabled | enabled | enabled |
| `response_format` | `json_object` | `json_object` | 无 | `json_object` | 无 |
| temperature | 0.9 | 0.3 | 0.8 | 0.2 | 0.5 |
| `max_tokens` | 1200 | 160 | 220 | 900 | 500 |
| 输入预算 | 1.5k | 2.6k | 3.0k | 2.4k | 3.5k |
| 超时 | 30s | **45s** | **20s 首字 / 90s 总** | **45s** | **90s** |
| 重试 | 1 次（+1 次修复） | 1 次，随后规则兜底 | 1 次（缩短上下文） | 1 次 | 1 次，随后模板 |
| 流式 | 否 | 否 | 是 | 否 | 是（可选） |

> v2 起真实模式开 `DEEPSEEK_THINKING=enabled`，超时整体放宽（详见 `runtime/README.md`）。
> `PromptSpec.thinking` 是给 transport 的建议字段，mock 忽略。

工程约定：

- **JSON mode 的已知坑**：DeepSeek 在 JSON mode 下若无法识别格式可能返回**空白 content**，必须当"空输出"处理（重试 1 次），不能 `JSON.parse("")` 崩掉。
- prompt 里必须出现 "json" 字样 + 一个示例对象（这是 JSON mode 的官方要求）。
- **稳定前缀**：`system` 段（角色+规则+输出契约）放最前且逐字不变，`topic` 之后才变化，以利上下文缓存命中。
- 每次调用记录结构化日志：`stage / promptVersion / model / latencyMs / promptTokens / completionTokens / ok / retryIndex`。**不记 prompt 全文、不记 Key**；`AGENT_DEBUG_PROMPTS=1` 时才落本地 debug 文件。
- prompt 版本写日志，**不写事件 payload**（避免契约膨胀）。

---

## 3. 五类输入 / 输出 / 校验

### 3.1 `P-ROSTER@v1.1.0`

| 项 | 内容 |
| --- | --- |
| 输入槽位 | `topic`、`expertCount`、`colorPalette`（8 个 key）、`namePoolHint`（可选）、`avoidNames`（已用名，重生成时） |
| 输出 | `{ host: Persona, experts: Persona[] }`，`Persona` 见 [行为规范 §2.1](../AGENT-BEHAVIOR.md) |
| 校验 | 人数=expertCount；名唯一且 2–4 字；`colorKey` 唯一；四维多样性（轴/极性/维度/风格）；`stance` ≤40 字 |
| 失败 | 局部修复 → 修复重试（回灌 Zod 错误）→ 模板阵容（`degraded`） |
| 关键约束 | 主持人必须中立；**必须至少 1 人在反对侧**；不得使用真实公众人物姓名；不得让 4 人共用同一 `stanceAxis` |

### 3.2 `P-DECIDE@v2.0.0`（v1 需求摘要，v2 细节见 [runtime/P-DECIDE.v2.0.0](runtime/P-DECIDE.v2.0.0.md)）

| 项 | 内容 |
| --- | --- |
| 输入槽位 | `topic`、`turnIndex/totalTarget/hardCap/phase`、`hostQuotaUsage`、`neverSpoken`、`mustClose`、`personaLines`（打乱顺序）、`transcriptWindow`、`insights`、`allowedSpeakers`（含已发言次数/连续次数/最近意图） |
| 输出 | `{ speakerId, intent, targetMessageId?, focus, action, reasonCode }` |
| 校验 | `speakerId ∈ allowedSpeakers`；`intent` 在该角色允许集内；`targetMessageId` 存在且非本人（`clarify` 例外）；`focus` ≤20 字且无元叙述词；`action=close` 需 `shouldClose` 为真 |
| 失败 | **不重试第二次**，直接规则 fallback（§4.5）。理由：决策是最频繁调用，二次重试的延迟代价大于收益 |
| 关键约束 | 候选顺序打乱（防轮转）；`reasonCode` 只进日志，绝不进事件 |

### 3.3 `P-SPEECH@v2.0.0`（expert；v2 细节见 [runtime/P-SPEECH.v2.0.0](runtime/P-SPEECH.v2.0.0.md)）

| 项 | 内容 |
| --- | --- |
| 输入槽位 | `name/profession/title/stance/stanceAxis/polarity/style/focus`、`topic`、`turnIndex/totalTarget`、`intent`（+人话解释）、`targetQuote`（≤40 字）、`transcriptWindow`、`insights`、按 intent 分型的 `intentRule` |
| 输出 | 纯文本，1–2 句，≤120 字 |
| 校验 | 句数/字数/重复（3-gram Jaccard）/指代/格式清洗；见 [行为规范 §8.3](../AGENT-BEHAVIOR.md) |
| 失败 | 一次缩短上下文重试 → 换人 → `turn.aborted`；**不生成本地模板发言**（冒名会污染证据链） |

### 3.3b `P-SPEECH/host@v2.0.0`

同族变体：换"角色段"（中立主持）与"分型段"（opening/probe/mediate/redirect/summary 各一段指令），输出仍是纯文本、≤60 字。

| 分型 | 关键指令要点 |
| --- | --- |
| opening | 一句话点题 + 一个可争论切口 + 点名 2–3 人；不复述议题原文 |
| probe | 引用对方 ≤15 字原话 + 具体追问角度（举证/边界/反例/代价） |
| mediate | 点名 2 人 + 各复述 ≤15 字 + 指出冲突轴 + 把球抛给某人；不站队 |
| redirect | 指出"还没人谈 X" + 点名未发言者 |
| summary | 只讲"争出了什么/还差什么"，不复述逐人观点；≤60 字 |

### 3.4 `P-INSIGHT@v2.0.0`（v2 细节见 [runtime/P-INSIGHT.v2.0.0](runtime/P-INSIGHT.v2.0.0.md)）

| 项 | 内容 |
| --- | --- |
| 输入槽位 | `topic`、`transcriptWindow`（带 id）、`existingInsights`（含 id/type/content/evidence/axis/firstSeenTurn）、`maxNew`（本轮允许新增条数） |
| 输出 | `{ insights: [{id?, type, content, axis?, evidenceMessageIds, status, firstSeenTurn}] }` 全量快照 |
| 校验 | evidence id ⊆ 已提供的 id；`type` 3 值；`content` ≤50 字无第一人称；`divergence` 需 ≥2 人证据；数字必须在证据原文出现；与旧条目 3-gram 去重 |
| 失败 | 保留上一版快照（**不推空**），记 `insight_rejected` 指标 |

### 3.5 `P-SUMMARY@v2.0.0`（v2 细节见 [runtime/P-SUMMARY.v2.0.0](runtime/P-SUMMARY.v2.0.0.md)）

| 项 | 内容 |
| --- | --- |
| 输入槽位 | `topic`、`insights`（最终快照）、`hostClosingLine`（可选，避免重复）、`turnCount` |
| 输出 | 纯文本 3 段（共识 / 分歧 / 未决），180–320 字 |
| 校验 | 无 JSON 痕迹（`{"`、`content:`、`evidenceMessageIds`）；段数=3；某类为空时必须有"没有形成明确共识"一类明说 |
| 失败 | 重试 1 次（更短上下文）→ **模板总结**（由 insights 拼自然语言，`degraded=true`） |

---

## 4. 版本管理

```text
命名：P-<NAME>@v<MAJOR>.<MINOR>.<PATCH>      文件：docs/prompts/runtime/P-DECIDE.v1.0.0.md
MAJOR：输出 schema / 行为语义变化（影响 AR/AC）→ 必须 PM 批准 + 全量 eval
MINOR：上下文、规则、分型指令变化（不改 schema）→ AI 自主，跑 eval 后记录
PATCH：措辞/示例微调 → AI 自主，跑 1 次 smoke
```

每个 prompt 文件必须包含：目的、输入槽位表、输出 schema、约束与反例、对应 AR、最近一次 eval 结果、变更原因。

**一次改动的闭环**：改 → `pnpm eval --mock`（必过）→ `pnpm eval --real --suite=core`（对比基线）→ 记 `docs/prompts/runtime/CHANGELOG.md` → 若指标回退则回滚。

冻结：**2026-11-02 10:00 行为冻结**后只允许 PATCH 级修 bug，禁止调风格。

---

## 5. 骨架 A：`P-DECIDE`（发言决策）

> 这是骨架，不是最终稿。占位符 `{{...}}`，实际由 `buildDecisionPrompt()` 填充。

```text
# 你的工作
你是「AI 圆桌」的调度器。你只决定：下一位谁发言、以什么作用力发言。
你不写发言内容，不解释理由。

# 议题
{{topic}}

# 本场规格
当前是第 {{turnIndex}} 轮，预计共 {{totalTarget}} 轮（硬上限 {{hardCap}} 轮）。
阶段：{{phase}}              # 铺开 / 碰撞 / 深化 / 预收
主持配额：开场 {{hostOpeningUsed}}/1，追问 {{hostProbeUsed}}/1，串联 {{hostMediateUsed}}/1，收尾 {{hostSummaryUsed}}/1
尚未发言：{{neverSpoken}}
现在必须收尾：{{mustClose}}   # true 时只能选主持人，且 intent 必须是 summary

# 参会者（顺序已打乱，不代表优先级或发言次序）
{{personaLines}}
# 每行格式：id｜姓名｜职业/Title｜立场｜轴/极性｜风格

# 最近发言（新→旧，最多 8 条）
{{transcriptWindow}}
# 格式：[m_03] 周明(反驳)：……

# 当前共识 / 分歧（可被引用为 target）
{{insights}}

# 可选发言者（只能从中选）
{{allowedSpeakers}}
# 每行：id｜姓名｜已发言次数｜连续次数｜上一次意图

# 规则
1. speakerId 必须是 allowedSpeakers 中的 id，不能选别人。
2. 同一专家不连续发言超过 1 次；主持人追问同一人时才允许 2 次。
3. 有专家一次都没发言、且已过第 2 轮时，优先选他。
4. rebut / support / clarify 必须给 targetMessageId，指向具体某条发言（clarify 可指自己）。
5. focus 是本轮关注点：不超过 20 字，名词短语，例如「岗位结构的变化速度」。
   不要写「我认为」「先分析」「因为…所以」这类思考过程。
6. 不要按名单顺序或编号顺序选人，要跳着选，并让不同作用力交替出现。
7. 只输出一个 JSON 对象，不要 markdown，不要解释。

# 输出 JSON
{"speakerId":"e_02","intent":"rebut","targetMessageId":"m_03",
 "focus":"岗位结构的变化速度","action":"next","reasonCode":"direct_clash"}

intent 取值：opening|probe|mediate|redirect|rebut|support|extend|clarify|summary
action 取值：next|close
reasonCode 取值：fresh_voice|direct_clash|fills_gap|follow_up|closing
```

配套的 `buildDecisionPrompt` 契约：

```ts
buildDecisionPrompt(input: DecisionPromptInput): PromptSpec
// input 里的 allowedSpeakers 已经过 Guards 过滤，模型无权绕过；
// 若返回的 speakerId 不在集合内，直接走 selectFallbackSpeaker()，不再问模型。
```

---

## 6. 骨架 B：`P-SPEECH`（专家发言）

> 同样只是骨架。`intentRule` 由 `intent` 分支注入，共 4 段（rebut/support/extend/clarify）。

```text
# 你是谁
{{name}}，{{profession}}，{{title}}。
你的立场：{{stance}}
你的关注点：{{focus}}（争议轴：{{stanceAxis}}；位置：{{polarity}}；论证风格：{{style}}）
你不是助手，你就是这位嘉宾。你在一个圆桌现场，别人能听见你，你也能听见别人。

# 议题
{{topic}}

# 这一轮
第 {{turnIndex}} 轮，共约 {{totalTarget}} 轮。
你这一轮的作用是：{{intentHuman}}      # 例：「反对，并给出一个反例」
{{#if targetQuote}}
你要回应的是：{{targetQuote}}          # 对方原话，最多 40 字
{{/if}}

# 现场（最近 8 条，新→旧）
{{transcriptWindow}}

# 已经形成的共识 / 分歧
{{insights}}
# 不要重复这些结论，除非你要反驳其中一条。

# 你必须做到
1. 只说你自己的话，1–2 句，总共不超过 120 字。简短是硬要求。
2. 必须带来现场还没有的东西：新理由 / 新反例 / 明确让步 / 明确边界，四选一。
   {{intentRule}}
3. 不要复述别人说过的话，不要说「正如刚才所说」「我同意前面」这类空转句。
4. 不要自我介绍，不要说「作为…」，不要加「姓名：」前缀，不要括号动作，不要 markdown，不要 emoji。
5. 用口语，可以有态度、有停顿感；不要写成小作文，不要分点。
6. 不要编造具体数据、机构、论文、人名。没有把握就讲判断和条件。

{{#if intent == "rebut"}}
# 反驳的写法
第一句必须准确指向对方某个具体说法（可以短引用，不超过 15 字），第二句给出你的理由或反例。
不要泛泛地说「我不同意」，要让人听出你不同意的到底是哪半句。
{{/if}}

{{#if intent == "clarify"}}
# 澄清的写法
先说清「我不是这个意思」或「我刚才说的是 A，不是 B」，再补一句你真正的边界条件。
不要借澄清的机会长篇立论。
{{/if}}

# 输出
直接输出你要说的话，不要任何前缀、引号、JSON 或解释。
```

配套契约：

```ts
buildSpeechPrompt(ctx: SpeechContext, decision: TurnDecision): PromptSpec  // 流式
validateSpeech(text: string, decision: TurnDecision, recent: Message[]): SpeechCheck
// → { ok, fixed, reasons[] }；fixed 为截断/清洗后的文本，绝不扩写
```

---

## 7. 另外三类（已于 AI-02 补全）

| Prompt | 全文 | 落地要点 |
| --- | --- | --- |
| `P-ROSTER` | [runtime/P-ROSTER v1.1](runtime/P-ROSTER.v1.1.0.md) | 按议题做相关性/删题测试，拒绝通用角色凑数；四维差异 + 颜色 |
| `P-INSIGHT` | [runtime/P-INSIGHT](runtime/P-INSIGHT.v1.0.0.md) | 重点写"什么时候不许写"：单人证据不许写共识、没写出轴不许写分歧、数字必须能在原文找到；空快照合法 |
| `P-SUMMARY` | [runtime/P-SUMMARY](runtime/P-SUMMARY.v1.0.0.md) | 三段式、禁 JSON 痕迹、某类为空要明说、结尾给一句可带走的判断 |

另两份（[P-DECIDE](runtime/P-DECIDE.v1.0.0.md) / [P-SPEECH](runtime/P-SPEECH.v1.0.0.md)）以本文 §5/§6 的骨架为基础定稿，差异：
候选顺序改为**稳定哈希打乱**；新增 `mediate` 的 `references` 要求；发言明确"纯文本、不套 JSON"并给出 8 种分型指令。

---

## 8. 单场成本 / 延迟预算（n=4，12 轮）

| 项 | 值 |
| --- | --- |
| 调用次数 | 32（1 阵容 + 12 决策 + 12 发言 + 6 共识 + 1 总结） |
| 输入 tokens | ≈ 86k |
| 输出 tokens | ≈ 8k |
| 成本 | ≈ ¥0.25（含重试余量），上限 ¥1 |
| 关键路径 | 决策 p95 2.5s + 抖动 0.9s + 首字 3.0s + 生成 5.0s ≈ 11.4s/轮（含重试）→ 轮间隔 p95 目标 7s 内 |

> 成本不是风险，**延迟与竞态才是**（见行为规范 §11.6）。

---

## 9. 与其他文档的关系

| 文档 | 关系 |
| --- | --- |
| [AGENT-BEHAVIOR.md](../AGENT-BEHAVIOR.md) | 定义"输出什么、怎么校验、失败怎么办"；本文件定义"用什么 prompt 产出" |
| [04-SSE事件契约](../04-SSE事件契约.md) | prompt 的字段最终映射到 `turn.started` / `message.completed` / `insight.updated` / `summary.completed` |
| [03-API契约](../03-API契约.md) | 阵容字段、错误码、幂等语义 |
| 邮件附件 `PROMPT-LOG.md` | 开发过程 prompt（≥5 段），与本文件的运行时 prompt 分属两个交付物 |

---

## 10. 待办

- [ ] PM 确认 `docs/prompts/{runtime,devlog}` 目录分层（§0）
- [ ] PM 确认 P0 契约改动（`turn.aborted` / `discussion.failed` / `stanceAxis` / `polarity` / `degraded`），否则 `P-DECIDE`、`P-INSIGHT` 的 schema 会返工
- [ ] AI-02：补 `P-ROSTER` / `P-INSIGHT` / `P-SUMMARY` 全文 + `P-DECIDE`/`P-SPEECH` 定稿
- [ ] AI-02：`packages/agent` 的 `PromptSpec` 类型与 mock fixture 对齐
- [ ] 每次 prompt 变更后更新 `docs/prompts/runtime/CHANGELOG.md` 并跑 eval

---

## 11. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v0.1 | 2026-10-31 | 首版：五类清单、参数基线、2 个骨架、成本预算、目录分层建议 |
