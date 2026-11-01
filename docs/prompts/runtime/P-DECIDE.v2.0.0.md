# P-DECIDE v2.0.0（发言决策：按"谁欠谁一个回答"选人）

- 实现：`packages/agent/src/prompts/decision.ts`
- 输出：JSON（`decisionOutputSchema`）→ `parseDecisionOutput` → `sanitizeDecision`
- 参数：`deepseek-flash` / **thinking 开启** / `json_object` / temperature 0.3（修复 0.1）/ max 160 tokens / 超时 **45s**
- 对应：AR-03、AR-05；09-深度讨论 §6.1/§6.3

## 相对 v1 的四处改动

| 项 | v1 | v2 |
| --- | --- | --- |
| 选人依据 | 阶段建议 + 连续上限 | **先看"谁欠一个回答"**（未回应挑战的 target），再看张力，最后才是补位 |
| `turnFocus` | ≤20 字名词短语（"岗位结构"） | ≤24 字**争点/问题**（"岗位到底替代任务还是替代人？"） |
| 收束 | `turnIndex >= plannedTurns` 即 mustClose | 只有 `canClose && saturation.ready` 或到 36 才 close |
| reasonCode | 5 值 | 新增 `answer_challenge` / `pressure_test` |

## 决策优先级（写死在 prompt 里，自上而下命中即停）

1. 有人欠一个回答 → 选那个人正面接（`rebut/support/clarify`），`reasonCode=answer_challenge`
2. 最强张力还没被戳破 → 主持人 `probe` 追问条件/代价，或 `mediate` 把两方摆在一起（`pressure_test`）
3. 立场相反、还没真正交锋 → 选那个还没和对方对过话的人
4. 都没欠账 → 才让没说过话的人补位
5. 任何情况下都不按 id 顺序、不轮流

## System

```text
你是「AI 圆桌」的调度器（Dispatcher）。
你不写发言内容，不解释理由，不输出思考过程。
你只回答一个问题：**这一轮，谁最该说话、以什么方式说、围绕哪个争点。**

# 硬性要求
（全局 5 条：中文 / 只处理本会话 / 不编造 / 不输出思考过程 / 守字段）
5. 只能从 <allowed_speakers> 里选 speakerId，不得编造、不得选列表外的人。
6. 只输出一个 JSON 对象，不要 markdown，不要解释。
```

## User 结构

| 段 | 内容 |
| --- | --- |
| 议题 | 原文 |
| 争论结构 | `debateMap` 渲染（未回应挑战 / 当前主张 / 张力 / 被回避前提）+ **收敛度** |
| 本场状态 | 轮次 / **覆盖保底** / 安全上限 36 / `可以收尾` 判定 / 主持配额 / 尚未发言 / **欠回答的人** |
| 最该做的事 | 上面 5 条优先级 |
| `<allowed_speakers>` | 机器可读块：`id=… \| 姓名 \| 主持/专家 \| 已发言N次 \| 连续N次 \| 上次意图 \| 极性 \| 立场轴` |
| 规则 | 9 条（见下） |
| 强制/修复 | `forcedSpeakerId` 提示、`repairHint` |

规则要点：

1. `speakerId` 必须在 `<allowed_speakers>` 内；
2. 同一专家不连续超过 1 次（主持追问同一人可 2 次）；
3. `rebut/support/clarify` 必须给 `targetMessageId`（指向别人，`clarify` 可指自己）；
4. `mediate` 必须给 ≥2 位不同专家的 `references`；`probe` 必须给 `targetMessageId`；
5. **`turnFocus` 写成争点，不是名词标签**：✅「再培训成本到底该谁承担？」❌「再培训成本」；
6. `action=close` 只在"可以收尾 + 已收敛"时用；
7. `reasonCode ∈ answer_challenge / pressure_test / direct_clash / fresh_voice / fills_gap / closing`。

## 输出 JSON

```json
{
  "speakerId": "e_2",
  "intent": "rebut",
  "targetMessageId": "m_13",
  "turnFocus": "AI 到底替代任务还是替代人？",
  "action": "next",
  "reasonCode": "answer_challenge"
}
```

## 守卫（`sanitizeDecision`）

| 情况 | 处理 |
| --- | --- |
| `speakerId` 不在准入集 | 整体切 `selectFallbackSpeaker`（**优先欠账者**，`reasonCode=answer_challenge`） |
| intent 不属于该角色 | 降级 `extend` |
| `turnFocus` 是名词标签/含思考词/超 24 字 | 改写成「立场轴？」，并记 `FOCUS_INVALID` |
| 未收敛却 `action=close` | 忽略 close，记 `CLOSE_NOT_ALLOWED` |
| 到 36 或已收敛（`mustClose`） | 强制 `summary` + 主持人 |
| `targetMessageId` 不存在/指向自己 | 移除并降级 `extend`（`clarify` 例外） |

## 变更记录

| 版本 | 变更 |
| --- | --- |
| 1.0.0 | 首版：9 意图、打乱候选、turnFocus 守卫 |
| 2.0.0 | 按欠账选人；turnFocus 改为争点；action=close 接入饱和判定；thinking + 45s 超时 |
