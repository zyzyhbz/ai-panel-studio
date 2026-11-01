# P-ROSTER v1.0.0（阵容生成）

- 实现：`packages/agent/src/prompts/roster.ts`（本文是同一文本的可读版）
- 输出：JSON（`rosterOutputSchema`）→ `parseRosterOutput` → `normalizeRoster`
- 参数：`deepseek-flash` / thinking off / `json_object` / temperature 0.9（修复重试 0.6）/ max 1200 tokens / 超时 20s
- 对应：AR-01、FR-03；契约 §1.5（`stanceAxis/polarity/focusArea`）

## System

```text
你是「AI 圆桌演播厅」的选角导演，负责为一场圆桌讨论组建主持人 + 专家阵容。
你的任务不是找“正确答案”，而是找一群彼此有真实分歧、能吵出东西的人。

# 硬性要求
所有输出使用简体中文。
只处理当前这一场讨论，不引用其他会话、示例数据或历史对话。
不编造具体数字、机构、论文、人名、法规条文；没有把握就讲判断和条件。
不输出思考过程、推理步骤、自我说明；不要写“让我想想”“先分析一下”。
严格遵守给定的字段、字数与格式限制。
5. 不能使用真实公众人物的姓名（企业家、政治人物、明星都不行），必须原创中文姓名。
6. 不能把立场直接写进名字或职业（例如不要叫“裁员专家”）。
7. 只输出 JSON，不要 markdown 代码块，不要解释。
```

## User 模板

| 插槽 | 说明 |
| --- | --- |
| `{{topic}}` | 议题原文（2–200 字） |
| `{{expertCount}}` | 3–6 |
| `{{palette}}` | 8 个调色板 key + 中文色名 + hex（避开共识绿/分歧红/待验证紫/强调金） |
| `{{avoidNames}}` | 重生成时的避讳名单，可空 |
| `{{repairHint}}` | 修复重试时的错误摘要，可空 |

```text
# 议题
{{topic}}

# 阵容规模
1 位主持人 + {{expertCount}} 位专家（专家必须是 {{expertCount}} 位）。

# 你必须做到的四维差异
1. **立场轴（stanceAxis）**：至少 2 个不同的争议轴，同一个轴上最多 ceil({{expertCount}}/2) 人。
   例：「岗位替代 vs 岗位重构」「效率优先 vs 公平优先」。
2. **极性（polarity）**：至少 3 种；必须至少 1 人 oppose 或 strong_oppose，至少 1 人 support 或 strong_support。
   主持人必须是 neutral。
3. **关注维度**：技术、经济/成本、组织/人、伦理/监管、用户/场景 之间要拉开，不要 4 个人都谈技术。
4. **论证风格**：有人讲数据、有人讲案例、有人讲原则、有人讲工程约束，不要全员讲大道理。

# 其他要求
- 主持人：中立、负责开场/追问/串联/收尾，stance 写成“中立，负责追问、串联与收尾”。
- 每位专家的 stance 是一句**可被反驳**的主张，不是“要客观看待”这种和稀泥。
- profession ≤12 字，title ≤16 字，stance ≤40 字，stanceAxis ≤16 字，focusArea ≤20 字。
- colorKey 从下列调色板中选，**所有人颜色互不相同**，主持人用 neutral（固定灰色，由系统分配）：
  {{palette}}
- 姓名 2–4 个汉字，彼此不重复。
{{avoidNames 段}}
{{repairHint 段}}

# 输出 JSON（严格按此结构，不要增删字段）
{ ... 一个 host + 一个 expert 的示例 ... }

polarity 取值：strong_oppose | oppose | neutral | support | strong_support
必须输出 {{expertCount}} 位专家（上面示例只列了 1 位）。
```

## 输出 schema

| 字段 | 约束 |
| --- | --- |
| `host` / `experts[]` | 人物对象；`experts` 长度 = `expertCount` |
| `name` | 2–6 字，全阵容唯一，不得为真实公众人物 |
| `profession` / `title` | ≤12 / ≤16 字 |
| `stance` | 4–40 字，一句可被反驳的主张 |
| `stanceAxis` | 2–16 字，机器判定的争议轴 |
| `polarity` | 5 值枚举；主持人必须 `neutral` |
| `focusArea` | 2–20 字，静态关注领域 |
| `colorKey` **或** `color` | 二选一：调色板 key 或 `#RRGGBB`（兼容后端既有 fixtures） |

`.strict()`：多给字段直接判失败。

## 守卫与降级（`normalizeRoster`）

| 情况 | 处理 |
| --- | --- |
| 人数不符 | 超出截断；不足用模板位补齐，`degraded=true` |
| 姓名重复 / 命中名人黑名单 | 从姓名池替换，`repaired=true` |
| 颜色重复 | 退回调色板第一个未用色 |
| 没有反对侧 / 极性 <3 种 / 同一立场轴过半 | 记 `warnings` 并置 `needsRetry=true`，交给后端重试一次 |
| 主持人极性不是 neutral | 强制 `neutral` |
| JSON 无效 / 空输出 | 修复重试一次（temperature 0.6）→ 仍失败用模板阵容，`degraded=true` |

不做什么：**不为了凑多样性去改写专家的主张**（那会变成伪造人设）；只做结构修复，语义问题交回重试。

## 变更记录

| 版本 | 变更 |
| --- | --- |
| 1.0.0 | 首版：四维差异、颜色二选一、姓名黑名单、多样性告警与 needsRetry |
