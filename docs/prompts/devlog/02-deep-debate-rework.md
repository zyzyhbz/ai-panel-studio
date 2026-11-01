# devlog-02：深度讨论改版（debateMap / 辩论式发言 / 观点饱和收束）

- 日期：2026-11-01
- 阶段：改版（用户反馈 → 行为重构）
- 产出：`context/debate-map.ts`、`prompts/{decision,speech,summary}.ts`、`policy/{eligibility,decision,fallback}.ts`、`core/rounds.ts`、`evals/`
- 结果：`typecheck` 0 error、`test` 92/92、mock 基线 **19/19 门禁**

## 1. 原始 Prompt（PM 派单）

```text
新改版任务（深度讨论），先读 docs/09-深度讨论与圆桌UI改版.md。
用户反馈的核心：专家在"演角色"而不是"争论"；主持人机械控流程；12 轮太短；需要开 thinking。

1. 上下文新增 debateMap（确定性、不调 LLM）：未回应的挑战、各方当前主张、
   未解决张力、被回避的前提。放进 speech/decision 上下文前部，优先于 persona。
2. 重写 P-SPEECH：每轮必须回应一个具体 messageId，明确反对/支持/有条件同意/澄清，
   新增至少一个新理由/反例/边界/代价；禁止"作为……"式角色独白；允许承认被说服。
3. 重写 P-DECIDE：优先选"最该回应未回应挑战的人"，reasonCode 增加
   answer_challenge / pressure_test；turnFocus 是争点/问题，不是名词标签。
4. 重写主持人分支：先指认当前最强张力/被回避前提，再追问条件/代价/反例；
   禁止"下面请 X 发言"；收尾只讲争出了什么/还差什么。
5. 轮次：plannedTurns=min(36,12+4n)，maxTurns=36；mustClose 只在 turnIndex>=maxTurns…
6. Thinking：真实模式开 DEEPSEEK_THINKING=enabled；prompt 不展示 CoT。
```

## 2. 当时的判断

用户说"专家在演角色"，直觉上会想去改人设（加性格、加背景故事），但那是**错的方向**：
真正的原因是 prompt 允许"泛泛谈观点"——没有"必须回应谁"、没有"必须带来什么新东西"，
模型自然退化成自我介绍 + 复述立场。所以改的是**协议**，不是人设。

第二步的判断：既然要"每轮必须回应具体的人"，模型就必须先知道**谁欠谁一个回答**。
把这个交给模型去读 transcript 是不可靠的（36 轮读不完），所以做了一个**确定性投影** `debateMap`：
从 `targetMessageId` + intent + 内容相似度算出"未回应的挑战 / 当前主张 / 张力 / 被回避前提"，
放在上下文最前面。成本为零，且可单测。

## 3. 挑战与修正

### 挑战 1：收束判定过严，导致"永远不 ready"

第一版 `saturation` 要求：
- 所有挑战被回应（`openChallengeCount === 0`）；
- 所有 divergence/open_question 都解决（`unresolvedTensions === 0`）；
- 最近 4 轮没有 rebut/probe。

PM 立刻指出这会**永远跑到 36**：真实讨论总会有未解决挑战；观点讨论本来就允许保留分歧；
而 `rebut/probe` 在最近 4 轮必然出现。三条叠加 = 永不收敛。

修正（关键）：
1. 只有 **`age <= 4` 且未承认** 的挑战阻塞收束，旧挑战进 `acceptedUnresolved`（供总结列出）；
2. 只要求"最近 4 轮没有**新增**张力"，旧的允许保留；
3. `staleOk` 只看"最近 4 轮没有新洞察"，不再用 rebut 事件数。

修正后构造"旧分歧 + 最近 4 轮无新观点"的 snapshot，`ready=true` 可复现（有单测）。

### 挑战 2：`turnFocus` 从名词标签改成争点，破坏了既有测试

`validateDecision` 突然对"合法决策"返回 false。排查发现不是 target/intent，而是 `turnFocus` 规则变了：
旧测试用「岗位结构」，新规则要求"争点/问题"（`？` 或 是否/该不该/到底/…）。
处理：**改测试到新语义**（"岗位到底会不会被替代？"），并新增"名词标签会被改写成争点"的用例；
兜底也改成把 `stanceAxis` 的 `vs` 换成 `还是` 再加问号（`岗位替代 vs 岗位重构` → `岗位替代还是岗位重构？`）。

### 挑战 3：轮转指标在 36 轮下误报

`evals` 的"机械轮转"检测原来统计"从 start 开始任意位置重复 ≥2 次"，36 轮里偶然撞上一对分片就被判违规（5 场全红）。
改成**严格连续**：一旦分片不等就 break，连续 3 段相同才算违规。
同时 mock 的选人从"最少发言 + 哈希"改成"最少发言 + 最近 4 条出现次数 + 哈希"，避免退化成 A/B 交替。

### 挑战 4：thinking 打开后超时必须整体放宽

decision 8s / speech 20s 在 thinking 模式下几乎必然超时。按 09 文档改成
decision 45s、speech 首字 20s + 总 90s、insight 45s、summary 90s，并把 `PromptSpec.thinking` 置为 `enabled`
（字段是给 transport 的建议，mock 忽略）。

## 4. 复盘

- **"演角色"是症状，不是病因**：病因是 prompt 允许泛泛而谈 + 上下文没有争论结构。改协议比改人设有效。
- **"收敛"不能定义成"话说干净"**：真实讨论永远有残留分歧。定义成"还在不在产生新东西"，才可能收敛。
- **确定性投影比再调一次 LLM 划算**：debateMap 零调用、可单测、可复现，比"让模型总结一下现在争什么"稳定得多。
- 指标要分清**可门禁**与**仅参考**：mock 的固定台词决定了"新论点率"不可能达标，把它设成门禁只会逼人造假。
