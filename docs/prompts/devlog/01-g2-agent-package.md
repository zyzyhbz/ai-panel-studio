# devlog-01：G2 收口 agent 包（AI-02 / AI-03）

- 日期：2026-11-01
- 阶段：G2（`packages/agent` 从 WIP 收口成后端可直接调用的包）
- 产出：`packages/agent/src/**`、`docs/AGENT-API.md`、`docs/prompts/runtime/**`
- 结果：`typecheck` 无错误、`test` 70/70 通过

> 本文件按题目要求记录"引导 AI 干的原始 Prompt + 当时意图 + 遇到的挑战 + 如何修正"。
> 与 `runtime/` 区分：runtime 是**产品运行时**的 prompt，这里记录的是**开发过程**的 prompt。

---

## 1. 原始 Prompt（PM 派单）

```text
恢复 G2，继续 AI-02/03。昨晚 WIP 已提交在 54c6397，docs/PAUSE-STATE.md 有状态。
先读 docs/06-G1契约决议.md。

packages/agent/src 已有 prompts/schema/policy/context/llm 等 WIP，但需要收口成可被后端直接调用的包。优先：
1. src/index.ts 导出稳定 API：LLMClient、PromptSpec、五类 builder、context assembler、schema parse、policy guard、mock client。
2. 给出 docs/AGENT-API.md（后端怎么注入、调用顺序、返回类型），越早越好。
3. 五类 prompt 全文落 docs/prompts/runtime/；docs/prompts/devlog/ 至少补 1 条开发过程记录。
4. mock client + 5 个议题 fixture；单测覆盖 schema/guard/context 预算。
5. 不要接真实 HTTP/Key；真实 transport 由后端注入。

只改 packages/agent/**、evals/**、docs/prompts/**、docs/AGENT-API.md；
不要跑 git/install，不改 server/web。命令用 .\scripts\pnpm.ps1 ...
目标 3–4h 内让后端能 import 并跑通 mock 决策/发言；先交接口，再补测试。
```

## 2. 当时意图

断电前 agent 包是"按我自己的设计"写的：`LLMClient.complete()` + `PromptSpec.messages[]`。
但断电期间后端已经按**另一套形状**写完了 `apps/server/src/llm`（`json<T>()` + `stream()` + `LlmMockMeta`），
并留了一行注释："When `@ai-panel/agent` exports `LLMClient`, replace this file with a re-export."

所以这一轮的核心不是"补文件"，而是**先决定谁适配谁**，否则接口一发布，后端就要返工。

## 3. 挑战与修正

### 挑战 1：两套 `LLMClient` 形状冲突（最大的返工风险）

- 我方：`complete(req)` / `stream(req, onDelta)`，`PromptSpec.messages: ChatMessage[]`
- 后端：`json<T>({ prompt, parse, meta })` / `stream(req)` 返回 `AsyncGenerator`，`PromptSpec.system + user`

**决策：对齐后端已写好的形状**，把我方的 `messages[]` 拆成 `system/user`，并保留 `id/version/timeoutMs/estimatedInputTokens/thinking` 作为**可选**元数据；
`parse` 回调放进 request，解析失败抛错即触发后端的修复重试。

理由：后端已经用它跑通了建局链路，改后端的成本 > 改我方的成本；而且 `parse` 在客户端侧做，正是"谁负责重试"的正确切分。
代价：prompt builder 内部要把 `messages` 改成两个字符串，五处 `makeSpec` 调用点全部不动（改在 `makeSpec` 里）。

结果：后端把 `apps/server/src/llm/types.ts` 改成 `export * from "@ai-panel/agent"` 即可，`mock.ts`/`deepseek.ts` 零改动。

### 挑战 2：契约 v1.0 删了 `insight.status` 与 `insight.axis`

断电前的 schema 还带着这两个字段（我 G1 的建议被部分接受、部分推迟）。schema 的 `.strict()` 会把模型多给的字段判失败，
所以必须同步删掉，否则线上解析失败率会莫名升高。

修正：`insightItemOutputSchema` 只保留 `id?/type/content/evidenceMessageIds/firstSeenTurn?`，
并在 AGENT-BEHAVIOR 的判定规则里去掉"resolved"分支。

### 挑战 3：mock 全链路 3 条测试失败（真实踩坑，值得留档）

1. **`empty` 场景没抛错**：mock 的 `renderJson` 只在 `invalid-json` 分支返回坏数据，`empty` 仍返回合法 roster，
   parse 自然成功。→ 修复：`empty` 在渲染阶段直接返回 `""`，让 parse 失败，再翻译成 `LlmError(empty_output)`。
2. **`long` 场景只有 83 字**：超长后缀写得太短，总长没到 120，断言"被截断到 120 以内"根本没验证到任何东西。→ 修复：后缀扩到 ~110 字。
3. **一次刷新丢 1 条 insight（`over_max_new`）**：`MAX_NEW_INSIGHTS` 是全局 2 条，
   而一次刷新正常产出 consensus + divergence + open_question 三条，第三条被整体上限砍掉。
   → 修复：改成**按类型分别计上限**（每类 2 条）。这是一个**规则 bug**，不是测试 bug：真实链路里也会把待验证问题吞掉。

另自查到两处：`chunkText` 在一次编辑中丢了 `const chars = Array.from(text)`（被 long 用例逮到）；
mock 选证据改为"优先两位非主持人的不同发言者"，否则 `need_two_speakers` 会拒掉共识/分歧。

### 挑战 4：颜色字段的两套写法

后端 fixtures 用 `color`（hex），我方的调色板设计用 `colorKey`（避开语义色相）。
强行统一会让后端改 fixtures。→ 修复：schema 接受**二选一**（`refine` 校验恰好一个），`normalizeRoster` 两种都能解析，重复/非法再退回调色板。

### 挑战 5：一次"乱码"误报（值得记下来，因为差点改坏正确文件）

PM 反馈 `packages/agent/src` 大量 mojibake，贴出的证据长这样：

```text
"鎵€鏈夎緭鍑轰娇鐢ㄧ畝浣撲腑鏂囥€?
```

这与我在 `apps/server/src/llm/fixtures.ts` 上看到的"乱码"完全同型。先做字节级校验，而不是直接重写：

1. 用 `UTF8Encoding(false, true)`（遇非法字节抛错）严格解码 67 个文件 → **0 个非法 UTF-8**、**0 个 U+FFFD**；
2. 扫双重编码特征（`â€/æœ/ä¸/å¤`）→ **0 个文件**；
3. 最直接的一步：跑 5 个 builder，把**真实产出的 system/user 字符串**（8,671 字）整体扫一遍 → 0 处乱码，CJK 占比 28%–78%；
4. 复现：本机 `$PSVersionTable.PSVersion = 5.1`，`Get-Content` 默认按 GBK 解码 UTF-8 文件，读同一行**一字不差**地复现了上面的乱码；加 `-Encoding UTF8` 就正常。

结论：**文件没有坏，是读取端默认编码问题**。PM 随后也自行更正了。

教训：

- 不要凭"控制台显示"判断编码，要看字节：`[System.IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)`；
- 收到"大范围乱码"时，先做**全量字节校验 + 运行时字符串抽样**，再决定是否重写——一旦盲目重写，就会把 8,671 字的正确 prompt 全部破坏，而且 git 历史里看不出来；
- 顺带把这条写进 `AGENT-API` 的排查建议：运行期"洞察恒为 0"用 `summarizeInsightRejections()` 看拒绝原因，同样是"先诊断再改"。

## 4. 复盘

- **先接口后测试**是对的：接口一发布，后端当天就切完并 typecheck 绿；如果先写测试，接口形状还会反复，测试全要重写。
- **"对齐已存在的消费者"比"坚持自己的设计"更省时间**，但前提是把差异写进文档（AGENT-API §1/§1.1），否则下一个人会以为有两套标准。
- 测试抓到的 3 个问题里，只有 1 个是测试写错，另外 2 个（空输出路径、按类型上限）都是**产品行为 bug**——所以全链路 smoke 测试不能省。
- **早停（early_stop）是被数学否掉的**：主持固定 4 席，第 8 轮收就会是 4/8=50% 主持占比。原来写在行为规范里的"三档收尾"在实现 + eval 时被证伪，已改为两档（planned_reached / hard_cap）。这属于"文档看着合理、放进约束里不成立"的典型，值得在 G4 调参时警惕同类问题。
- **编码误报**提醒了一件事：多智能体协作里，"看到的现象"要落到字节与运行时输出再下结论，否则很容易把正确的东西改坏。
