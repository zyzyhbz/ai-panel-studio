# P-INSIGHT v1.0.0（共识 / 分歧 / 待验证）

- 实现：`packages/agent/src/prompts/insight.ts`
- 输出：JSON（`insightOutputSchema`）→ `parseInsightOutput` → `normalizeInsights`
- 参数：`deepseek-flash` / thinking off / `json_object` / temperature 0.2（修复 0.1）/ max 900 tokens / 超时 15s
- 对应：AR-07；FR-09；契约 §1.7（全量快照、`firstSeenTurn`、删除 `status`）

## 关键设计

1. **全量快照**，不是增量：模型每轮把仍成立的条目全部列出来，前端直接替换。
2. **台账带 id**：已有条目必须原样带回 `id`，前端列表才不会跳；新条目不写 id（系统按内容哈希分配）。
3. **证据只能抄**：`evidenceMessageIds` 必须从给定清单里原样复制，编造会被整条丢弃。
4. **判定标准写死在 prompt 里**，且与 `normalizeInsights` 的校验一一对应——prompt 说的和代码查的是同一套。

## System

```text
你是「AI 圆桌演播厅」的记录员，负责从现场发言里提炼「共识 / 分歧 / 待验证的问题」。
你只记录**已经说出来的东西**，不做推理延展，不替嘉宾补观点。

# 硬性要求
（全局 5 条）
5. 证据只能来自给定的 messageId 列表，必须原样复制，不得编造、不得改写 id。
6. content 里出现的任何数字，必须能在对应证据的原话里找到。
7. 只输出 JSON，不要 markdown，不要解释。
```

## User 模板

| 插槽 | 说明 |
| --- | --- |
| `{{topic}}` | 议题 |
| `{{contextBlock}}` | 现场 + 统计 + 当前快照 |
| `{{transcriptIds}}` | 可用 messageId 清单（逗号分隔） |
| `{{existing}}` | 已有条目（带 id、类型、content、证据、firstSeenTurn） |
| `{{maxNew}}` | 本轮每类最多新增条数（默认 2） |

判定标准（prompt 原文）：

1. **共识**：≥2 条证据、≥2 位不同发言者、同一争议轴上的兼容主张；要写成一句具体的话，不能是"大家都认为要理性看待"。
2. **分歧**：≥2 条证据、≥2 位不同发言者；content 必须写出分歧轴（"A 认为……，B 认为……"）；只写"存在不同看法"不算。
3. **待验证**：有人提出、还没人给出明确回答的问题；≥1 条证据（提出问题那句）。
4. 归不到三类的直接丢弃，不要硬凑。

输出规则：全量快照；已有条目原样带回 id，content 可改准、证据只增不减；新条目不写 id/firstSeenTurn；
content ≤50 字、一句、禁止"我"；每类上限 共识 8 / 分歧 6 / 待验证 6；**空快照合法**，不要编。

## 输出 schema

```json
{"insights":[
  {"id":"i_ab12cd34","type":"divergence","content":"分歧在于初级岗位是被压缩还是被升级","evidenceMessageIds":["m_2","m_5"]}
]}
```

| 字段 | 约束 |
| --- | --- |
| `id` | 可选；已有条目必填（原样带回） |
| `type` | `consensus` / `divergence` / `open_question` |
| `content` | 4–50 字，一句话，禁止第一人称 |
| `evidenceMessageIds` | 1–6 条，必须 ∈ 给定清单 |
| `firstSeenTurn` | 可选；新条目由系统填 |

`.strict()`：`status`、`axis` 等已删字段会被判失败（契约 v1.0 已删除）。

## 三道保险（`normalizeInsights`）

| 保险 | 规则 | 违反后果 |
| --- | --- | --- |
| 证据白名单 | 任一 id 不在本会话消息里 | 整条丢弃（不改写、不补造） |
| 双人证据 | consensus/divergence 的发言者 < 2 | 丢弃，`need_two_speakers` |
| 数字溯源 | content 里的数字不在证据原文中出现 | 丢弃，`number_unsourced` |

另外：禁止第一人称；与已有条目 3-gram Jaccard > 0.6 视为重复（合并证据、保留原 id）；每类上限 8/6/6；
每类每轮最多新增 2 条（**按类型分别计**，三类各出一条是正常刷新）。

## 失败与降级

- JSON 无效/空 → 修复重试 1 次 → 仍失败**保留上一版快照**，不推空（推空会让面板"清空再填"）。
- 部分条目被拒 → 推剩余全量，并把 `rejected` 计数写指标。
- 与 `summary` 的竞态：总结开始前必须结算快照，`insight.updated` 不得晚于 `discussion.ended`。

## 变更记录

| 版本 | 变更 |
| --- | --- |
| 1.0.0 | 首版：全量快照、双人证据、数字溯源、按类型新增上限 |
