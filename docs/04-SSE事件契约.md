# SSE 事件契约 v0.1

- 日期：2026-10-31
- 状态：草案，待 AI/后端/前端评审
- 关联：[PRD](PRD.md)、[ER 图](ER.md)、[API 契约](03-API契约.md)

## 1. 基本规则

- 端点：`GET /api/discussions/:id/stream?after=<seq>`
- `Content-Type: text/event-stream`
- 每个会话独立事件序列；`seq` 从 1 递增。
- 持久化事件带 `id: <seq>`；`message.delta` 是临时事件，不带 `id`，不落库。
- 客户端重连时，浏览器自动带 `Last-Event-ID`；服务端从该序号之后补发。
- 心跳：每 15 秒发送 `: heartbeat` 注释，不触发前端事件。
- 会话结束后，补发到 `discussion.ended`，服务端关闭连接。
- 任何事件 payload 必须通过 Zod 校验；前端忽略未知事件类型并记录。

## 2. 事件总表

| 事件 | seq | 落库 | 说明 |
| --- | --- | --- | --- |
| `stream.ready` | 否 | 否 | 连接建立，返回当前 lastSeq/status |
| `roster.ready` | 是 | 是 | 阵容生成完成 |
| `discussion.started` | 是 | 是 | 确认后开始 |
| `turn.started` | 是 | 是 | 下一位发言者开始 |
| `message.delta` | 否 | 否 | 流式 token/句子片段 |
| `message.completed` | 是 | 是 | 一条完整发言 |
| `insight.updated` | 是 | 是 | 共识/分歧/待验证全量更新 |
| `summary.completed` | 是 | 是 | 主持人总结 |
| `discussion.ended` | 是 | 是 | 讨论结束 |
| `error` | 否 | 可选 | 可恢复/不可恢复错误 |

## 3. 事件定义

### 3.1 `stream.ready`

连接建立后立即发送，无 `id`。

```json
{
  "discussionId": "d_01",
  "status": "live",
  "lastSeq": 12
}
```

用途：客户端确认连接成功；若 `lastSeq` 大于本地，先补拉详情或等待补发。

---

### 3.2 `roster.ready`

```json
{
  "discussionId": "d_01",
  "experts": [
    {
      "id": "e_host",
      "role": "host",
      "name": "林致远",
      "profession": "科技主持人",
      "title": "资深圆桌主持",
      "stance": "中立，负责追问与串联",
      "color": "#D9D9D9",
      "focus": "开场与节奏",
      "sortOrder": 0
    },
    {
      "id": "e_01",
      "role": "expert",
      "name": "周明",
      "profession": "软件工程师",
      "title": "技术负责人",
      "stance": "AI 会重构初级岗位，而不是简单消灭",
      "color": "#E8B04B",
      "focus": "工程实践与岗位结构",
      "sortOrder": 1
    }
  ]
}
```

规则：

- 共 `1 + expertCount` 人。
- 颜色唯一；姓名/立场不重复。
- 重新生成时发送新事件，`experts` 全量替换；旧事件保留。

---

### 3.3 `discussion.started`

```json
{
  "discussionId": "d_01",
  "startedAt": "2026-11-01T10:00:10.000Z"
}
```

---

### 3.4 `turn.started`

```json
{
  "discussionId": "d_01",
  "turnIndex": 3,
  "speakerId": "e_02",
  "speakerName": "许澜",
  "intent": "rebut",
  "focus": "反驳“替代论”忽略岗位重构"
}
```

规则：

- `intent`：`opening` / `probe` / `rebut` / `support` / `extend` / `summary`。
- `focus` 是公开关注点，不是隐藏 CoT。
- 同一 speaker 连续不超过 2 次。
- `turn.started` 先于该轮的 `message.delta`。

---

### 3.5 `message.delta`

```json
{
  "discussionId": "d_01",
  "messageId": "m_03",
  "speakerId": "e_02",
  "delta": "我不完全同意。"
}
```

规则：

- 不落库，不带 `id`。
- 同一 `messageId` 的 delta 按到达顺序拼接。
- 客户端按帧/50ms 批量刷新，避免每个 token 触发全局渲染。
- 断线重连时丢弃未完成的 delta 缓冲；等待 `message.completed`。

---

### 3.6 `message.completed`

```json
{
  "discussionId": "d_01",
  "message": {
    "id": "m_03",
    "expertId": "e_02",
    "speakerName": "许澜",
    "speakerTitle": "组织心理学研究者",
    "speakerColor": "#4FC3A1",
    "content": "我不完全同意。AI 先替代的是任务，不是人；初级岗位的职责会被重组。",
    "intent": "rebut",
    "turnIndex": 3,
    "createdAt": "2026-11-01T10:01:02.000Z"
  }
}
```

规则：

- 落库；`content` 是最终全文；`charCount` 可用于长度校验。
- 客户端收到后，用最终消息替换该 `messageId` 的流式缓冲。
- 若该消息已被客户端渲染完成，按 `id` 去重。

---

### 3.7 `insight.updated`

```json
{
  "discussionId": "d_01",
  "insights": [
    {
      "id": "i_01",
      "type": "consensus",
      "content": "双方都认为初级岗位的职责会变化，而不是原样保留",
      "evidenceMessageIds": ["m_02", "m_03"],
      "updatedAt": "2026-11-01T10:01:05.000Z"
    },
    {
      "id": "i_02",
      "type": "divergence",
      "content": "变化是“升级”还是“压缩”，存在分歧",
      "evidenceMessageIds": ["m_03", "m_05"],
      "updatedAt": "2026-11-01T10:01:05.000Z"
    },
    {
      "id": "i_03",
      "type": "open_question",
      "content": "企业是否愿意为初级岗位的再培训买单？",
      "evidenceMessageIds": ["m_05"],
      "updatedAt": "2026-11-01T10:01:05.000Z"
    }
  ]
}
```

规则：

- 全量快照，前端直接替换三类列表；避免增量合并出错。
- 每条必须至少 1 条 `evidenceMessageIds`；没有依据时不得进入 `consensus`/`divergence`。
- 去重由 AI/后端负责；前端不再二次合并。
- 更新不应阻塞发言流。

---

### 3.8 `summary.completed`

```json
{
  "discussionId": "d_01",
  "summary": {
    "content": "这场讨论的共识是……主要分歧在……尚未解决的是……",
    "createdAt": "2026-11-01T10:05:00.000Z"
  }
}
```

规则：

- 自然语言，不能包含 JSON 字段名/原始结构。
- 必须覆盖共识、分歧、未决问题。
- 落库；首页卡片可截取前 80 字。

---

### 3.9 `discussion.ended`

```json
{
  "discussionId": "d_01",
  "endedAt": "2026-11-01T10:05:01.000Z"
}
```

规则：

- 最后一条持久化事件；之后不再有发言/洞察事件。
- 客户端收到后切换到 ended 状态，显示“回放/返回首页”。

---

### 3.10 `error`

```json
{
  "discussionId": "d_01",
  "code": "LLM_TIMEOUT",
  "message": "本轮生成超时，已跳过并继续",
  "recoverable": true
}
```

规则：

- `recoverable=true`：toast 提示，讨论继续。
- `recoverable=false`：会话进入 failed/ended 的可读状态，前端展示重试/返回。
- 不包含堆栈、Key、原始 LLM 输出。
- `error` 不作为回放必需事件；如需审计可落库。

---

## 4. 事件顺序

正常一轮：

```text
turn.started
  → message.delta × N
  → message.completed
  → insight.updated（可异步，可能稍后）
```

会话：

```text
roster.ready
  → discussion.started
  → turn.started / message.delta / message.completed × 8–12
  → summary.completed
  → discussion.ended
```

约束：

- 同一会话的 `turn.started` 不并发。
- `message.completed` 必须在该 `messageId` 的 delta 之后。
- `summary.completed` 必须在最后一条 `message.completed` 之后。
- `discussion.ended` 必须在 `summary.completed` 之后。
- `insight.updated` 可以在 `message.completed` 后异步到达，但不得晚于 `discussion.ended`。

## 5. 断线与补发

1. 客户端连接时带 `after=lastSeq`。
2. 服务端发送 `stream.ready`。
3. 服务端补发 `seq > max(after, Last-Event-ID)` 的持久化事件。
4. 补发完成后进入实时推送。
5. 客户端按 `seq` 去重；若发现跳号，重新 GET 详情/events 补齐。

边界：

- `message.delta` 不补发；重连后等待完整 `message.completed`。
- 已结束会话：补发到 `discussion.ended` 后关闭。
- 不存在的事件/越权会话：返回 404/403，不建立 SSE。

## 6. 回放映射

| 事件 | 回放时如何处理 |
| --- | --- |
| roster.ready | 重建专家列表 |
| discussion.started | 设置 started 状态 |
| turn.started | 高亮发言者/设置当前 intent |
| message.completed | 追加完整消息 |
| insight.updated | 替换共识/分歧/待验证 |
| summary.completed | 显示总结 |
| discussion.ended | 进入结束态 |
| message.delta | 忽略（不落库） |
| error | 忽略或作为状态提示 |

回放速度：

- 1x：按事件时间戳间隔播放，过长间隔压缩到最多 2s。
- 1.5x/2x：间隔除以倍速。
- 跳转：按目标 `seq` 之前的事件重建状态，不重新请求 LLM。

## 7. 原始流示例

```text
: connected

event: stream.ready
data: {"discussionId":"d_01","status":"live","lastSeq":12}

event: turn.started
id: 13
data: {"discussionId":"d_01","turnIndex":4,"speakerId":"e_03","speakerName":"陈默","intent":"extend","focus":"补充再培训成本"}

event: message.delta
data: {"discussionId":"d_01","messageId":"m_04","speakerId":"e_03","delta":"我再补一个角度："}

event: message.delta
data: {"discussionId":"d_01","messageId":"m_04","speakerId":"e_03","delta":"企业愿不愿意为再培训买单，决定了岗位是升级还是压缩。"}

event: message.completed
id: 14
data: {"discussionId":"d_01","message":{"id":"m_04","expertId":"e_03","speakerName":"陈默","speakerTitle":"劳动经济学家","speakerColor":"#7B9ACC","content":"我再补一个角度：企业愿不愿意为再培训买单，决定了岗位是升级还是压缩。","intent":"extend","turnIndex":4,"createdAt":"2026-11-01T10:01:20.000Z"}}

event: insight.updated
id: 15
data: {"discussionId":"d_01","insights":[]}

: heartbeat
```

## 8. 前端处理约定

- 用 `EventSource` 或 `fetch` 流；优先 `EventSource`，因为自动重连和 `Last-Event-ID` 简单。
- `message.delta`：写入当前消息缓冲，`requestAnimationFrame` 批量刷新。
- `message.completed`：用最终消息替换缓冲，按 `id` 去重。
- `insight.updated`：全量替换，不做增量合并。
- `stream.ready`：校准 `lastSeq`；若服务端 `lastSeq` 大于本地，先拉详情。
- `error`：可恢复 toast；不可恢复进入错误态。
- 组件卸载时关闭连接；重新进入时从 `lastSeq` 续传。
- 不把 `message.delta` 写入持久化状态/回放。

## 9. 待评审

1. `insight.updated` 全量快照是否过大；MVP 预计 < 20 条，可接受。
2. `turn.started` 是否暴露 `focus`；建议暴露，属于公开关注点。
3. `error` 是否落库；建议只记录结构化日志，不进入回放。
4. `stream.ready` 是否带完整快照；不建议，详情接口已提供。
5. 是否需要 `typing`/`thinking` 状态事件；可用 `turn.started` 的 `intent/focus` 表达，避免暴露 CoT。
