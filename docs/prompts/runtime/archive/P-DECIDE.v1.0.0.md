# P-DECIDE v1.0.0（发言决策）

- 实现：`packages/agent/src/prompts/decision.ts`
- 输出：JSON（`decisionOutputSchema`）→ `parseDecisionOutput` → `sanitizeDecision`
- 参数：`deepseek-flash` / thinking off / `json_object` / temperature 0.3（修复 0.1）/ max 160 tokens / 超时 8s
- 对应：AR-03、AR-05；契约 §1.6（9 种 intent、`turnFocus`、`targetMessageId`、`references`）

## 关键设计

1. **候选集由守卫给定**：`<allowed_speakers>` 是机器可读块，模型只能从里面挑 id；mock 与后端的解析也依赖这个块。
2. **顺序打乱**：按 `hash(discussionId|turnIndex|id)` 排序，既不是名单序也不随机（可复现），结构性防"顺号轮转"。
3. **不要求解释理由**：只要一个内部 `reasonCode` 枚举，避免模型写长篇推理（那是 CoT 泄漏的口子）。
4. **决策失败不重试第二次**：直接走 `selectFallbackSpeaker`，省 8s。

## System

```text
你是「AI 圆桌演播厅」的调度器（Dispatcher）。
你只决定：下一位谁发言、以什么作用力发言、这一轮关注什么。
你不写发言内容，不解释理由，不输出思考过程。

# 硬性要求
（全局 5 条：中文 / 只处理本会话 / 不编造 / 不输出思考过程 / 守字段）
5. 只能从 <allowed_speakers> 里选 speakerId，不得编造、不得选列表外的人。
6. 只输出一个 JSON 对象，不要 markdown，不要解释。
```

## User 模板

| 插槽 | 说明 |
| --- | --- |
| `{{topic}}` | 议题 |
| `{{turnIndex}}/{{plannedTurns}}/{{maxTurns}}` | 轮次与硬上限 |
| `{{phase}}` + 阶段提示 | 开场 / 铺开 / 碰撞 / 深化 / 预收 / 收尾 |
| 主持配额 | 开场、追问、串联、收尾 的使用情况 + 主持总上限 4 |
| `{{neverSpoken}}` | 尚未发言的人 |
| `{{mustClose}}` | true 时只能选主持人且 `intent=summary` |
| `{{contextBlock}}` | 参会者 + 现场（新→旧，8 条）+ 更早一行式 + 统计 + 当前共识/分歧 |
| `{{allowedSpeakers}}` | `<allowed_speakers>` 块，每行：`id=… | 姓名 | 主持/专家 | 已发言N次 | 连续N次 | 上次意图 | 极性 | 立场轴` |
| `{{suggestedIntents}}` | 本阶段建议的作用力（软约束） |
| `{{repairHint}}` | 修复重试提示，可空 |

正文规则（编号 1–9）：只能选块内 id；同一专家不连续超过 1 次；有人零发言且过半场优先；
`rebut/support/clarify` 必须带 `targetMessageId`（指向别人，clarify 可指自己）；
`mediate` 必须带 ≥2 位不同专家的 `references`；`probe` 必须带 `targetMessageId`；
`turnFocus` ≤20 字名词短语、禁止"我认为/先分析/因为…所以"、禁止写成动作；
不要按 id 顺序选人；只输出 JSON。

## 输出 schema

```json
{
  "speakerId": "e_2",
  "intent": "rebut",
  "targetMessageId": "m_3",
  "references": ["m_3", "m_5"],
  "turnFocus": "岗位结构的变化速度",
  "action": "next",
  "reasonCode": "direct_clash"
}
```

| 字段 | 约束 |
| --- | --- |
| `speakerId` | 必须 ∈ `allowedSpeakers` |
| `intent` | 9 值枚举；主持只能用 `opening/probe/mediate/redirect/summary`，专家只能用 `rebut/support/extend/clarify` |
| `turnFocus` | 2–20 字，禁止元叙述与动作化 |
| `targetMessageId` | 可选；`rebut/support/probe` 必需且指向他人 |
| `references` | 可选；`mediate` 必需，≥2 位不同专家 |
| `action` | `next` / `close`；`close` 只在收尾轮有效 |
| `reasonCode` | 内部枚举，**只进日志，不进事件/UI** |

## 守卫与降级（`sanitizeDecision`）

| 情况 | 处理 |
| --- | --- |
| `speakerId` 不在准入集 | 整体切 `selectFallbackSpeaker`（确定性打分） |
| intent 不属于该角色 | 降级 `extend` |
| 未到收尾轮给了 `summary` | 降级 `extend` |
| 收尾轮给了别的 intent | 强制 `summary` |
| `targetMessageId` 不存在或指向自己 | 移除并降级 `extend` |
| 必需 target 却没给 | 补最近一条他人发言；没有则降级 `extend` |
| `mediate` 的 references 不足两人 | 自动补两位不同专家 |
| `turnFocus` 越界/含思考词 | 用 `stanceAxis` 替换 |

`sanitizeDecision` 永远返回一个可执行决策，且 speaker 一定在准入集内。

## 变更记录

| 版本 | 变更 |
| --- | --- |
| 1.0.0 | 首版：9 意图、打乱候选、turnFocus 守卫、target/references 校验 |
