# P-INSIGHT v2.0.0（共识 / 分歧 / 待验证）

- 实现：`packages/agent/src/prompts/insight.ts`
- 输出：JSON（`insightOutputSchema`）→ `parseInsightOutput` → `normalizeInsights`
- 参数：`deepseek-flash` / **thinking 开启** / `json_object` / temperature 0.2（修复 0.1）/ max 900 tokens / 超时 **45s**
- 对应：AR-07；FR-09；契约 §1.7（全量快照、`firstSeenTurn`、删除 `status`）
- 判定规则本身**未变**；v2 变的是**上下文**（争论结构优先）与 thinking/超时——这正是它必须升 MAJOR 的原因：
  同样的规则，喂给模型的现场坐标变了，产出分布会明显不同。

## v2 变更

| 项 | v1 | v2 |
| --- | --- | --- |
| 上下文顺序 | persona → 现场 → 洞察 | **争论结构（debateMap + 收敛度）→ 参会者 → 现场 → 洞察** |
| 可用信息 | 谁说了什么 | 额外：谁欠谁一个回答、各方当前主张、未解决张力、被回避前提 |
| thinking / 超时 | off / 15s | **enabled / 45s** |
| 判定标准 | 双人证据、数字溯源 | 不变（prompt 与 `normalizeInsights` 一一对应） |

为什么要给 insights 也看 debateMap：提炼共识/分歧时，"哪条已经被回应过"决定了它还算不算 open；
只看原文容易把"已经被驳倒的旧说法"继续当成分歧。

## System（原文）

```text
你是「AI 圆桌演播厅」的记录员，负责从现场发言里提炼「共识 / 分歧 / 待验证的问题」。
你只记录**已经说出来的东西**，不做推理延展，不替嘉宾补观点。

# 硬性要求
（全局 5 条：中文 / 只处理本会话 / 不编造 / 不输出思考过程 / 守字段）
5. 证据只能来自给定的 messageId 列表，必须原样复制，不得编造、不得改写 id。
6. content 里出现的任何数字，必须能在对应证据的原话里找到。
7. 只输出 JSON，不要 markdown，不要解释。
```

## User 结构

| 段 | 内容 |
| --- | --- |
| 议题 | 原文 |
| 争论结构 | `debateMap` 渲染 + `renderSaturation`（v2 新增） |
| 参会者 / 现场 / 统计 | 最近 8 条全文 + 更早一行式 |
| 可用的 messageId | 逗号分隔的 id 清单（证据只能从这里选） |
| 已有台账 | 带 id、类型、content、证据、firstSeenTurn |
| 判定标准 | 见下 |
| 输出规则 | 全量快照；已有条目带回 id；新条目不写 id；≤50 字；每类上限 8/6/6；空快照合法 |

判定标准（prompt 原文，v1 起未变）：

1. **共识**：≥2 条证据、≥2 位不同发言者、同一争议轴上的兼容主张；要写成一句具体的话，不能是"大家都认为要理性看待"。
2. **分歧**：≥2 条证据、≥2 位不同发言者；content 必须写出分歧轴（"A 认为……，B 认为……"）；只写"存在不同看法"不算。
3. **待验证**：有人提出、还没人给出明确回答的问题；≥1 条证据（提出问题那句）。
4. 归不到三类的直接丢弃，不要硬凑。

## 输出 JSON

```json
{"insights":[
  {"id":"i_ab12cd34","type":"divergence","content":"分歧在于初级岗位是被压缩还是被升级","evidenceMessageIds":["m_2","m_5"]}
]}
```

`.strict()`：`status`、`axis` 等已删字段会被判失败（契约 v1.0 已删除）。

## 三道保险（`normalizeInsights`）

| 保险 | 规则 | 违反后果 |
| --- | --- | --- |
| 证据白名单 | 任一 id 不在本会话消息里 | 整条丢弃（不改写、不补造） |
| 双人证据 | consensus/divergence 的发言者 < 2 | 丢弃，`need_two_speakers` |
| 数字溯源 | content 里的数字不在证据原文中出现 | 丢弃，`number_unsourced` |

另外：禁止第一人称；与已有条目 3-gram Jaccard > 0.6 视为重复（合并证据、保留原 id）；每类上限 8/6/6；
每类每轮最多新增 2 条（按类型分别计）。

## 失败与降级

- JSON 无效/空 → 修复重试 1 次 → 仍失败**保留上一版快照**，不推空。
- 部分条目被拒 → 推剩余全量，`summarizeInsightRejections()` 压成一行进日志
  （`evidence_unknown` / `need_two_speakers` / `over_max_new` 最常见）。
- 与 summary 的竞态：总结前必须结算快照，`insight.updated` 不得晚于 `discussion.ended`。

## 变更记录

| 版本 | 变更 |
| --- | --- |
| 1.0.0 | 首版：全量快照、双人证据、数字溯源、按类型新增上限 |
| 2.0.0 | 上下文改为争论结构优先（debateMap + 收敛度）；thinking + 45s |
