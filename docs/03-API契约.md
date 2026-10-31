# API 契约 v0.1

- 日期：2026-10-31
- 状态：草案，待后端/AI/前端评审
- Base URL：`http://localhost:3001/api`（开发期 Vite 代理 `/api`）
- 关联：[PRD](PRD.md)、[ER 图](ER.md)、[SSE 事件契约](04-SSE事件契约.md)、[G1 契约决议](06-G1契约决议.md)

> **v1.0 契约变更**：本文为 v0.1 基线，G1 裁决见 [06-G1契约决议](06-G1契约决议.md)。冲突以 06 为准；G2 实现按 06 的字段/事件/状态为准。

## 1. 通用约定

- 编码：UTF-8；请求/响应 `application/json`，SSE 除外。
- ID：UUID 字符串。
- 时间：ISO 8601 UTC，例如 `2026-11-01T10:00:00.000Z`。
- 字段命名：camelCase。
- 所有请求体/响应体用 Zod 校验；未知字段拒绝或忽略需统一（建议拒绝多余字段）。
- 错误统一：

```json
{
  "error": {
    "code": "INVALID_STATE",
    "message": "讨论当前状态不允许该操作",
    "details": {}
  }
}
```

- 不返回：API Key、隐藏 CoT、原始 LLM JSON、服务器堆栈。

## 2. 状态与合法操作

```text
draft → generating → ready → live → summarizing → ended
                         ↘ failed
```

| 当前状态 | 可确认 | 可重新生成 | 可结束 | 可回放 |
| --- | --- | --- | --- | --- |
| draft | 否 | 否 | 否 | 否 |
| generating | 否 | 否 | 否 | 否 |
| ready | 是 | 是 | 否 | 否 |
| live | 否 | 否 | 是 | 否 |
| summarizing | 否 | 否 | 幂等返回 | 否 |
| ended | 否 | 否 | 幂等返回 | 是 |
| failed | 否 | 是 | 否 | 否 |

## 3. 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/discussions` | 讨论列表 |
| POST | `/api/discussions` | 创建讨论并生成阵容 |
| GET | `/api/discussions/:id` | 讨论详情 |
| POST | `/api/discussions/:id/roster/regenerate` | 重新生成阵容 |
| POST | `/api/discussions/:id/confirm` | 确认阵容并开始 |
| POST | `/api/discussions/:id/end` | 结束讨论并总结 |
| GET | `/api/discussions/:id/events` | 回放事件 |
| GET | `/api/discussions/:id/stream` | SSE 实时流 |

---

## 4. 健康检查

### `GET /api/health`

响应 `200`：

```json
{
  "status": "ok",
  "version": "0.1.0",
  "now": "2026-11-01T10:00:00.000Z"
}
```

---

## 5. 讨论列表

### `GET /api/discussions`

查询参数：

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| status | string | all | all/live/ended/failed |
| limit | number | 50 | 1–100 |
| offset | number | 0 | 分页 |

响应 `200`：

```json
{
  "items": [
    {
      "id": "d_01",
      "topic": "AI 会不会让初级开发者失业？",
      "status": "live",
      "expertCount": 4,
      "turnCount": 6,
      "hostName": "林致远",
      "experts": [
        { "id": "e_01", "name": "周明", "color": "#E8B04B" },
        { "id": "e_02", "name": "许澜", "color": "#4FC3A1" }
      ],
      "summaryPreview": null,
      "updatedAt": "2026-11-01T10:00:00.000Z",
      "lastSeq": 12
    }
  ],
  "total": 1
}
```

说明：

- 首页卡片需要 `hostName`、`experts` 的姓名/颜色做头像组。
- `summaryPreview` 仅 `ended` 时有值，最多 80 字。
- 列表按 `updatedAt` 倒序；进行中优先，其次最近结束。

---

## 6. 创建讨论并生成阵容

### `POST /api/discussions`

请求：

```json
{
  "topic": "AI 会不会让初级开发者失业？",
  "expertCount": 4
}
```

校验：

- `topic`：2–200 字，去首尾空白。
- `expertCount`：3–6，默认 4。
- 禁止空 topic、纯空白、超长、HTML 标签。

处理：

1. 创建 `discussion`（内部 `generating`）。
2. 调 LLM 生成主持人 + 专家阵容。
3. 写入 `experts` + `roster.ready` 事件。
4. 返回 `ready`。

响应 `201`：

```json
{
  "discussion": {
    "id": "d_01",
    "topic": "AI 会不会让初级开发者失业？",
    "status": "ready",
    "expertCount": 4,
    "turnCount": 0,
    "lastSeq": 1,
    "createdAt": "2026-11-01T10:00:00.000Z",
    "updatedAt": "2026-11-01T10:00:08.000Z"
  },
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

失败：

| HTTP | code | 说明 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 参数不合法 |
| 429 | RATE_LIMITED | 生成请求过多 |
| 502 | ROSTER_GENERATION_FAILED | LLM 输出无效/服务失败；`details.discussionId` 可用于重试 |
| 504 | LLM_TIMEOUT | 生成超时；`details.discussionId` 可用于重试 |

失败时仍保留 `discussion`（`failed`），前端可展示“重新生成”。

---

## 7. 讨论详情

### `GET /api/discussions/:id`

响应 `200`：

```json
{
  "discussion": {
    "id": "d_01",
    "topic": "AI 会不会让初级开发者失业？",
    "status": "live",
    "expertCount": 4,
    "turnCount": 6,
    "lastSeq": 12,
    "createdAt": "2026-11-01T10:00:00.000Z",
    "updatedAt": "2026-11-01T10:02:00.000Z",
    "startedAt": "2026-11-01T10:00:10.000Z",
    "endedAt": null
  },
  "experts": [],
  "messages": [
    {
      "id": "m_01",
      "expertId": "e_host",
      "speakerName": "林致远",
      "speakerTitle": "资深圆桌主持",
      "speakerColor": "#D9D9D9",
      "content": "今天我们不急着下结论，先请各位判断：AI 到底在替代初级岗位，还是在改写初级岗位？",
      "intent": "opening",
      "turnIndex": 1,
      "createdAt": "2026-11-01T10:00:12.000Z"
    }
  ],
  "insights": [
    {
      "id": "i_01",
      "type": "divergence",
      "content": "AI 是替代初级岗位，还是重构初级岗位的职责边界，存在分歧",
      "evidenceMessageIds": ["m_02", "m_03"],
      "updatedAt": "2026-11-01T10:01:00.000Z"
    }
  ],
  "summary": null,
  "lastSeq": 12
}
```

说明：

- `experts` 结构与创建接口一致。
- `messages` 按 `turnIndex` 升序。
- `insights` 按 `updatedAt` 倒序或类型分组；前端自行分组。
- `summary` 仅 `ended` 时有值。
- 直播页先 GET 详情拿到 `lastSeq`，再连 SSE `after=lastSeq`。

---

## 8. 重新生成阵容

### `POST /api/discussions/:id/roster/regenerate`

请求：无 body。

响应 `200`：结构同创建接口的 `{ discussion, experts }`。

限制：

- 仅 `ready` / `failed` 可调用。
- `live`/`ended` 返回 `409 INVALID_STATE`。
- 重新生成会替换旧阵容，但保留同一 `discussionId`。
- 旧 `roster.ready` 事件保留；新事件序号递增。前端以最新阵容为准。

---

## 9. 确认并开始

### `POST /api/discussions/:id/confirm`

请求：无 body。

响应 `202`：

```json
{
  "discussion": {
    "id": "d_01",
    "status": "live",
    "startedAt": "2026-11-01T10:00:10.000Z",
    "lastSeq": 2
  }
}
```

规则：

- 仅 `ready` 可开始；`live` 幂等返回当前状态（200）。
- 开始后服务端异步运行主持人开场与后续轮次。
- 客户端随后连接 `GET /api/discussions/:id/stream?after=lastSeq`。
- 重复确认不得重复启动 runner。

---

## 10. 结束讨论

### `POST /api/discussions/:id/end`

请求：无 body。

响应 `202`：

```json
{
  "discussion": {
    "id": "d_01",
    "status": "summarizing",
    "lastSeq": 14
  }
}
```

规则：

- `live` → `summarizing` → 调 LLM 总结 → `ended`。
- `summarizing` / `ended` 幂等返回当前状态（200/202）。
- `draft`/`generating`/`ready` 返回 `409 INVALID_STATE`。
- 结束后不再产生新发言；正在流式输出的消息允许完成或中止，二者都必须落一条最终 `message.completed` 或标记丢弃，不能留下半条。

---

## 11. 回放事件

### `GET /api/discussions/:id/events`

查询参数：

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| after | number | 0 | 返回 seq > after 的事件 |
| limit | number | 500 | 1–1000 |

响应 `200`：

```json
{
  "items": [
    {
      "id": "evt_01",
      "seq": 1,
      "type": "roster.ready",
      "payload": { "experts": [] },
      "createdAt": "2026-11-01T10:00:08.000Z"
    },
    {
      "id": "evt_02",
      "seq": 2,
      "type": "discussion.started",
      "payload": { "startedAt": "2026-11-01T10:00:10.000Z" },
      "createdAt": "2026-11-01T10:00:10.000Z"
    }
  ],
  "lastSeq": 2,
  "hasMore": false
}
```

说明：

- 仅返回持久化语义事件，不返回 `message.delta`。
- 回放按 `seq` 升序；前端用与直播相同的 reducer 重放。
- 分页时客户端用最后一条 `seq` 作为下一次 `after`。

---

## 12. SSE 实时流

### `GET /api/discussions/:id/stream`

查询参数：

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| after | number | lastSeq | 只推送 seq > after 的事件 |

请求头：

- `Accept: text/event-stream`
- 重连时浏览器自动带 `Last-Event-ID`；服务端取 `max(Last-Event-ID, after)`。

响应头：

```text
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

事件格式：

```text
event: message.completed
id: 12
data: {"message":{...}}

```

说明：

- `id` 为持久化事件 `seq`；`message.delta` 不带 `id`。
- 每 15s 发送注释心跳：`: heartbeat`
- 连接建立后先发 `stream.ready`（无 id）：

```text
event: stream.ready
data: {"lastSeq":12}

```

- 客户端断线重连后，从 `Last-Event-ID` 之后补发；补发期间不重复推送已确认事件。
- 会话已 `ended` 时，服务端补发到结尾后关闭连接。

详细 payload 见 [SSE 事件契约](04-SSE事件契约.md)。

---

## 13. 错误码

| code | HTTP | 说明 | 前端处理 |
| --- | --- | --- | --- |
| VALIDATION_ERROR | 400 | 参数不合法 | 表单提示 |
| NOT_FOUND | 404 | 讨论不存在 | 返回首页 |
| INVALID_STATE | 409 | 当前状态不允许 | 刷新详情/提示 |
| RATE_LIMITED | 429 | 请求过多 | 稍后重试 |
| ROSTER_GENERATION_FAILED | 502 | 阵容生成失败 | 显示重试 |
| LLM_TIMEOUT | 504 | 模型超时 | 显示重试/降级 |
| LLM_INVALID_OUTPUT | 502 | 模型输出无法解析 | 自动重试一次后提示 |
| INTERNAL | 500 | 未预期错误 | 通用错误，不显示堆栈 |

---

## 14. 安全与限制

- 仅本地开发时允许 `http://localhost:5173` / `http://127.0.0.1:5173` CORS。
- 请求体最大 16KB；topic 最长 200 字。
- 每 IP/会话创建讨论限流（如 10 次/分钟）。
- 所有 LLM 输出先 parse 再落库；不把原始 JSON 直接返回前端。
- 日志脱敏：不记录 `Authorization`、Key、完整 prompt。
- 前端 bundle 与 API 响应中不得出现 `sk-` 片段。

---

## 15. 待评审

1. 创建讨论是否同步生成阵容（当前方案）还是异步任务 + SSE；为降低前端复杂度，建议同步。
2. `POST /confirm` 是否返回 `202`；建议是。
3. `GET /events` 是否需要 `type` 过滤；MVP 不需要。
4. 失败讨论是否保留在首页；建议保留并标记“生成失败”，可重试。
5. 是否允许删除讨论；P1，不做。
