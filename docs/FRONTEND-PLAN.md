# 前端设计规划 v0.1（FRONTEND-PLAN）

- 日期：2026-10-31
- 状态：G1 设计输入，待 PM 与三角色评审
- Owner：前端工程师
- 对应任务：FE-01（只做设计，不写页面代码）
- 输入契约：[PRD](PRD.md)、[API 契约](03-API契约.md)、[SSE 事件契约](04-SSE事件契约.md)、[ER 图](ER.md)、[技术选型](01-技术选型.md)、[角色与协作 SOP](02-角色与协作SOP.md)

---

## 0. 结论摘要

| # | 决策 | 一句话 |
| --- | --- | --- |
| D1 | 路由只有 4 条 | `/`、`/new`、`/d/:id`、`/d/:id/replay`；阵容确认不是独立页面，是 `/d/:id` 内部的 `Lobby` 视图 |
| D2 | 页面永不滚动 | `html/body/#root` 高度锁死 + 每个面板 `min-height:0` + `overflow:auto`；任何"整页滚"都视为 bug |
| D3 | 状态三层分离 | 可重放的进 **reducer**，跨组件的"怎么看"进 **Zustand**，每帧在变的进 **StreamBuffer**（不进 React 状态树） |
| D4 | 直播与回放**同一份 reducer、同一批组件** | 唯一差别是"事件来源 + 时钟"；回放的每次前进都等价于一次 seek，从零重算，杜绝增量 bug |
| D5 | SSE 自管重连，不用浏览器原生重连 | 因为要可见的 `reconnecting` 状态、要在 404/ended 时停止、要每次带准确的 `after` |
| D6 | 演播厅感 = 聚光灯 + 席位 + 字幕条 + 直播信号 | 明确的反面清单：不要卡片墙、不要聊天气泡、不要彩色渐变按钮 |

**给 PM 的最重要一条**：契约里 `POST /api/discussions` 是同步生成阵容（最长 10–12s 的阻塞请求），且失败/超时后前端**拿不到 `discussionId`**。这是 G1 里唯一必须改的 P0 契约项（详见 §12.5 与 F-02）。

---

## 1. 设计目标与不做什么

### 1.1 目标（与 PRD §1.4 成功标准一一对应）

1. 首页 3 秒内让人看懂"有几场在直播、进度到哪、结论是什么"。
2. 演播厅的第一印象是**舞台**，第二印象才是"信息很全"。
3. 用户上滚回看时不被打断；想回到现场只需一次点击。
4. 中途断网 10 秒，恢复后**不丢消息、不重复、不跳变**。
5. 回放和直播看起来是同一场节目，不是两个页面。
6. 三档屏宽下，页面本身永远不滚动。

### 1.2 前端不做什么

- 不做 Agent 行为判定（谁该发言、发言是否合规）——只展示契约里的公开字段。
- 不做共识/分歧的去重与合并——契约明确由 AI/后端负责，前端全量替换。
- 不拦截或修正 LLM 内容语义——只做渲染与长度截断（仅在视觉溢出时）。
- 不引入网络字体、图标库 CDN、远端图片——本地应用必须可离线首屏。
- 不在 P0 做虚拟滚动、WebSocket、Service Worker、国际化。

---

## 2. 页面与路由

### 2.1 路由表

| 路由 | 页面 | 渲染依据 | 说明 |
| --- | --- | --- | --- |
| `/` | 首页 | `GET /api/discussions` | 进行中 + 待确认 + 最近结束 |
| `/new` | 创建议题 | 本地表单状态 | 含"生成中"骨架舞台 |
| `/d/:id` | 演播厅 | `GET /api/discussions/:id` + SSE | 内部按 `status` 切换 `Lobby` / `Stage` 两个视图 |
| `/d/:id/replay` | 回放 | `GET /api/discussions/:id` + `GET .../events` | 只用 REST，不连 SSE |
| `*` | 404 | — | 3 秒后自动回 `/`，并提供"返回首页"按钮 |

**为什么阵容确认不单独占一条路由**：`ready → live` 是**状态迁移**，不是导航。放在同一路由下，确认成功后不需要卸载/重建 Provider，SSE 连接、reducer、滚动位置都能原地延续，"灯亮开播"的转场才做得出来。刷新 `/d/:id` 也能自动落到正确视图。

### 2.2 `/d/:id` 的视图派生（唯一真源是 `status`）

```text
status = draft | generating  → LobbyView（生成中骨架 / 若来自刷新则轮询详情）
status = ready               → LobbyView（阵容卡 + 确认 / 重新生成）
status = failed              → LobbyView（失败态 + 重新生成 + 返回首页）
status = live                → StageView（连 SSE）
status = summarizing         → StageView（保留最后画面 + "主持人正在收尾"）
status = ended               → StageView（顶部总结卡 + PlaybackBar 变为"回看整场"）
```

`status` 只从服务端来。前端只在两类情况本地改写它：`POST /confirm` 成功后（`ready → live`，立即连流，不等 next 事件）、`POST /end` 返回 202 后（`live → summarizing`）。

### 2.3 每个页面的入口与出口

| 页面 | 入口 | 出口 |
| --- | --- | --- |
| 首页 `/` | 应用根路径；任意页"返回首页"；404 兜底；`NOT_FOUND` 错误兜底 | `[发起新讨论]` → `/new`；进行中卡片 → `/d/:id`；待确认卡片 → `/d/:id`（Lobby）；已结束卡片 → `/d/:id/replay` |
| 创建 `/new` | 首页 CTA；首页空态的"从示例议题开始" | 成功 → `replace('/d/:id')`（**replace，防止回退到已提交表单**）；失败 → 停留原地；`[返回]` → `/` |
| 演播厅 `/d/:id` | 首页进行中/待确认卡片；创建成功；直接输入 URL | `[返回首页]` → `/`（**不结束讨论**）；`[结束讨论]` → 原地进入 `summarizing`；`ended` 后 `[回看整场]` → `/d/:id/replay`；`404` → `/` |
| 回放 `/d/:id/replay` | 首页已结束卡片；演播厅 `ended` 后的 CTA；直接 URL | `[返回首页]` → `/`；`[回到演播厅]` → `/d/:id`；未结束时 → 提示并跳 `/d/:id` |

**离开语义**：任何离开 `/d/:id` 的行为都只做一件事——`stream.dispose()`。绝不调用 `POST /end`。PRD §5.2 的"离开页面不等于结束讨论"在这里落到代码就是"路由卸载 = 关连接"。

### 2.4 前端目录结构（G2 落地用）

```text
apps/web/src/
├── app/
│   ├── router.tsx              # 4 条路由 + 404
│   ├── AppShell.tsx            # 高度锁 + 舞台背景 + Toast
│   └── providers/              # QueryClient? 否；只用 fetch 封装 + SessionProvider
├── pages/
│   ├── HomePage/
│   ├── CreatePage/
│   ├── StudioPage/             # LobbyView + StageView
│   └── ReplayPage/
├── features/
│   ├── discussion-list/
│   ├── create-discussion/
│   ├── roster/
│   ├── session/                # SessionProvider / reducer 绑定 / selectors
│   ├── stream/                 # SessionStream、StreamBuffer、backoff
│   ├── transcript/
│   ├── expert-rail/
│   ├── insights/
│   └── replay/                 # useReplayController、Timeline
├── components/                 # 跨 feature 的共享组件（§4.1）
├── styles/
│   ├── tokens.css              # CSS 变量（§8）
│   ├── globals.css             # 高度锁、滚动规则、焦点样式
│   └── motion.css              # keyframes + reduced-motion 覆盖
├── lib/
│   ├── api.ts                  # fetch 封装 + 统一错误映射
│   ├── time.ts                 # 相对时间、mm:ss、时区安全
│   ├── color.ts                # 专家色合法性/可读前景色
│   └── scroll.ts               # 吸附滚动 hook
└── test/                       # 组件测试 + fixture 事件序列
```

`packages/shared/` 只放**协议与纯函数**：`SessionView` 类型、`sessionReducer`、事件 Zod schema、`REPLAY_TIME_RULES`。前端不复制一份 reducer，直接 import（ADR-03 的落地方式）。`packages/shared` 归 PM 所有，前端只读、只提变更。

---

## 3. 三档响应式布局

### 3.1 断点定义

| 档位 | 宽度 | 布局 | 专家栏 | 洞察栏 |
| --- | --- | --- | --- | --- |
| XL（超宽/大桌面） | ≥ 1440 | 三栏 + 顶栏 + 底栏 | 左侧常驻 `clamp(300px, 21vw, 360px)` | 右侧常驻 `clamp(320px, 24vw, 400px)` |
| L（普通桌面） | 1024–1439 | 两栏 + 右侧抽屉 | 左侧常驻 264px | 覆盖式抽屉 400px（默认收，顶栏有按钮 + 未读数） |
| M（平板） | 768–1023 | 两栏（窄专家列）+ 抽屉 | 左侧图标列 92px，点头像弹出详情 | 抽屉 360px |
| S（手机） | < 768 | 单栏 + 底部 Tab | 独立 Tab「专家」 | 独立 Tab「共识」 |

断点用 `min-width`（mobile-first），Tailwind 自定义 `screens: {md: '768px', lg: '1024px', xl: '1440px'}`。`<1024` 时顶栏右侧固定出现一个 `[共识 3]` 徽标按钮，徽标数 = 自上次打开抽屉后新增/变更的洞察条数。

### 3.2 "body 永不滚动"的实现约束

```css
/* globals.css */
html, body, #root { height: 100%; }
body {
  margin: 0;
  overflow: hidden;              /* 硬规则 1 */
  overscroll-behavior: none;     /* 禁掉 iOS 回弹与滚动链 */
  background: var(--stage-1000);
}
```

演播厅外壳（三档通用）：

```css
.studio-shell {
  height: 100dvh;                 /* <768 用 dvh，避免移动端地址栏吃掉高度 */
  display: grid;
  gap: 0;
}
@supports not (height: 100dvh) {
  .studio-shell { height: 100vh; }
}

/* ≥1440 */
@media (min-width: 1440px) {
  .studio-shell {
    grid-template-columns: var(--rail-w) minmax(0, 1fr) var(--insight-w);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      "header header  header"
      "rail   stage   insight"
      "footer footer  footer";
  }
}

/* 1024–1439：右栏退出网格，改为覆盖式抽屉 */
@media (min-width: 1024px) and (max-width: 1439px) {
  .studio-shell {
    --rail-w: 264px;
    grid-template-columns: var(--rail-w) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      "header header"
      "rail   stage"
      "footer footer";
  }
}

/* 768–1023：专家栏变图标列 */
@media (min-width: 768px) and (max-width: 1023px) {
  .studio-shell {
    --rail-w: 92px;
    grid-template-columns: var(--rail-w) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      "header header"
      "rail   stage"
      "footer footer";
  }
}

/* <768：单栏 + 底部 Tab */
@media (max-width: 767px) {
  .studio-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      "header"
      "stage"
      "tabbar";
  }
}
```

**保证各区域独立滚动的 7 条规则**（每条都是踩过的坑，写成 lint 级约束）：

1. `html/body/#root` 三层都 `height:100%` + `body{overflow:hidden}`。
2. 所有 grid/flex 子容器必须 `min-height: 0`（默认 `min-height:auto` 会被内容撑破，滚动失效——这是最高频的坑）。
3. 网格列一律 `minmax(0, 1fr)`，禁止裸 `1fr`；flex 子项加 `min-width:0`。
4. 滚动容器统一 `.scroll-y { overflow-y:auto; overflow-x:hidden; overscroll-behavior: contain; }`，并保留 4px 细滚动条（`scrollbar-width: thin` + `::-webkit-scrollbar`），**不允许 `overflow:hidden` 假装滚动**。
5. 滚动容器内部**禁止**出现 `h-screen`、`100vh`、`position:absolute; inset:0` 这类脱离父级约束的写法；高度只能来自父 grid 行。
6. Transcript 容器加 `overflow-anchor: none`，由我们自己的吸附逻辑接管滚动，避免浏览器滚动锚定与"跳到最新"打架。
7. 滚动区域边缘加 16px 渐隐遮罩（`mask-image`），提示"这里还能滚"，但不拦截指针。

### 3.3 各档区域分配细节

| 区域 | ≥1440 | 1024–1439 | 768–1023 | <768 |
| --- | --- | --- | --- | --- |
| StageHeader | 议题 + 状态 + 进度 + 结束按钮，单行 | 同左，议题最多 1 行省略 | 议题 2 行 + 图标按钮 | 议题 1 行 + `⋯` 菜单 |
| ExpertRail | 主持人置顶 + 专家 01–05 竖排，每张含 status/focus | 同左，去掉 focus 第二行（hover/tooltip 显示） | 圆形头像 + 状态点 + 席位号，点头像 → Radix Popover 展示详情 | 独立 Tab，卡片宽度 100% |
| Transcript | 主区域，最大宽度 `min(860px, 100%)` 居中 | 同左 | 同左，左右 padding 降到 12px | 同左，padding 8px |
| InsightPanel | 右栏常驻，三段式 | 抽屉（覆盖，不挤压 transcript） | 抽屉 | 独立 Tab |
| PlaybackBar | 底部常驻 | 底部常驻 | 底部常驻 | **不占底部**，折进 Transcript 顶部 sticky 条（底部被 Tab 占用） |
| 底部 TabBar | 无 | 无 | 无 | 固定 56px + `env(safe-area-inset-bottom)` |

### 3.4 移动端键盘

MVP 演播厅**没有输入框**（用户不能插话，P1）。唯一输入场景是 `/new` 的议题 textarea：使用 `visualViewport` 监听，`resize` 时把提交按钮抬到虚拟键盘上方；textarea 加 `scroll-margin-bottom: 120px`。PRD §9.3 的"输入框不被键盘遮挡"即在此落地。

---

## 4. 组件树

### 4.1 共享组件（跨页面 / 直播与回放共用）

> 标记约定：**[共]** = 页面间共享；**[同]** = 直播与回放共用；**[共][同]** = 两者皆是。

| 组件 | 标记 | 职责 | 关键 props |
| --- | --- | --- | --- |
| `AppShell` | [共] | 高度锁、舞台背景、Toast 容器 | `children` |
| `StageBackdrop` | [共] | 顶光/暗角/网格噪点，纯装饰 `aria-hidden` | `tone: 'warm' \| 'cool'` |
| `Panel` / `PanelHeader` | [共] | 面板容器：1px 线、3% 底、标题栏粘顶 | `title`, `count`, `action`, `scroll` |
| `StatusPill` | [共][同] | 会话/连接状态：`LIVE`/`生成中`/`回放`/`重连中`/`已结束`/`失败` | `status`, `pulse`, `elapsed` |
| `ProgressMeter` | [共][同] | 轮次进度；无分母时为不确定态（见 F-23） | `value`, `max?`, `label` |
| `ExpertCard` | [共][同] | 席位卡；`variant: spotlight \| compact \| avatar` | `expert`, `status`, `focus`, `active` |
| `SpeakerDot` / `AvatarDot` | [共][同] | 专家色圆点/头像，自动算可读前景色 | `color`, `name`, `size` |
| `Transcript` | [共][同] | 消息列表 + 吸附滚动 + 跳转按钮 | `messages`, `streaming`, `mode` |
| `MessageBubble` | [共][同] | 发言条（非聊天气泡） | `message`, `highlight` |
| `StreamingBubble` | [同] | 流式发言条，唯一订阅 StreamBuffer 的组件 | `messageId`, `speaker`, `state` |
| `InsightPanel` | [共][同] | 三段式洞察容器 | `insights`, `updating` |
| `ConsensusPanel` / `DivergencePanel` / `OpenQuestions` | [共][同] | 三类列表（共用 `InsightSection` 实现） | `items`, `onEvidenceClick` |
| `EvidenceChips` | [共][同] | "依据 N 条" → 点击定位到消息 | `ids`, `count` |
| `PlaybackBar` | [共][同] | 底部控制条，`mode` 分支 | `mode: 'live' \| 'replay'` + 各自子 props |
| `EmptyState` / `ErrorState` / `SketchCard`（骨架） | [共] | 通用空/错/加载 | `title`, `desc`, `action` |
| `Toast` / `InlineError` | [共] | 可恢复错误 | — |
| `Button` / `IconButton` / `Segmented` / `Dialog` / `Drawer` / `Popover` / `Tooltip` / `Slider` | [共] | Radix 原语封装，统一焦点环与动效 | — |

### 4.2 完整组件树

```text
App
└─ AppShell                                        [共]
   ├─ StageBackdrop                               [共]
   ├─ ToastViewport                               [共]
   └─ Router
      ├─ HomePage                        /
      │  ├─ PageHeader                             [共]
      │  ├─ NewDiscussionCta
      │  ├─ SectionTitle「正在直播 / 待确认 / 最近结束」
      │  ├─ DiscussionGrid
      │  │  ├─ DiscussionCard
      │  │  │  ├─ AvatarStack → AvatarDot ×N        [共]
      │  │  │  ├─ StatusPill                        [共]
      │  │  │  ├─ ProgressMeter                     [共]
      │  │  │  └─ SummaryPreview
      │  │  └─ DiscussionCardSkeleton ×3             [共]
      │  ├─ HomeEmpty（= EmptyState + 3 个示例议题）  [共]
      │  └─ HomeError（= ErrorState + 重试）          [共]
      │
      ├─ CreatePage                      /new
      │  ├─ CreateForm
      │  │  ├─ TopicField（textarea 2–200 字，字数环）
      │  │  └─ ExpertCountStepper（3–6，默认 4）
      │  ├─ RosterGenerating（N 个空席位骨架 + 计时 + 取消）
      │  └─ CreateError（InlineError + 重试/返回）    [共]
      │
      ├─ StudioPage                      /d/:id    ← SessionProvider（每次挂载新建）
      │  ├─ LobbyView      status ∈ {generating, ready, failed}
      │  │  ├─ RosterLobby
      │  │  │  ├─ HostSeat  = ExpertCard variant="spotlight"   [共]
      │  │  │  ├─ RosterGrid → ExpertCard × N                  [共]
      │  │  │  └─ ConfirmBar（重新生成 / 确认开播）
      │  │  └─ RosterGenerating / RosterFailed
      │  └─ StageView      status ∈ {live, summarizing, ended}
      │     ├─ StageHeader
      │     │  ├─ TopicTitle / StatusPill / ProgressMeter      [共]
      │     │  ├─ InsightToggle（<1024 才出现）
      │     │  └─ EndDiscussionButton
      │     ├─ ExpertRail
      │     │  ├─ HostSeat
      │     │  └─ ExpertCard × N → SpeakingBars / StatusDot    [共]
      │     ├─ Transcript                                       [共][同]
      │     │  ├─ TurnDivider（"第 4 轮 · 反驳"）
      │     │  ├─ MessageBubble × N                             [共][同]
      │     │  ├─ StreamingBubble（最多 1 个）                  [同]
      │     │  ├─ TypingPlaceholder（turn.started 后、首 delta 前）
      │     │  └─ JumpToLatest
      │     ├─ InsightPanel                                     [共][同]
      │     │  ├─ ConsensusPanel / DivergencePanel / OpenQuestions
      │     │  └─ InsightItem → EvidenceChips                   [共][同]
      │     ├─ InsightDrawer（Radix Dialog，<1440）              [共]
      │     ├─ SummaryCard（ended 时置顶插入 Transcript）
      │     └─ PlaybackBar mode="live"                          [共][同]
      │        ├─ LiveDot + "直播中 · 第 6 轮"
      │        ├─ AutoScrollToggle  [暂停自动滚动]
      │        ├─ [⤓ 跳到最新]（未吸附时出现）
      │        └─ ReplayCta（ended 时替换整条）
      │
      └─ ReplayPage                      /d/:id/replay  ← 同一 reducer、同一 SessionProvider
         ├─ StageHeader（状态位改为「回放」）
         ├─ ExpertRail                                         [共][同]
         ├─ Transcript                                         [共][同]
         ├─ InsightPanel                                       [共][同]
         └─ PlaybackBar mode="replay"                          [共][同]
            ├─ PlayPause
            ├─ SpeedMenu（1x / 1.5x / 2x）
            ├─ Timeline（Radix Slider + 轮次刻度）
            └─ "第 3 / 12 轮"
```

**共用的硬证据**：`Transcript`、`MessageBubble`、`InsightPanel`、`ExpertRail`、`PlaybackBar`、`StatusPill` 六个组件在 `/d/:id` 与 `/d/:id/replay` 中是**同一份源码、同一套 props**，没有任何 `if (isReplay)` 分支进入渲染逻辑。唯一的分支点在 `PlaybackBar` 的控制区（直播显示"跳到最新"，回放显示"播放/倍速/时间线"），且这一段拆成两个子组件，互不影响内容区。

### 4.3 组件数据来源约定

| 组件 | 数据来源 | 禁止 |
| --- | --- | --- |
| `ExpertRail` / `ExpertCard` | `SessionView.roster` + `currentTurn` | 不接受本地时间驱动的"假装发言" |
| `Transcript` | `SessionView.messages`（纯事件投影） | 不直接读 SSE |
| `StreamingBubble` | `StreamBuffer`（`useSyncExternalStore`） | 不写入 `SessionView` |
| `InsightPanel` | `SessionView.insights`（全量快照） | 不做增量合并、不做本地去重 |
| `PlaybackBar` | `Zustand`（autoScroll 开关、速度）+ `ReplayController` | 不改 `SessionView` |
| `StatusPill` | 派生 selector（status + connection） | 不自己计时 |

---

## 5. 前端状态机

### 5.1 页面级异步状态（列表/详情/回放共用同一套壳）

```ts
type AsyncStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
interface AsyncView<T> {
  status: AsyncStatus;
  data: T | null;
  error: AppError | null;   // { code, message, retryable }
  retry: () => void;
}
```

| 页面 | loading | empty | error | reconnecting |
| --- | --- | --- | --- | --- |
| 首页 | 3 张骨架卡（保持网格占位，不跳动） | "还没有讨论" + `[发起第一场]` + 3 个示例议题（一键填充） | `ErrorState`："首页加载失败" + 重试 + 显示缓存（若有） | 不适用；改为 5s 轮询，轮询失败连续 3 次才置 error |
| 创建 | 提交中：按钮 loading + 表单禁用 | 不适用 | 按 `code` 分支：`VALIDATION_ERROR` 走高亮字段；`RATE_LIMITED` 走"1 分钟后再试"；`ROSTER_GENERATION_FAILED`/`LLM_TIMEOUT` 走"重新生成 / 返回首页" | 不适用 |
| 演播厅 Lobby | 骨架席位 ×N + 计时 + "通常 5–10 秒" | 不适用 | 同上 + `[重新生成]` + `[返回首页]` | 不适用 |
| 演播厅 Stage | 首屏 `GET detail` 的骨架（顶栏 + 3 栏灰块） | `messages` 为空且已 `live` → "主持人即将开场" + 呼吸点 | 非断线的致命错误 → 全屏 `ErrorState` + "回到首页查看" | 顶栏下方插入 32px 提示条 `StatusPill=重连中` + 第 n 次 + 倒计时；**不清空已有内容** |
| 回放 | 事件拉取骨架 | `events` 为空 → "这场讨论没有可回放内容" + 返回 | `409`（未结束）→ 自动跳 `/d/:id`；`404`→首页 | 不适用（纯 REST，可整体重试） |

> `empty` 是 `ready && 数据为空` 的视图分支，不是独立状态，避免与 `loading` 互相打架。

### 5.2 连接级状态（只在 Stage 存在）

```ts
type ConnectionState =
  | 'idle'          // 还没开始连
  | 'connecting'    // new EventSource() 后，未收到 stream.ready
  | 'open'          // 已收到 stream.ready
  | 'reconnecting'  // 出错关闭，等待下一次重试（带 attempt 计数）
  | 'backfilling'   // 检测到 seq 跳号，正在补拉 /events
  | 'closed'        // 会话 ended 或组件卸载，主动关闭
  | 'degraded'      // 不支持 EventSource，降级为轮询
  | 'fatal'         // 404 / 403 / 重试耗尽
```

转换：

```text
idle ──start()──▶ connecting ──stream.ready──▶ open
                     │                          │
                     │ onerror                  │ onerror(可重试)
                     ▼                          ▼
                  reconnecting ◀────────────────┘
                     │ backoff 到期
                     └──▶ connecting
open ──seq 跳号──▶ backfilling ──补齐完成──▶ open
open ──discussion.ended──▶ closed
any  ──404/403 或 attempt>6──▶ fatal
any  ──不支持 EventSource──▶ degraded
```

`reconnecting` 的退避：`[500, 1000, 2000, 4000, 8000, 10000] ms` + 0–250ms 抖动，最多 6 次（约 25s）。`document.hidden` 时把退避上限放宽到 30s，避免后台标签页空转。

### 5.3 会话级状态机（服务端 `status` 的前端投影）

```text
draft ──┐
generating ──▶ ready ──confirm──▶ live ──(自然收束 / 用户结束)──▶ summarizing ──▶ ended
     └──▶ failed ◀──(生成失败)         │                                    │
                                        └──────────(runner 崩溃)──▶ failed ◀─┘(总结失败仍要 ended)
```

前端新增两个**纯 UI 派生状态**，不写回服务端：

- `expertStatus`: `idle | preparing | speaking`（单专家维度，见 §5.6）
- `viewMode`: `lobby | stage`（由 `status` 派生）

**会话状态 → 视图**：

| status | viewMode | 顶栏 | 底部条 | SSE |
| --- | --- | --- | --- | --- |
| generating | lobby | 生成中 + 计时 | 无 | 不连 |
| ready | lobby | 待确认 | 无 | 不连 |
| failed（生成期） | lobby | 生成失败 | 无 | 不连 |
| live | stage | LIVE + 轮次 + 计时 | 直播控制 | 连 |
| summarizing | stage | 收尾中（暖金 → 呼吸变慢） | "主持人正在总结…" | 连（等 summary/ended） |
| ended | stage | 已结束 | 回看整场 | 主动关 |
| failed（运行期） | stage | 已中断 | 回看已有内容 / 返回首页 | 主动关 |

### 5.4 `SessionView`：直播与回放共用的数据结构

```ts
// packages/shared/src/session-view.ts（PM 拥有；前端只消费）
export type SessionStatus =
  | 'draft' | 'generating' | 'ready' | 'live' | 'summarizing' | 'ended' | 'failed';
export type Intent = 'opening' | 'probe' | 'rebut' | 'support' | 'extend' | 'summary';
export type InsightType = 'consensus' | 'divergence' | 'open_question';

export interface Expert {
  id: string; role: 'host' | 'expert';
  name: string; profession: string; title: string;
  stance: string; color: string; focus: string; sortOrder: number;
}
export interface Message {
  id: string; expertId: string;
  speakerName: string; speakerTitle: string; speakerColor: string;
  content: string; intent: Intent; turnIndex: number; createdAt: string;
}
export interface Insight {
  id: string; type: InsightType; content: string;
  evidenceMessageIds: string[]; updatedAt: string;
}
export interface CurrentTurn {
  turnIndex: number; speakerId: string; intent: Intent; focus: string;
}

export interface SessionView {
  discussionId: string;
  topic: string;                     // 来源：GET detail / 路由 state
  status: SessionStatus;
  expertCount: number;
  lastSeq: number;                   // 已应用的最大 seq，单调不减
  roster: Expert[];                  // 按 sortOrder
  messages: Message[];               // 按 turnIndex 升序（不是 push 顺序）
  insights: Insight[];               // 全量快照，不分组
  summary: string | null;
  currentTurn: CurrentTurn | null;
  startedAt: string | null;
  endedAt: string | null;
  failure: { code: string; message: string; retryable: boolean } | null;
}

export const emptySession = (discussionId: string): SessionView => ({ /* 全空 */ });
```

**三个刻意的设计选择**：

1. **`streaming` 不在 `SessionView` 里**。它没有事件来源、不可重放、断线即丢。放进 reducer 会让"回放 = reduce(events)"这条不变式破功。
2. **`messages` 按 `turnIndex` 排序插入，不是 push**。补发/乱序时能自愈，不需要额外的排序步骤。
3. **`insights` 存平铺数组**，分组交给 `useMemo` 的 selector。因为契约是全量快照替换，前端保持"一个字段一个真相"。

### 5.5 reducer 与不变式

```ts
type SessionAction =
  | { type: 'hydrate'; detail: DetailResponse }        // GET detail / 轮询降级 / 重连自检
  | { type: 'event'; event: PersistedEvent }           // 带 seq 的持久化事件
  | { type: 'stream.failed'; error: AppError }         // 连接致命错误
  | { type: 'reset' };
```

`reduce` 的一个 switch 覆盖 7 种持久化事件：

| 事件 | 处理 |
| --- | --- |
| `roster.ready` | `roster = payload.experts`（全量替换，兼容重新生成） |
| `discussion.started` | `status='live'`, `startedAt` |
| `turn.started` | `currentTurn = {...}`，把上一位的 status 归零 |
| `message.completed` | 按 `turnIndex` 有序插入 `messages`（按 `id` 去重）；`currentTurn = null` |
| `insight.updated` | `insights = payload.insights`（全量替换，且 `seq` 小于已应用者则忽略） |
| `summary.completed` | `summary = content`；`status = 'summarizing'`（等 ended） |
| `discussion.ended` | `status='ended'`, `endedAt` |

**不变式（写成单测，也写给 QA 做 E2E 断言）**：

- **I1 等价性**：`reduce(empty, allEvents) ≡ hydrate(detail)`（除 `topic` 等仅详情有的展示字段）。这是"回放与直播一致"的形式化定义。
- **I2 幂等**：`event.seq <= lastSeq` → 返回原对象（引用不变，避免无谓重渲染）。
- **I3 单调**：`lastSeq = max(lastSeq, event.seq)`，永不回退。
- **I4 顺序无关**：任意乱序应用同一批事件，最终 `messages` 顺序一致（靠 `turnIndex` 插入保证）。
- **I5 纯净**：reducer 不读 `Date.now()`、不读 `window`、不生成 id。时间只从事件里取。

### 5.6 专家三态的派生（纯前端，不等事件）

`ExpertStatus = idle | preparing | speaking`，由 `currentTurn` + `StreamBuffer` + 一次完成时间戳推导：

| 条件 | 状态 | 视觉 |
| --- | --- | --- |
| `currentTurn?.speakerId === expert.id` 且该轮尚无 delta | `preparing` | 呼吸光圈（2.2s）+ "正在组织发言" + 三根静止音柱 |
| 该轮已有 delta，且未收到 `message.completed` | `speaking` | 聚光灯 + 音柱跳动 + 气泡逐字 |
| 收到 `message.completed` 后 1.2s 内 | `speaking`（尾音） | 光圈缓慢收回，避免瞬切 |
| 其他 | `idle` | 3% 亮度 + 静态点 |

**兜底**：`preparing` 超过 20s（可配 `VITE_TURN_TIMEOUT_MS`）→ 强制回落 `idle`，并在 Transcript 尾部插一条系统提示"这一轮没有完成，主持人正在继续"。**绝不允许永不熄灭的脉冲**（对应契约缺陷 F-03）。

### 5.7 Zustand / reducer / StreamBuffer 的边界

> **一句话规则：能被事件重放的进 reducer；跨组件/跨路由共享的"怎么看"进 Zustand；路由内私有的进 `useState`；每帧在变的进 StreamBuffer。**

| 层 | 放什么 | 不放什么 | 生命周期 |
| --- | --- | --- | --- |
| **reducer**（`useReducer` in `SessionProvider`） | `SessionView` 全量 | 任何 UI 开关、流式文本、时间戳 | 随 `/d/:id` 或 `/replay` 挂载创建，卸载销毁 |
| **Zustand `useUiStore`** | `mobileTab`、`insightDrawerOpen`、`railPopoverId`、`autoScrollPaused`、`replaySpeed`（记忆上次）、`toastQueue`、`reducedMotion` | 任何会话数据 | 全局单例；仅 `replaySpeed`/`railCollapsed` 持久化 |
| **Zustand `useRegistryStore`** | `{ [discussionId]: { status, turnCount, lastSeenAt } }`，供首页卡片在路由切换时不闪 | transcript、insights | 全局单例，只存摘要，容量上限 20 |
| **StreamBuffer**（React 外的 class） | 当前 messageId 的已收字符 + 待刷队列 | 已完成的完整消息 | 随连接创建，随消息完成/断线清空 |
| **React `useState`** | 表单、回放 cursor/speed、抽屉焦点 | 会话数据 | 组件级 |

```ts
// features/stream/StreamBuffer.ts
class StreamBuffer {
  private text = new Map<string, string>();     // messageId -> 已接受文本
  private reveal = new Map<string, string>();   // messageId -> 已显示文本
  private listeners = new Set<() => void>();
  private rafId = 0;

  append(messageId: string, delta: string) { /* 追加 + 调度一帧 */ }
  commit(messageId: string, full: string) { /* 用最终全文替换 */ }
  drop(messageId: string) { /* 断线/失败丢弃 */ }
  snapshot(messageId: string): string | null { /* 供 useSyncExternalStore */ }
  subscribe(fn: () => void): () => void { /* ... */ }
}
```

**为什么 delta 不进 React 状态**：一条 120 字发言分 25–40 个 delta 到达，若每次 `dispatch` 都会触发 SessionProvider 全量重渲染（Transcript + ExpertRail + InsightPanel），在低端设备上必然掉帧。放 React 之外，只有 `StreamingBubble` 一个组件订阅，重渲染成本被限制在一行文本。

**为什么不用 Zustand 装 `SessionView`**：`useReducer` + Context 保证 reducer 是纯函数、可直接与 `packages/shared` 共享、可被 Vitest 单测、可被回放复用。Zustand 的中间件会引入"状态从哪来"的歧义，与 I1 不变式冲突。

**Context 不做 selector 化**（明确的技术债取舍）：P0 单场最多 15 条消息、6 位专家，全量重渲染 < 2ms，收益不抵复杂度。**唯一的性能红线是"token 不得进入 React 重渲染路径"**，其余交给 `React.memo` + 稳定 key。

### 5.8 回放状态机

```ts
type ReplayState = 'idle' | 'loading' | 'paused' | 'playing' | 'seeking' | 'ended' | 'error';
```

```text
idle ──fetch events──▶ loading ──ok──▶ paused ──play──▶ playing
                                       ▲                │ 播放到末尾
                                       │                ▼
                                    pause ◀────────── ended
playing/seeking ──拖动时间线──▶ seeking ──重建完成──▶ paused（或继续 playing）
任意 ──fetch 失败──▶ error ──重试──▶ loading
```

---

## 6. SSE 客户端

### 6.1 封装形态

```ts
// features/stream/SessionStream.ts
interface SessionStreamOptions {
  discussionId: string;
  afterSeq: number;                         // 初始 lastSeq
  onEvent: (e: PersistedEvent) => void;     // 有 seq，交给 reducer
  onDelta: (p: MessageDelta) => void;       // 无 seq，交给 StreamBuffer
  onSignal: (s: StreamSignal) => void;      // stream.ready / error / ended
  onState: (s: ConnectionState, meta: { attempt: number; nextRetryMs?: number }) => void;
  onGap: (fromSeq: number, toSeq: number) => Promise<void>;  // 补拉
}

class SessionStream {
  start(): void;
  reconnectNow(): void;
  dispose(): void;
}
```

内部只用 `EventSource`；`dispose` 幂等；卸载时 `close()` 并清掉所有定时器（**防止 React 严格模式下双挂载泄漏连接**——这是 React 19 开发环境最容易踩的坑）。

### 6.2 连接流程

```text
1. GET /api/discussions/:id            → 拿 status / lastSeq / messages / insights / summary
2. hydrate(reducer)                    → 首屏立刻有内容，不等 SSE
3. new EventSource(`/api/discussions/${id}/stream?after=${lastSeq}`)
4. 收到 stream.ready
     ├─ status === 'ended'  → 立即 close()，不重连
     ├─ status 与本地不一致 → 触发一次 GET detail 重新 hydrate
     └─ 否则                → connection = 'open'
5. 收到带 id 的事件 → 校验 seq → 应用 / 补拉
6. 收到 discussion.ended → 应用 → close() → connection = 'closed'
```

**首屏策略：先 hydrate 后连流，绝不"等流"**。`GET detail` 已经把历史消息、洞察、总结都给了，SSE 只负责"从现在开始"。这样冷启动的空白时间只有一次 REST 往返。

### 6.3 为什么自管重连（不用浏览器原生重连）

| 原因 | 说明 |
| --- | --- |
| 需要可见状态 | 原生 `EventSource` 只有 `onerror`，无法告诉用户"第 3 次重连、5 秒后重试" |
| 需要停止条件 | 原生会无限重试。404（讨论被删）或 403 时必须停，否则刷屏且掩盖真实错误 |
| 需要准确的 `after` | 原生重连会用**首次连接的 URL**（`after` 固定为初始值）+ `Last-Event-ID` 头。若服务端 `max()` 实现有偏差，会重复推送大量事件 |
| 需要 ended 后不再重连 | 服务端正常关闭会被原生当成"断线"并立即重连，制造死循环 |

实现方式：`onerror` 里**同步 `close()`**（掐掉原生重连），然后进入自己的退避计时器，重建 `EventSource` 时带 `?after=lastAppliedSeq`。这样 `Last-Event-ID` 永远落后或等于 `after`，服务端 `max()` 的结果恒等于 `after`，行为可预测。

> 契约 §12 的 `max(Last-Event-ID, after)` 仍然要保留（作为兜底），但前端不再依赖它。

### 6.4 `lastSeq` 与跳号补拉

```text
收到 event(seq):
  seq <= lastSeq            → 丢弃（重复）
  seq === lastSeq + 1       → 应用；lastSeq = seq
  seq > lastSeq + 1         → ① 仍然应用（容忍空洞，先让用户看到最新）
                              ② 记录缺失区间 [lastSeq+1, seq-1]
                              ③ 进入 backfilling：
                                 GET /events?after=lastSeq&limit=1000 循环直到填满
                                 按 seq 升序应用，丢弃已存在的 seq / message.id
                              ④ 回到 open
```

**"先应用、再补洞"而不是"阻塞等补洞"**：用户宁可看到第 15 条消息而暂时缺第 13、14 条，也不愿意整条流停住。补洞在后台做，补齐后 `messages` 按 `turnIndex` 自动归位（见 I4）。

### 6.5 delta 缓冲与按帧刷新

```text
onDelta({ messageId, delta })
  → buffer.append(messageId, delta)
  → 若本帧未调度：requestAnimationFrame(flush)
  → flush:
      对每个有积压的 messageId：
        pending = accepted.length - revealed.length
        step = max(1, ceil(pending * 0.18))        // 自适应追赶
        revealed += accepted.slice(0, step)
      notify()   // 只通知 StreamingBubble
```

| 规则 | 值 | 理由 |
| --- | --- | --- |
| 刷新上限 | 1 次 / 帧（≈60fps） | 契约要求"按帧/50ms 批量刷新" |
| 单帧最大揭示 | `max(1, ceil(积压 × 0.18))` | 积压多时追赶快，短 delta 时逐字显得"在说话" |
| 后台标签页 | `document.hidden` 时退化为 `setTimeout(50ms)` | rAF 在后台被节流到 0，会假死 |
| `prefers-reduced-motion` | 每帧直接对齐 `accepted`（不做逐字） | 无障碍硬要求 |
| 单条上限 | 超过 400 字仍继续（不丢数据），只是不再做逐字 | 防御异常长输出 |

### 6.6 `message.completed` 与 `insight.updated`

- **completed**：`buffer.commit(messageId, content)` → `dispatch({type:'event'})` → 移除 `StreamingBubble`、插入 `MessageBubble`。两者用**同一个 `key={message.id}`**，React 复用 DOM，视觉上零跳动；入场动画只在 `MessageBubble` 首次挂载时播放，commit 时不重播。
- **completed 早于最后几个 delta 到达**（乱序/丢包）：以 completed 的 `content` 为准，直接覆盖，后到的 delta 若 `messageId` 已 commit 则丢弃。
- **insight.updated**：全量替换，**不做增量合并、不做本地去重**（契约 §3.7 明确由后端负责）。前端只做两件事：
  1. 用 `id + updatedAt` 的 diff 找出新增/变更项，给 1.8s 的暖色高亮（`prefers-reduced-motion` 下改为静态左描边）；
  2. 若抽屉是关闭的，把变更数累加到顶栏徽标上。

### 6.7 结束与关闭

| 场景 | 动作 |
| --- | --- |
| 收到 `discussion.ended` | 应用事件 → `stream.dispose()` → `connection='closed'` → PlaybackBar 切换为"回看整场" |
| `stream.ready.status === 'ended'` | 不建立长连，直接 `close()` |
| 组件卸载 | `dispose()`，清退避定时器、清 rAF、`buffer.clear()` |
| `fatal` | 显示可读错误 + `[回到首页]`，不再自动重连 |

### 6.8 降级路径

| 场景 | 降级 |
| --- | --- |
| 浏览器不支持 `EventSource`（极罕见） | `connection='degraded'`：每 2s `GET detail`，用 `lastSeq` 判断是否有变化，有变化就 `hydrate`；顶栏提示"实时推送不可用，正在定时刷新" |
| 重连 6 次仍失败 | 同上切轮询，但保留手动 `[立即重连]` |
| HTTP/1.1 连接数耗尽 | 见 §12.6 风险 R-03：同一浏览器最多 3 个演播厅标签页，超限时在开页时检测并提示 |

### 6.9 已知的 EventSource 坑（写进代码注释）

1. `event:` 名未注册 → 静默丢弃。**必须预先注册全部 8 种事件名**，未知事件走 `addEventListener` 兜底并 `console.debug`。
2. `id:` 含空格或换行 → 解析异常。服务端只发纯数字。
3. 服务端返回 `204` → 浏览器**永久停止重连**，且不触发任何可识别事件。客户端不能依赖"连上就一定有 ready"。
4. 代理层缓冲：Vite dev proxy 默认不缓冲，但生产若加 `compression` 中间件会卡住流。前端无法解决，只能在 README 标注（转后端）。
5. EventSource 不能带自定义 header，也不能带 body。本地应用无鉴权，可接受；一旦未来加 token，必须换成 `fetch` 流实现（同一 `SessionStream` 接口，约 +80 行）。

---

## 7. 回放

### 7.1 时间线模型

```ts
interface ReplayFrame {
  seq: number;
  at: number;          // 相对 t0 的毫秒偏移
  type: EventType;
  event: PersistedEvent;
}
```

- 拉取：`GET /events?after=0&limit=1000`，`hasMore` 为真则继续翻页（用最后一条 `seq` 作下一次 `after`）。
- `t0` = 第一条事件（`roster.ready`）的 `createdAt`。**不用绝对时间做展示**，只用于排序和算间隔，规避时区与时钟漂移问题。
- 关键节点：`discussion.started`（0 点）、每条 `message.completed`（一个 tick）、`summary.completed`、`discussion.ended`。
- **`message.delta` 不落库**（契约 §11），回放天然只有完整消息。

### 7.2 播放引擎（用 `setTimeout`，不用 `rAF`）

事件之间通常隔 2–8 秒，用 rAF 空转 60fps 纯属浪费，且后台标签页会被节流。用可取消的 `setTimeout` 链，每次只调度"下一步"。

```text
delay = clamp(next.at - cur.at, MIN_STEP, MAX_STEP) / speed
MIN_STEP = 150ms      // 同秒内连续事件不许闪成一帧
MAX_STEP = 2000ms     // 长间隔压缩（契约 §6 已有，前端补下限）
pause 时保存剩余毫秒；resume 时按剩余时间调度
speed 变更时：按"已过时间 / 原 delay"比例重算剩余，避免变速瞬间跳帧
```

> 建议把 `MIN_STEP=150ms / MAX_STEP=2000ms` 写进 SSE 契约 §6，QA 才能断言。

### 7.3 跳转：播放 = 连续 seek

```ts
// 唯一的状态推导方式
const view = useMemo(
  () => frames.slice(0, cursor).reduce(sessionReducer, emptySession(id)),
  [frames, cursor]
);
```

- **每次前进、每次拖动，都从零重算**。40 个事件 × reduce 到 15 条消息 ≈ 几千次操作，< 1ms，完全不需要增量优化。
- 这样做换来的收益是**没有任何增量路径**，因此不存在"拖动后状态错乱"这类最难查的 bug。
- 拖动时 `state='seeking'`，松手（`onValueCommit`）才真正落 cursor，避免拖动过程中连续重算。

### 7.4 与直播共用 reducer 的三个前提

1. `roster.ready` 的 payload 必须**自带完整专家信息**（当前契约已满足），否则回放从 seq 0 起无法渲染左栏。
2. `discussion.started` 必须携带 `startedAt`（当前契约已满足），否则回放的计时从零开始，与直播不一致。
3. 直播首连用 `after=lastSeq` 会**跳过 `discussion.started`**，所以直播必须靠 `GET detail` 提供 `startedAt`。两条路径在 reducer 里写同一个字段，才等价（见 F-16）。

### 7.5 控制与可访问性

| 交互 | 行为 |
| --- | --- |
| 播放/暂停 | 按钮 + `Space` |
| 倍速 | `Segmented`（1x / 1.5x / 2x），记忆到 `localStorage`；切换不重置进度 |
| 时间线 | Radix `Slider`，刻度 = 每轮次；`aria-valuetext="第 3 轮，共 12 轮"` |
| 跳转 | 点刻度直接跳；`←/→` 前后一轮；`Home/End` 首尾 |
| ended | 播放到最后一帧 → `state='ended'`，按钮变"重播"，再次点击回到 cursor=0 |

### 7.6 "不能调用 LLM"的保证（可测）

- 回放页只允许 `GET /discussions/:id` 与 `GET /discussions/:id/events` 两个请求。
- 回放页**不构造 `SessionStream`**（不连 SSE）。
- 代码层面：`ReplayPage` 不 import 任何 `POST` 方法；`api.ts` 里把写操作集中在一个 `mutations` 命名空间，回放只 import `queries`。
- QA 可断言：回放全程 `page.on('request')` 中无 `POST`，且 `/stream` 请求数为 0。

---

## 8. 设计 token

### 8.1 颜色

**舞台色（背景与面板）**

| Token | 值 | 用途 |
| --- | --- | --- |
| `--stage-1000` | `#05070A` | 页面底色（近黑，略微偏蓝，避免死黑） |
| `--stage-900` | `#0B0F15` | 主面板底 |
| `--stage-850` | `#11161F` | 抬升面板（抽屉、Popover） |
| `--stage-800` | `#171E29` | hover / 选中 |
| `--line-1` | `rgba(255,255,255,.07)` | 分隔线、面板描边 |
| `--line-2` | `rgba(255,255,255,.14)` | 强调描边、焦点前状态 |
| `--text-1` | `#EDF1F7` | 标题、发言正文 |
| `--text-2` | `#B7C0CD` | 次要正文 |
| `--text-3` | `#7E8896` | 元信息（时间、Title） |
| `--text-4` | `#58616E` | 占位、禁用 |

**语义色（状态与洞察）**

| Token | 值 | 用途 | 用法约束 |
| --- | --- | --- | --- |
| `--live` | `#F0B429` | 直播中、收尾中 | 只用于呼吸点、状态 pill 描边、计时数字 |
| `--consensus` | `#34D399` | 共识 | chip 背景 12%、1px 边、图标、标题文字 |
| `--divergence` | `#E8735F` | 分歧 | 同上 |
| `--openq` | `#A78BFA` | 待验证问题 | 同上 |
| `--danger` | `#FF5C5C` | 失败、错误 | 仅 banner/toast/pill；**必带图标 + 文案**，且不与 `--divergence` 同屏相邻 |
| `--focus` | `#F0B429` | 键盘焦点环 | `outline: 2px solid; outline-offset: 2px` |

> `--danger` 与 `--divergence` 色相接近。规则：**danger 只出现在页面级的横条与状态位，divergence 只出现在洞察卡片里**，两者在布局上永不相邻。

**专家色（由后端下发，前端不重映射）**

- 合法校验：`/^#[0-9a-f]{6}$/i`，不合法回退 `#8FA3BF`。
- 可读前景：对 `color` 算相对亮度，`>0.55` 时头像内文字用 `--stage-1000`，否则用 `#FFF`。
- 使用通道（只在这四处，绝不用于大面积填充）：席位头像环、姓名文字、发言条左侧 4px 竖条、聚光灯 12% 底色。
- **专家色与语义色分属不同视觉通道**（边缘/文字 vs 填充/标签），再叠加"每种洞察都有图标 + 类型文字"，保证颜色不是唯一信息载体（NFR-11）。
- 建议（给 AI/Agent）：生成阵容时避开 `#34D399 / #E8735F / #A78BFA / #F0B429` 附近色相（±25°）且饱和度 >0.5 的颜色，见 F-18。

### 8.2 字体

**只使用本机已安装字体，不加载任何网络字体**（本地应用、离线首屏 <1.5s）。字体栈里靠前的 `Inter Tight` / `Inter` 若本机没有，会自然回落到系统字体，不产生任何下载。

```css
--font-sans: "Inter Tight", "Inter", -apple-system, "Segoe UI Variable",
             "Segoe UI", "PingFang SC", "Microsoft YaHei UI",
             "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
--font-mono: "SFMono-Regular", "Cascadia Mono", Consolas, monospace;
```

| Token | 字号 / 行高 | 字重 | 字距 | 用途 |
| --- | --- | --- | --- | --- |
| `--fs-display` | 30 / 38 | 600 | `-0.01em` | 首页 H1、议题标题（≥1440） |
| `--fs-h1` | 22 / 30 | 600 | `0` | 页面标题、总结卡标题 |
| `--fs-h2` | 16 / 24 | 600 | `0.01em` | 面板标题 |
| `--fs-body` | 15 / 25 | 400 | `0` | 发言正文（中文 15px/1.67 是舒适区） |
| `--fs-ui` | 13 / 20 | 500 | `0.01em` | 按钮、标签 |
| `--fs-meta` | 12 / 18 | 400 | `0.02em` | 姓名、Title、时间 |
| `--fs-micro` | 11 / 16 | 600 | `0.08em` | 栏目标签（共识/分歧/待验证） |

规则：数字与计时用 `font-variant-numeric: tabular-nums`（否则计时器会抖动）；议题标题 `text-wrap: balance` + 最多 2 行 `line-clamp`；**中文正文不做 letter-spacing 负值**。

### 8.3 间距、圆角、层级

| Token | 值 | Token | 值 |
| --- | --- | --- | --- |
| `--s-1` | 4px | `--r-sm` | 6px |
| `--s-2` | 8px | `--r-md` | 10px |
| `--s-3` | 12px | `--r-lg` | 14px |
| `--s-4` | 16px | `--r-xl` | 20px |
| `--s-5` | 20px | `--r-pill` | 999px |
| `--s-6` | 24px | | |
| `--s-8` | 32px | | |
| `--s-10` | 40px | | |
| `--s-14` | 56px | | |

- 圆角上限 20px。**同一屏内圆角种类 ≤ 2 种**（这是避免"SaaS 卡片墙"的关键）。
- 层级（z-index）：`--z-panel:0`、`--z-sticky:10`、`--z-drawer:40`、`--z-popover:50`、`--z-toast:60`、`--z-spotlight:20`。
- 阴影只用两种：`--shadow-panel: 0 1px 0 rgba(255,255,255,.04) inset, 0 8px 24px rgba(0,0,0,.35)`、`--glow-spot: 0 0 0 1px color-mix(in oklab, var(--speaker) 45%, transparent), 0 0 32px color-mix(in oklab, var(--speaker) 22%, transparent)`。

### 8.4 动效

| Token | 值 | 用途 |
| --- | --- | --- |
| `--dur-1` | 90ms | hover、按下、焦点 |
| `--dur-2` | 160ms | chip 入场、状态 pill 切换 |
| `--dur-3` | 260ms | 消息入场、抽屉推入 |
| `--dur-4` | 520ms | 聚光灯转移、面板高亮 |
| `--dur-5` | 900ms | 开播"灯亮"转场 |
| `--pulse-live` | 1.8s | LIVE 呼吸点 |
| `--pulse-prep` | 2.2s | preparing 呼吸圈 |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | 入场、展开 |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` | 颜色、透明度 |
| `--ease-stage` | `cubic-bezier(.16,.84,.24,1)` | 聚光灯、灯亮 |

**只允许动 4 个属性**：`opacity`、`transform`、`filter`、`color`（含 `background-color`/`border-color`）。禁止动 `width/height/top/left`。

**reduced motion 降级（一整块，不是逐个组件写）**：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

外加 JS 侧 `useReducedMotion()` 控制三件事：delta 逐字关闭、聚光灯改为立即切换、自动滚动用 `behavior:'auto'`。

### 8.5 "演播厅感"从哪来（每条都要落到具体实现）

| # | 装置 | 具体做法 | 反例（会毁掉它） |
| --- | --- | --- | --- |
| 1 | **顶光** | 页面顶部一个 `radial-gradient(ellipse at 50% -10%, rgba(240,180,41,.10), transparent 60%)`，叠加底部 12% 暗角。整个 app 只有这一处大面积渐变 | 纯 `#000` 或纯 `#111` 平铺，像后台 |
| 2 | **席位，不是列表** | 专家是固定顺序的"座次"：主持人常驻顶端并放大 1.15 倍，专家 01–05 竖排，编号可见。不可拖拽、不可排序 | 可排序的卡片网格、表格行 |
| 3 | **聚光灯跟随** | 单一 `absolute` 光斑层，`transform: translate()` 到当前席位/气泡，520ms `--ease-stage`；同时该气泡获得 4px 专家色左竖条 + `--glow-spot`。其余面板压到 3% 亮度 | 用 `box-shadow` 逐条动画，或全屏高亮 |
| 4 | **发言是字幕条，不是气泡** | 左对齐、无尾巴、无左右分栏；`[4px 色条][姓名 · Title · 时间][正文]`；轮次之间用一条 1px 线 + `第 4 轮 · 反驳` 的 micro 标签分隔 | 微信式绿白气泡、头像在左侧的大卡片 |
| 5 | **直播信号** | 顶栏 `●LIVE` 呼吸点（1.8s）+ 真实走时 `04:38`（`now - startedAt`）+ 轮次。**不做假进度条**，没有分母就显示不确定态 | 假百分比进度条、"AI 思考中"转圈 |
| 6 | **"有人在说话"的可视化替身** | speaking 时，姓名右侧三根 3px 音柱做 0.9s 交错缩放；preparing 时三根静止 + 呼吸圈。这是没有音频时最强的"正在说话"信号 | 打字机光标、`...` 省略号 |
| 7 | **开播转场** | `confirm` 成功后：亮度 0→1（900ms）+ 主持人席位光晕从中心扩散 + 顶栏 status 由"待确认"翻为 LIVE。**不跳页、不闪白** | 路由跳转 + 骨架屏 |
| 8 | **谢幕** | `ended`：顶光由暖金转冷（`--live` → `--text-3`），聚光收敛，总结卡以"字幕卡"从底部升起 24px + 淡入；底部条整体替换为 `[回看整场]` | 弹 Toast"讨论已结束" |
| 9 | **克制** | 全局只有 1 种强调动效（聚光）+ 1 种循环动效（呼吸/音柱）；面板底色 3% 白 + 1px 线；无阴影堆叠、无渐变按钮 | 每个卡片都有 hover 抬升 + 阴影 |
| 10 | **密度** | 行高 25px、面板内边距 16px、席位卡高度 64px。信息密度接近"转播控制台"，不是"营销落地页" | 大留白 + 24px 圆角 + 彩色图标 |

**通用后台风的反面清单（Code Review 时逐条检查）**：

- ❌ 白色/浅灰背景、蓝色主按钮
- ❌ 顶部一排 KPI 卡片（"讨论数 / 消息数 / 专家数"）
- ❌ 表格 + 分页器
- ❌ 5 种以上圆角值 / 3 种以上阴影
- ❌ Emoji 当图标
- ❌ 卡片 `hover: translateY(-2px) + shadow-lg`
- ❌ 全屏居中 loading 转圈

### 8.6 可访问性（NFR-11）

- 焦点环：`2px solid var(--focus)` + `outline-offset: 2px`，**任何交互元素不得 `outline: none`**。
- 对比度：正文 `--text-1` 于 `--stage-900` ≈ 17:1；`--text-3` ≈ 5.4:1；四种语义色（`#34D399` 10.0:1、`#E8735F` 6.5:1、`#A78BFA` 7.1:1、`#F0B429` 10.4:1）均 ≥ 4.5:1（作为文字使用）。
- 语义：`<main>`、`<section aria-label="现场实录">`、`<button>`；`StatusPill` 用 `role="status"` + `aria-live="polite"`。
- Transcript 用 `aria-live="polite"`，但**只在 `message.completed` 时更新可访问文本**，delta 阶段用 `aria-hidden` 的视觉层，避免屏幕阅读器逐字念。
- 不得仅靠颜色传达：席位有编号 + 姓名；洞察有图标 + 类型文字；专家状态有文字（待机/准备发言/发言中）。
- 键盘全通：Tab 顺序 = 顶栏 → 左栏席位 → Transcript → 洞察 → 底栏；回放支持 `Space / ← / → / Home / End`；抽屉 `Esc` 关闭并归还焦点。

---

## 9. 低保真线框

图例：`↕` = 该区域独立滚动（`overflow-y:auto`）；`▓` = 固定不滚动；`[ ]` = 可交互；`◉ ● ◍ ○` = 专家色圆点；边框右侧的 `72` / `56` 等数字是固定高度（px）。中文字符宽度不等，线框列宽为近似值，**真实约束以 §3 的 grid 定义为准**。

### 9.1 ≥1440：三栏 + 顶栏 + 底栏

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ●LIVE  AI 会不会让初级开发者失业？   第 6 / 约 10 轮 · 04:38   [结束讨论]│ 顶栏 72  ▓
├──────────────────┬─────────────────────────────────┬─────────────────────┤
│ 席位          ↕  │ 现场实录                     ↕  │ 共识·分歧·待验证 ↕  │
│ ┌──────────────┐ │ ┌─────────────────────────────┐ │ ┌─────────────────┐ │
│ │◉ 林致远      │ │ │▌林致远 资深圆桌主持   00:03 │ │ │▲ 共识      2    │ │
│ │  主持人      │ │ │ 今天我们不急着下结论……      │ │ │ ▌AI 会重构岗位… │ │
│ │  正在串联…   │ │ └─────────────────────────────┘ │ │   依据 2 条      │ │
│ └──────────────┘ │ ┌─────────────────────────────┐ │ ├─────────────────┤ │
│ ┌──────────────┐ │ │▌周明 技术负责人      00:11  │ │ │◆ 分歧      2    │ │
│ │① 周明  ●发言中│ │ │ AI 会重构初级岗位，而非消灭 │ │ │ ▌升级还是压缩…  │ │
│ │  工程与岗位   │ │ │                      依据 2 │ │ │   依据 2 条      │ │
│ └──────────────┘ │ └─────────────────────────────┘ │ ├─────────────────┤ │
│ ┌──────────────┐ │ ┌─────────────────────────────┐ │ │◇ 待验证    1    │ │
│ │② 许澜  ◍准备中│ │ │▌许澜 组织心理学研究者 ···   │ │ │ ▌企业愿意买单吗 │ │
│ │  组织心理学   │ │ │ ▍▍▍ 正在组织发言…          │ │ │   依据 1 条      │ │
│ └──────────────┘ │ └─────────────────────────────┘ │ └─────────────────┘ │
│ ┌──────────────┐ │                                 │                     │
│ │③ 陈默   ○待机 │ │      ⌄ 3 条新发言 [跳到最新]    │  （洞察栏可折叠）   │
│ └──────────────┘ │                                 │                     │
├──────────────────┴─────────────────────────────────┴─────────────────────┤
│ 直播中 · 6 轮 · 5 条洞察   [⏸ 暂停自动滚动]  [⤓ 跳到最新]  [回看整场]  │ 底栏 56  ▓
└──────────────────────────────────────────────────────────────────────────┘
   300–360px             minmax(0,1fr) 最大 860 居中        320–400px
```

滚动归属：左栏 ↕、中栏 ↕、右栏 ↕，**顶栏与底栏永不参与滚动**。

### 9.2 1024–1439：两栏 + 右侧抽屉（默认收起）

```text
┌──────────────────────────────────────────────────────────────────────┐
│ ●LIVE 议题…  第 6 / 约 10 轮 · 04:38        [共识 3]  [结束讨论]     │ 72 ▓
├────────────┬─────────────────────────────────────────────────────────┤
│ 席位    ↕  │ 现场实录                                             ↕  │
│ ┌────────┐ │ ┌─────────────────────────────────────────────────────┐ │
│ │◉ 林致远│ │ │▌林致远 资深圆桌主持  00:03                          │ │
│ └────────┘ │ │ 今天我们不急着下结论……                              │ │
│ ┌────────┐ │ └─────────────────────────────────────────────────────┘ │
│ │①周明 ● │ │ ┌─────────────────────────────────────────────────────┐ │
│ └────────┘ │ │▌周明 技术负责人  00:11                              │ │
│ ┌────────┐ │ │ AI 会重构初级岗位，而非简单消灭                     │ │
│ │②许澜 ◍ │ │ └─────────────────────────────────────────────────────┘ │
│ └────────┘ │                                                         │
│ ┌────────┐ │                        [跳到最新]                       │
│ │③陈默 ○ │ │                                                         │
│ └────────┘ │                                                         │
├────────────┴─────────────────────────────────────────────────────────┤
│ 直播中 · 6 轮 · 5 条洞察        [暂停自动滚动]       [⤓ 跳到最新]     │ 56 ▓
└──────────────────────────────────────────────────────────────────────┘
   264px                        minmax(0,1fr)

抽屉（覆盖层，不挤压 transcript，宽度 400px，Radix Dialog + 遮罩）：
                                     ┌───────────────────────┐
                                     │ 共识·分歧·待验证   [×]│
                                     │ ↕                     │
                                     │ ▲ 共识 2 …            │
                                     └───────────────────────┘
```

### 9.3 768–1023：两栏（窄专家列）+ 抽屉

```text
┌────────────────────────────────────────────────────────────────┐
│ ●LIVE 议题…（最多 2 行）                     [共识 3] [⋯]      │ 72 ▓
├──────┬─────────────────────────────────────────────────────────┤
│ 席位 │ 现场实录                                             ↕  │
│  92  │ ┌─────────────────────────────────────────────────────┐ │
│   ↕  │ │▌林致远 资深圆桌主持  00:03                          │ │
│      │ │ 今天我们不急着下结论……                              │ │
│ ◉林  │ └─────────────────────────────────────────────────────┘ │
│ ●周  │ ┌─────────────────────────────────────────────────────┐ │
│ ◍许  │ │▌周明 技术负责人  00:11                              │ │
│ ○陈  │ │ AI 会重构初级岗位，而非简单消灭                     │ │
│      │ └─────────────────────────────────────────────────────┘ │
│ 点击 │                                                         │
│ 头像 │                     [跳到最新]                           │
│ →弹窗│                                                         │
├──────┴─────────────────────────────────────────────────────────┤
│ 直播中 · 6 轮 · 5 条洞察      [⤓ 跳到最新]                    │ 56 ▓
└────────────────────────────────────────────────────────────────┘
```

点专家头像 → Radix `Popover`（宽 280px）显示完整 ExpertCard：姓名 / 职业 / Title / 立场 / 当前关注点 / 状态。

### 9.4 <768：单栏 + 底部 Tab

```text
┌───────────────────────────────┐
│ ●LIVE 议题…（1 行省略）  [⋯]  │ 56  ▓
├───────────────────────────────┤
│ 第 6 轮 · 04:38   ⤓ 跳到最新  │ sticky 直播条 36 ▓
├───────────────────────────────┤
│                               │
│       当前 Tab 内容        ↕  │   minmax(0,1fr)
│                               │   每个 Tab 各自滚动
│                               │
├───────────────────────────────┤
│   讨论    │   专家    │  共识 │ 56 + safe-area  ▓
└───────────────────────────────┘
```

- Tab「讨论」= 顶栏 + sticky 直播条 + Transcript。
- Tab「专家」= 主持人 + 专家卡片全宽列表（含状态与关注点）。
- Tab「共识」= 三段式洞察面板。
- 切 Tab **不销毁**其他 Tab 的状态（用 CSS `hidden` + `display:none` 保留 DOM，滚动位置不丢），但只让当前 Tab 参与布局与滚动。
- 「跳到最新」在 Tab 切换时若未吸附，仍保留提醒数。

### 9.5 阵容确认（`/d/:id` 的 Lobby 视图）

```text
┌────────────────────────────────────────────────────────────────────┐
│ ← 返回首页        议题：AI 会不会让初级开发者失业？     待确认     │ ▓
├────────────────────────────────────────────────────────────────────┤
│                          主持人                                     │
│              ┌──────────────────────────────────┐                   │
│              │ ◉ 林致远 · 资深圆桌主持           │                  │
│              │ 中立，负责追问与串联              │                  │
│              └──────────────────────────────────┘                   │
│                                                                    │
│  专家席位 4                                                        │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐          │
│  │① 周明      │ │② 许澜      │ │③ 陈默      │ │④ 赵一      │          │
│  │软件工程师  │ │组织心理学  │ │劳动经济学  │ │早期投资人  │          │
│  │技术负责人  │ │研究者      │ │副教授      │ │合伙人      │          │
│  │AI 重构岗位 │ │AI 压缩岗位 │ │取决于再培训│ │资本会加速… │          │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘          │
│                                                                    │
│              [重新生成]              [确认阵容，开播 →]            │
└────────────────────────────────────────────────────────────────────┘
   ≥1280：4 列    768–1279：2 列    <768：单列（横向卡片，立场 2 行省略）

生成中：N 个空席位骨架（ shimmer ）+ "正在召集嘉宾 · 已等待 3.4s" + [取消]（15s 后出现）
```

---

## 10. 关键交互

### 10.1 发言者聚光

- 触发：`turn.started` → 该席位 `preparing`；首个 delta → `speaking`。
- 表现：席位卡边框变为专家色（`1px`）+ 外发光；Transcript 中对应气泡左竖条由 2px 变 4px 并加 `--glow-spot`；其余席位降到 3% 亮度（`opacity: .65`）。
- 转移：单一光斑层 `transform: translate(x,y)`，520ms `--ease-stage`，**不是两个元素各自淡入淡出**（会闪）。
- 结束：`message.completed` 后保留 1.2s 再收回，避免"话没说完灯就灭"。

### 10.2 自动滚动 / 跳到最新 / 上滚暂停

```text
pinned = (scrollHeight - scrollTop - clientHeight) < 80px   // 阈值
```

| 事件 | 行为 |
| --- | --- |
| 新消息到达且 `pinned` | `scrollTop = scrollHeight`，`behavior: 'auto'`（**不用 smooth**，每条都平滑会持续抖动） |
| 用户上滚超过 80px | `pinned=false` → `autoScrollPaused=true` → 底部浮出 `[⌄ 3 条新发言 · 跳到最新]` |
| 用户点"跳到最新" | 平滑滚到底（reduced motion 时瞬时），`pinned=true`，计数清零 |
| 用户手动滚回底部 | 自动恢复吸附，提示条消失 |
| 用户点底栏"暂停自动滚动" | 强制 `autoScrollPaused=true`，即使 `pinned` 也不追；再点恢复并跳底 |
| 窗口 resize / 抽屉开合 | 若 `pinned`，重算一次贴底；若未吸附，保持相对位置 |

监听用 `scroll` + rAF 节流，不用 `IntersectionObserver`（因为需要精确的像素阈值与"用户意图"判断）。`overflow-anchor: none` 必须加，否则 Chrome 的滚动锚定会和我们的贴底打架。

### 10.3 状态脉冲

| 元素 | 动效 | reduced motion |
| --- | --- | --- |
| `●LIVE` | 1.8s `scale(1)→(1.35)→(1)` + 透明度，`box-shadow` 呼吸 | 静态实心点，仅靠颜色与文字 |
| preparing 席位 | 2.2s 外圈 `scale(1)→(1.06)` + 边框透明度呼吸 | 静态 1px 描边 + 文字"准备发言" |
| speaking 音柱 | 3 根 3px 竖条，0.9s 交错 `scaleY(.35→1)` | 静止等高竖条 |
| 新洞察 | 1.8s 暖色底渐隐 | 静态左描边 2px，保持到下次更新 |

### 10.4 空态与错误态（逐场景）

| 场景 | 文案 | 动作 |
| --- | --- | --- |
| 首页无讨论 | "还没开场。输入一个议题，召集你的第一组专家。" + 3 个示例议题芯片 | `[发起新讨论]` |
| 直播刚开、无消息 | "主持人即将开场…" + 呼吸点 | 无 |
| 无共识 | "讨论刚开始，还没有形成共识"（**不显示"暂无数据"**） | 无 |
| 无分歧 | "目前没有明显对立" | 无 |
| 无待验证 | "还没有未决问题" | 无 |
| 生成失败 | "阵容生成失败。模型这次没有给出可用结果。"（**不带 code/堆栈**） | `[重新生成]` `[返回首页]` |
| 生成超时 | "生成超时了。可以再试一次。" | `[重试]` `[返回首页]` |
| SSE 断线 | 顶栏下 32px 提示条："连接中断，正在重连（第 2 次，4s）" | `[立即重连]`；内容保持不动 |
| 重连成功 | 提示条变绿"已恢复"，1.5s 后消失 | 无 |
| 运行期失败 | 全屏可读："这场讨论中断了。已产生的发言仍可回看。" | `[回看已有内容]` `[返回首页]` |
| 总结失败 | 总结卡替换为："主持人总结没有生成成功。" | `[重试总结]`（P1）`[回看整场]` |
| 404 | "这场讨论不存在或已被删除。" | 3s 后自动 `/` |
| 回放无内容 | "这场讨论没有可回放的内容。" | `[返回首页]` |

**统一红线**：任何错误界面不出现 HTTP code、错误堆栈、JSON、`sk-` 片段。`AppError.message` 由 `api.ts` 做一次映射，UI 只消费映射后的中文文案。

### 10.5 其他交互

- **洞察依据定位**：点"依据 2 条"→ Transcript 滚动到第一条并短暂高亮 2s；若该消息不在当前 DOM（不可能，P0 不虚拟化），降级为 toast。
- **结束讨论**：二次确认（Radix AlertDialog），文案"结束后不能再继续发言，但可以回看整场。"→ 202 后立即置 `summarizing`，按钮变"收尾中…"禁用。
- **重新生成阵容**：二次确认并提示"会替换当前所有专家"；返回后整栏做一次交叉淡入（260ms），不做整页刷新。
- **键盘**：无全局快捷键；仅在回放页有 `Space/←/→/Home/End`。避免与浏览器快捷键冲突。

---

## 11. FR 落点表（FR-01 ~ FR-17）

| FR | 页面 | 主要组件 | 前端状态落点 | 前端可验证点 |
| --- | --- | --- | --- | --- |
| FR-01 首页列表 | `/` | `DiscussionGrid` / `DiscussionCard` | loading / empty / ready / error | 卡片含议题/状态/专家数/进度/更新时间/结论摘要 6 要素；进行中→直播、已结束→回放、待确认→Lobby |
| FR-02 创建 | `/new` | `CreateForm` | idle / validating / submitting / failed | 2–200 字实时计数；提交中禁用按钮；重复提交被拦截 |
| FR-03 生成阵容 | `/new`→`/d/:id` | `RosterGenerating` / `RosterLobby` | generating / ready | 1+N 张卡齐全；颜色/姓名重复仅记录不阻断（后端负责） |
| FR-04 确认阵容 | `/d/:id` Lobby | `ConfirmBar` | ready / confirming / failed | 确认中禁用；重复确认不产生第二个 SSE 连接 |
| FR-05 演播厅布局 | `/d/:id` | `StudioShell` | 三档断点 | `body` 无滚动；三个面板各自可滚；顶/底栏固定 |
| FR-06 自主发言 | `/d/:id` | `Transcript` / `TurnDivider` | 轮次序列 | 按 `turnIndex` 顺序展示；不出现"举手"等内部事件 |
| FR-07 专家状态 | `/d/:id` | `ExpertCard` / `SpeakingBars` | idle / preparing / speaking | 三态可见且有文字；关注点随 `turn.started.focus` 更新；不出现 CoT |
| FR-08 现场 Transcript | `/d/:id` | `Transcript` / `JumpToLatest` | pinned / unpinned | 自动滚动；上滚后暂停并出现"跳到最新"与未读数 |
| FR-09 实时共识/分歧 | `/d/:id` | `InsightPanel` | empty / updating / populated | 全量替换；分三组；每条显示依据数；重复项不堆叠 |
| FR-10 主持人总结 | `/d/:id` + `/` | `SummaryCard` | summarizing / ready / unavailable | 纯文本渲染（不解析 markdown 里的 JSON）；首页摘要 ≤80 字 |
| FR-11 回放 | `/d/:id/replay` | `PlaybackBar` / `Timeline` | paused / playing / seeking / ended | 1x/1.5x/2x；跳转；刷新后仍可播；全程无 POST、无 SSE |
| FR-12 多讨论并行 | `/` + 多标签 | `SessionProvider`（按路由） / `useRegistryStore` | — | 无全局会话状态；两个标签页各自连接、互不串线 |
| FR-13 结束/离开 | `/d/:id` | `EndDiscussionButton` | live → summarizing → ended | 离开不调用 `/end`；结束后输入/操作禁用；`/end` 幂等 |
| FR-14 样例数据 | `/` | `DiscussionCard` | ready | 5 条可见，至少 1 条已结束可直接回放 |
| FR-15 异常与空态 | 全部 | `ErrorState` / `Toast` / `StatusPill` | error / reconnecting | 无堆栈/JSON；断线 3s 内自动重连；所有空态有专属文案 |
| FR-16 Key 安全 | 构建产物 | `api.ts` | — | 前端不发任何携带 key 的请求；`dist` 无 `sk-` |
| FR-17 一键运行 | — | `vite.config.ts` proxy | — | `pnpm dev` 起 5173，`/api` 代理到 3001；生产由后端托管 `dist` |

---

## 12. 对 API / SSE 契约的评审

> 编号规则：`F-xx` 为可执行变更项，`P0` = 阻塞 UI 或必致线上 bug，`P1` = 体验/可测性缺陷，`P2` = 可选优化。
> 每条包含：现状 → 对前端的影响 → 建议（可直接抄进契约） → 若不改的前端临时兜底。

### 12.1 哪些字段/事件是多余的

| ID | 项 | 结论 | 建议 |
| --- | --- | --- | --- |
| F-09 | `GET /discussions/:id` 同时有顶层 `lastSeq` 和 `discussion.lastSeq`（示例里都是 12） | **真重复** | 删除顶层 `lastSeq`，只保留 `discussion.lastSeq` |
| F-10 | `message.completed` 提到 `charCount`（SSE §3.6），但 payload 里没有，前端也不用 | **多余** | 从文档删除该说明；前端不做字数校验 |
| F-14 | ER §5 有 `discussion.created` 事件，SSE 总表没有 | **两文档不一致** | 明确：`discussion.created` 是否落库；若落库，前端 reducer 需处理（当前按"忽略未知事件"兜底） |
| F-15 | ER 的 `insight.status`（`active/resolved`）未出现在 SSE payload | **不一致** | MVP 明确不做"已解决"，从 ER 删除该字段，避免后续误加 |
| F-19 | 列表用 `offset` 分页 | 可接受但会抖动 | 首页轮询时可接受；若加 `cursor=updatedAt` 更好（P2） |
| F-17 | `stream.ready` 无 `retryMs` | 非必需 | 可选，服务端下发 `retry: 1000` 字段更省事（P2） |

### 12.2 哪些是缺失的，导致 UI 无法实现

#### F-01【P0】`GET /discussions` 的 `status` 无法支撑首页三分组

- **现状**：`status ∈ {all, live, ended, failed}`，单值。
- **影响**：首页要同时展示"进行中 + 待确认（`ready`）+ 最近结束"，而 `ready`/`generating` 根本不可筛选。FR-01 + FR-04「返回首页后草稿仍可继续」无法实现。
- **建议**：`status` 改为多值 `live,ready,generating,ended,failed` 或别名 `active`（= live + ready + generating）。默认 `all`，服务端保证排序：`live` > `ready` > `generating` > `ended`（按 `updatedAt` 倒序）。
- **兜底**：前端请求 `status=all&limit=100` 后本地分组；分页会失效，且 `failed` 的 `topic` 可能为空（见 F-02）。

#### F-02【P0】创建失败/超时后，前端拿不到 `discussionId`，必然产生重复会话

- **现状**：`POST /api/discussions` 同步生成阵容（最长 10–12s）。失败时按统一错误格式返回 `{error:{code,message,details}}`，只有 `details.discussionId`，**没有 `topic` 等可展示信息**。PRD FR-02 要求"失败可重试"，API 也说"失败时仍保留 discussion（failed）"。
- **影响**：
  1. 网络超时（浏览器默认可能 30–60s，Vite 代理无超时但用户会手动刷新）后，服务端可能已成功建库，用户重试 → **两场重复讨论**，首页出现两条几乎一样的议题。
  2. 失败后前端无法渲染"上次失败的那一场"卡片（没有 topic），只能回到空白表单。
- **建议**（30 分钟可落地的组合拳）：
  1. `POST /api/discussions` 请求体增加 **`clientRequestId: string`（UUID v4，必填）**，服务端 24h 内按 `(clientRequestId)` 幂等：重复请求返回同一条 discussion（200 而非 201）。
  2. 502/504 的错误体 `details` 至少带 `{ discussionId, topic, status }`，让前端能在失败页展示并"重新生成"。
  3. 若担心改动大，至少做到 (1)。
- **兜底（不改契约时）**：前端在 `sessionStorage` 记录 `{topic, expertCount, submittedAt}`，超时后引导用户回首页，首页列表按 `topic` 模糊匹配最新一条。**丑陋但可用**。

#### F-03【P0】`turn.started` 没有对应的终止事件，`preparing` 可能永久脉冲

- **现状**：只有 `turn.started` 和 `message.completed`。AR-09 允许"跳过该轮"或"使用兜底文案"，但契约没有"这一轮被跳过/失败"的事件。
- **影响**：左栏某位专家会永远显示"准备发言"的呼吸圈，主角光环永不收回，看起来像卡死。
- **建议**：新增持久化事件 `turn.aborted { turnIndex, speakerId, reason: 'timeout'|'invalid_output'|'empty'|'interrupted', retryable: boolean }`。硬约束写成：**每个 `turn.started` 后必须跟 `message.completed` 或 `turn.aborted`**。
- **兜底**：客户端 20s 超时强制回落 `idle` + Transcript 尾部插一条系统提示"这一轮没有完成"。

#### F-04【P0】缺 `discussion.summarizing` 事件，收尾期间是"无解释的空白"

- **现状**：`live → summarizing` 只在 `POST /end` 的 202 响应里体现。如果是**自然收束**（8–12 轮后 AI 决定结束），前端收不到任何信号，只能等 `summary.completed`（可能 5–20s）。
- **影响**：最后一条发言后，页面静默 10 秒以上，顶栏还写着 LIVE——这是整场体验里最容易让人"以为卡了"的 10 秒。
- **建议**：新增持久化事件 `discussion.summarizing { reason: 'user'|'auto', startedAt }`，必须在 `summary.completed` 之前、最后一条 `message.completed` 之后。
- **兜底**：`POST /end` 202 后本地立即置 `summarizing`；自然收束无法预知，只能靠"末轮之后 8s 无事件"启发式提示（不可靠，不推荐）。

#### F-05【P0】缺 `discussion.failed` 事件，runner 崩溃时 UI 永远显示 LIVE

- **现状**：`error { recoverable: false }` 是**非持久化**事件（"如需审计可落库"），且语义是"本轮 LLM 出错"。整体失败（进程重启、连续失败、abort）没有对应事件。
- **影响**：SSE 断开 + 服务端状态变 `failed`，但前端从事件流里看不出"结束"还是"暂时断线"，只能无限重连。ER §6 又说"进程重启把 live/summarizing 标记为 failed"——**这个状态迁移没有任何事件通知前端**。
- **建议**：新增持久化 `discussion.failed { code, message, retryable, at }`，作为与 `discussion.ended` 并列的终态事件；收到后客户端 `close()`。
- **兜底**：每次重连成功后用 `stream.ready.status` 与本地比对；若服务端已是 `failed`/`ended` 而本地还在 `live`，触发一次 `GET detail` 并强制对齐。

#### F-06【P0】`insight.updated` 全量快照里所有条目共用同一个 `updatedAt`

- **现状**：SSE 示例中三条洞察的 `updatedAt` 全是 `"2026-11-01T10:01:05.000Z"`。
- **影响**：前端唯一能判断"哪条是新增/变更"的依据就是 `updatedAt`。时间戳全部刷新 → 每次收到快照，所有条目都会被判定为"刚变更"，触发整栏 1.8s 高亮闪烁。这会让右栏每 3 秒闪一次，非常廉价。
- **建议**：`updatedAt` 的语义明确为"**该条内容最后一次变化的时间**"；未变化的条目**保留原时间戳**。或者额外下发 `revision: number`（会话内单调递增，每条独立）。
- **兜底**：前端额外对 `content` 做 hash 比对（`id + content`），只在内容真变时高亮。可用但多一层。

#### F-07【P0】首页状态不会自动更新，FR-12 落空

- **现状**：SSE 是**按 discussion** 的。停在首页时，别的讨论在推进/结束，首页卡片仍显示旧状态。契约没有定义列表刷新机制。
- **影响**：PRD FR-12 明确要求"首页状态独立更新"；演示时"两场并行、A 结束了首页还显示 LIVE"会直接暴露。
- **建议**：契约中明确一条前端约定：**首页在 `visibilityState === 'visible'` 时每 5s 轮询 `GET /api/discussions`**（服务端加 `Cache-Control: no-store`）。不建议在 72h 内做全局 SSE 汇总流。
- **兜底**：前端自己加轮询（30 行），但需要服务端保证响应够快（5 条数据，无压力）。

#### F-08【P1】`expert.focus` 语义双关，FR-07 无法正确展示"当前关注点"

- **现状**：`roster.ready` / `GET detail` 的 `experts[].focus` 是初始关注领域（如"工程实践与岗位结构"）；`turn.started.focus` 是本轮关注点（如"反驳'替代论'忽略岗位重构"）。**两个字段同名、语义不同、生命周期不同**。
- **影响**：非发言时刻，左栏该显示哪一个？"当前关注点"若一直显示上一轮的临时 focus，会显得过时；若只显示静态 focus，又体现不出"实时"。
- **建议**：改名区分——`experts[].focusArea`（静态领域）与 `turn.started.turnFocus`（本轮，`message.completed` 后 3s 失效回落到 `focusArea`）。
- **兜底**：前端把 roster 的 `focus` 当 `focusArea`，`turn.started.focus` 当临时值 + 3s TTL。不改契约也能做，但新人一定会理解错。

#### F-11【P1】`message.delta` 缺 `turnIndex`

- **现状**：delta 只有 `messageId / speakerId / delta`。
- **影响**：正常情况没问题（先有 `turn.started`）。但断线重连后若第一条事件是 delta，前端无法知道它属于第几轮，也就无法插到正确位置（只能等 completed）。
- **建议**：delta 增加 `turnIndex`（可选，向后兼容）。
- **兜底**：从 roster 反查 speaker 展示信息；`turnIndex` 缺失时该 delta 只进 buffer，不建气泡（等 completed）。

#### F-21【P1】没有定义"总结失败"的路径

- **现状**：约束写的是 `discussion.ended` 必须在 `summary.completed` 之后。如果总结 LLM 失败，`discussion.ended` 还发不发？
- **影响**：若不发 → UI 永远停在 `summarizing`，讨论无法回放（回放页可能因未 `ended` 被拒）；若发 → `summary` 为 null，UI 需要专门的"总结不可用"状态。
- **建议**：明确"**总结失败也要发 `discussion.ended`**，`summary` 为 null"，并在 UI 文案约定上写"总结未生成"。前端已按此实现。

#### F-23【P1】进度条没有分母

- **现状**：`turnCount` 有，`turnLimit`/`maxTurns` 没有。PRD §13 待决 #2 说"8–12 轮，硬上限 14"，但前端不知道本场的具体上限。
- **影响**：顶栏"第 6 / 约 10 轮"里的"约 10"只能是硬编码猜测；`ProgressMeter` 只能做不确定态（一条流动的光带），无法做百分比。
- **建议**：`GET detail` 与列表返回 `turnLimit: number`（如 12），或明确"前端只显示已进行轮次，不显示总轮次"。**二选一，必须写下来**，否则 QA 无法断言、UI 无法收口。

### 12.3 哪些状态转换没定义清楚

| ID | 转换 | 问题 | 建议 |
| --- | --- | --- | --- |
| F-24 | `draft → generating` | `POST` 同步返回 `ready`，那 `draft` 和 `generating` 什么时候对客户端可见？失败时返回什么状态的对象？ | 明确：`draft`/`generating` 是**内部状态**，不对外暴露；或提供 `GET /discussions/:id` 能查到 `generating` |
| F-16 | `ready → live` 的 `lastSeq` 语义 | `confirm` 返回 `lastSeq: 2`，而 `discussion.started` 就是 seq 2。客户端 `after=2` 会**跳过 started 事件** | 明确："`after` 用响应里的 `lastSeq`，代表**已包含**的事件上界"；并声明"直播的 `startedAt` 以 `GET detail` / confirm 响应为准，`discussion.started` 事件只服务回放与补发" |
| F-26 | `live → summarizing` 的触发者 | 自然收束由谁判定（AI 决策 / 后端轮次计数）？触发时有没有事件？ | 见 F-04；同时明确"轮次上限由后端强制，AI 只能提前收束，不能超限" |
| F-05 | `live → failed` | 完全缺失 | 见 F-05 |
| F-21 | `summarizing → ended`（总结失败） | 未定义 | 见 F-21 |
| F-13 | `live → ended` 时正在流式的消息 | API §10 说"允许完成或中止，二者都必须落一条最终 `message.completed` 或标记丢弃" | 明确"中止时服务端是否发 `turn.aborted`"；前端按"收到 ended 后丢弃 buffer + 移除 streaming 气泡"实现 |
| F-27 | `GET /events` 对 `live` 会话 | 契约没说能不能查 | 建议：非 `ended` 返回 `409 INVALID_STATE`，前端收到后自动跳 `/d/:id` |

### 12.4 哪些失败路径没兜底

| ID | 失败路径 | 当前后果 | 建议/兜底 |
| --- | --- | --- | --- |
| F-12 | `error` 无 `seq`、不落库 | 断线期间的错误永久丢失，用户看到"莫名跳过一轮" | 可恢复错误也落库为 `warning.raised`（带 seq），或前端在重连后主动提示"期间可能有若干轮被跳过" |
| F-28 | 404 重连风暴 | 前端若用原生重连会无限打 404 | 前端自管重连 + `fatal` 停止条件（已设计）；**建议服务端对 SSE 404 返回 `Content-Type: application/json`**，便于前端区分 |
| F-29 | 浏览器连接数耗尽（HTTP/1.1 同源 6 连接） | 开 5–6 个演播厅标签页时，新连接排队，页面"打不开" | 前端在开页时检测（`performance.getEntriesByType` 粗判不可靠）→ 改为**文档约束**：README 与首页提示"最多同时观看 3 场"；长期方案是 HTTP/2（本地不做） |
| F-30 | `message.delta` 半截文本 | LLM 超时后气泡停在一句话中间，永远不消失 | 前端 20s 无后续事件 → 气泡置灰标记"（发言中断）"，`turn.aborted` 到达后移除 |
| F-31 | SSE 代理缓冲（生产挂 compression） | 事件全卡在缓冲区，表现为"连上了但没数据" | 服务端关闭该路由的压缩（`X-Accel-Buffering: no` 已有；`compression` 中间件需排除 `text/event-stream`）；前端无解，写进 README |
| F-32 | 总结为 null 但 `ended` | 首页卡片 `summaryPreview` 空 | 前端显示"这场讨论没有生成总结" |
| F-18【P1】 | 专家色与语义色撞色 | 某位专家被生成为绿色，与"共识"混淆 | 建议 AI/Agent 在 roster prompt 中排除 `#34D399/#E8735F/#A78BFA/#F0B429` 附近色相；前端用"不同视觉通道"缓解（§8.1） |
| F-11 | delta 无 speaker 展示信息 | 断线后首个事件为 delta 时气泡是空白 | 从 roster 反查（已设计） |
| F-06 | 洞察时间戳全刷 | 整栏周期性闪烁 | 前端做 `id + content` hash 比对 |
| F-20【P2】 | 洞察不归属轮次 | 无法显示"第 6 轮新增 1 条" | 可选增加 `firstSeenTurn` |
| F-33【P1】 | 列表 `experts` 是否全量未定义（示例 4 位只给 2 位） | 首页头像组数量不确定 | 明确"`experts` 返回全部（≤6），或提供 `avatars` 前 4 + `expertCount`" |
| F-34【P1】 | API 响应无 `Cache-Control: no-store` | 首页 5s 轮询可能命中缓存，状态永远不更新 | 所有 `/api` 响应加 `Cache-Control: no-store` |

### 12.5 72 小时内最大的风险

**结论：最大的风险是"同步阻塞式创建阵容 + 无幂等键"（F-02 的根因），不是 UI 工作量。**

理由：

1. **它落在最没有反馈的位置**。用户点了"生成"，接下来 5–12 秒是一个 HTTP 请求在裸等。前端只能做"假装有进度"的骨架动画——这不是产品设计，是在掩盖架构问题。
2. **失败不可恢复，且会污染数据**。超时/刷新/重试都会产生新的 discussion，首页出现两条一模一样的议题。这是演示时最容易被面试官看到的那类 bug（"你点了两次？"）。
3. **它是唯一一个"前端无法用兜底解决"的问题**。断线、跳号、乱序、半截文本、404 风暴，前端都能写兜底；唯独"请求超时后服务端可能已经建好了"这件事，前端无从得知。
4. **它同时卡住 QA**。E2E 无法稳定地测"生成中"这个状态，因为它在 HTTP 层是不可观测的。

**如果只允许改一处，就改这一处**：`clientRequestId` 幂等键 + 失败体带 `{discussionId, topic}`。服务端约 20 行，前端约 10 行，换来的是"重试安全 + 失败可续 + 可测试"。

次级风险（按严重度）：

- **R-02 SSE 补发/乱序一致性**：直接摧毁"像直播"的信任。已用"容忍空洞 + 后台补拉 + 按 `turnIndex` 排序"结构性缓解，但仍需要 QA 的断线场景覆盖。
- **R-03 浏览器连接数上限**：本地演示很可能同时开 3–4 个标签，正好在临界点。
- **R-04 首页不刷新**（F-07）：演示脚本里"两场并行"的桥段会当场露馅。

> 相比之下，"回放与直播不一致"虽然是 PRD 列出的高优风险，但它已被"共用 reducer + 播放=连续 seek"从结构上消灭，只剩契约层面 3 个前提（§7.4），是可控的。

### 12.6 前端风险登记（给 PM 排期用）

| ID | 风险 | 影响 | 缓解 | 触发点 |
| --- | --- | --- | --- | --- |
| R-01 | 创建阻塞/重复会话（F-02） | 演示级事故 | 幂等键；前端超时 15s + 首页找回 | G2 前 |
| R-02 | SSE 乱序/补发错误 | 消息错位、重复 | lastSeq 单调 + 容忍空洞 + 补拉 + 稳定 key | G3 联调 |
| R-03 | 同源连接数耗尽 | 多标签打不开 | 文档限制 3 场；单标签最多 1 条 SSE | 演示前 |
| R-04 | 首页不自动刷新（F-07） | FR-12 验收失败 | 5s 轮询 | G3 |
| R-05 | 三档断点下 `min-height:0` 漏写 | 页面出现整体滚动条 | 写成一个 `Panel` 组件的默认样式，禁止页面里手写 `overflow` | FE-02 |
| R-06 | React 严格模式双挂载导致双 SSE | 事件重复、连接泄漏 | `dispose()` 幂等 + `useEffect` 清理 | FE-04 |
| R-07 | 回放逐帧重算的性能预期落空 | 拖动卡顿 | 事件量 < 100，实测 < 1ms；超 500 时降级为增量 | FE-05 |
| R-08 | 专家色撞语义色（F-18） | 视觉混淆 | 不同视觉通道 + roster prompt 排除 | G4 走查 |
| R-09 | 视觉走查时间不足 | "后台风"返工 | token 先冻结（§8），FE-02 就落地，不留到最后调 | FE-02 |

---

## 13. 测试钩子（给 QA，不写用例）

- **`data-testid` 约定**：`stage-header`、`status-pill`、`expert-card-{expertId}`、`message-{messageId}`、`insight-{type}-{insightId}`、`jump-to-latest`、`insight-badge`、`replay-slider`、`replay-speed-{1|1.5|2}`、`reconnect-banner`。
- **事件 fixture**：`apps/web/src/test/fixtures/events/*.json`，与 `packages/shared` 的 Zod schema 共用；QA 可直接复用同一批 fixture 做 E2E（保证"前端单测输入"与"E2E 输入"同源）。
- **确定性 SSE**：Playwright 用 `page.route('**/stream*', ...)` 返回一段预录的 `text/event-stream` body（含心跳与 `retry`），逐事件可控节奏。**不依赖真实模型**。
- **可选（30 分钟）**：`?e2e=1` 时挂 `window.__PANEL_DEBUG__ = { getView(), getConnectionState() }`，让 E2E 直接断言 reducer 状态而非抓 DOM 文本。默认生产构建不启用。
- **组件测试重点**：`sessionReducer`（纯函数，覆盖 7 类事件 + 乱序 + 重复 + 空洞）、`replayReducer` 等价性（`reduce(events)` 与 `hydrate(detail)` 比对）、`StreamBuffer`（按帧合并、commit 覆盖、drop）、`useStickyScroll`（阈值 80px、上滚暂停、跳转恢复）。

---

## 14. 交付拆分与工时（FE-02 ~ FE-05）

| ID | 内容 | 依赖 | 估算 | 出口 |
| --- | --- | --- | --- | --- |
| FE-02 | Vite 骨架、`tokens.css`、`globals.css`、`AppShell`、共享原语（Button/Panel/StatusPill/EmptyState/ErrorState/Drawer/Tabs）、`api.ts` | PM-02 脚手架 | 3h | 三档断点下"页面不滚、面板能滚"可验证 |
| FE-03 | 首页列表 + 创建 + 生成中 + 阵容确认（Lobby） | BE-03 | 4h | FR-01/02/03/04 可走通 |
| FE-04 | 演播厅：`SessionProvider` + reducer 绑定 + `SessionStream` + StreamBuffer + Transcript + ExpertRail + InsightPanel + PlaybackBar(live) | BE-04、AI-03 | 6h | 直播主链路 + 断线重连 + 三态专家 |
| FE-05 | 回放（Timeline/倍速/跳转）、抽屉与 Tab 响应式、异常态收口、视觉走查 | FE-04、BE-04 | 4h | FR-05/08/09/11/15 可验收 |
| — | 合计 | | **17h** | 与技术选型 §7.1 的 14–18h 一致 |

**排期建议**：FE-02 必须最先做且不可压缩（token 与布局规则是所有后续工作的地基）；FE-04 是关键路径（SSE + 流式），应尽早拿到 BE-04 的 mock 流做并行开发；FE-05 的回放依赖 FE-04 的 reducer 冻结，可等。

---

## 15. 待 PM 裁决

| # | 议题 | 选项 | 前端倾向 |
| --- | --- | --- | --- |
| A1 | `POST /discussions` 是否加 `clientRequestId` 幂等 | 加 / 不加 | **必须加**（F-02，P0） |
| A2 | 首页"进行中 + 待确认 + 最近结束"如何取数 | 改 `status` 多值 / 前端拉全量本地分组 | 改 `status`（F-01） |
| A3 | 首页状态刷新 | 5s 轮询 / 手动刷新 / 全局 SSE | 5s 轮询（F-07） |
| A4 | `turnLimit` 是否下发 | 下发 / 明确"前端只显示已进行轮次" | 下发（F-23），进度条才有意义 |
| A5 | 是否新增 `turn.aborted` / `discussion.summarizing` / `discussion.failed` 三个事件 | 全加 / 只加 summarizing | **全加**（F-03/04/05），这是"不卡死"的三个支点 |
| A6 | 结尾是否允许 `summary = null` 的 `ended` | 允许 / 重试总结后再 ended | 允许（F-21），别让会话卡在 summarizing |
| A7 | 回放最短/最长事件间隔 | `150ms / 2000ms` | 写入契约，便于 QA 断言 |
| A8 | 首页分组展示顺序 | 进行中 → 待确认 → 最近结束 | 同左（PRD §13 待决 #3 建议） |

---

## 16. 版本与变更

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v0.1 | 2026-10-31 | 首版：路由、三档布局、组件树、状态机、SSE 客户端、回放、token、线框、契约评审 |

**后续（G1 冻结后）**：本文档随契约 v1.0 同步更新一次；FE-02 起，设计实现细节落到 `apps/web/README.md`，本文档只保留"为什么"。
