# 真实 DeepSeek Smoke 记录

## 最新：深度讨论改版后（thinking 按 prompt 分配）

- 日期：2026-11-01 14:11–14:14（Asia/Shanghai）
- 模式：`LLM_MODE=real`，独立 `data/real-final.db`，端口 3002（不影响演示库）
- 模型：`deepseek-flash`
- thinking：SPEECH/SUMMARY 开；ROSTER/DECIDE/INSIGHT 关（防止 JSON 输出被推理吃空）
- 配置：`.env.local`，Key 未打印、未提交、未进入日志
- 议题：`AI 应该替代管理者做决策吗？`，3 位专家

### 结果

```text
POST /api/discussions            → 201 ready
POST /api/discussions/:id/confirm → 202 live
t=8s    live        turns=1
t=28s   live        turns=7   insights=3
t=53s   live        turns=12  insights=5
t=108s  live        turns=22  insights=7
t=179s  summarizing turns=36  insights=7
RESULT:
  status=ended
  turns=36 / max=36 / planned(coverageFloor)=8
  elapsed=184s
  messages=36
  degraded=0
  referenced=30 / 36（83% 的发言引用了具体 messageId）
  insights=7
  summaryChars=395
  errorCode=null
```

### 输出抽样

- 开场（主持人）：
  > 真正的分歧不在 AI 准不准，而在决策出错后由谁担责。唐一鸣说的“例外”由谁认定？
- 专家交锋：
  > 有条件同意你那半句“预先设好升级规则”，但规则由谁写、谁能改？——那才是最硬的决策权；再往下，改一次阈值就把责任摊薄一层，最后谁都认不了。
- 反驳：
  > 反对“锚不住谁能否决”这半句：驳回率趋近于零也可能是没人敢驳，指标反而把否决权藏得更深。真正的否决权是“无人同意时谁能一键停掉 AI”，把它写进权限表并定期演练，签名才不是图章。
- 总结（节选）：
  > 这场没有形成明确共识……主要分歧在于 AI 替代的边界该由什么来定……没解决的是：算法在替督导决策这层追问，沈砺没有正面回答；发版权这条边界由谁划、代价谁付也悬着。可以带走的判断是，先别急着定“替不替代”，把谁验、谁改、谁按停这三件事落到具体的人头上，比争论 AI 能不能拍板更要紧。

### 结论

- **质量**：0 条 degraded；30/36 条发言有具体 `targetMessageId`；专家在互相回应/有条件同意/反驳，不再是角色独白。
- **收束**：36 轮是安全上限，不是目标。本场始终有一个未回应的挑战，`saturation.ready` 没有满足，因此走 36 轮硬上限；总结显式列出了未解决争点。这证明“未饱和不硬收”与“36 兜底”都生效，不证明每场都会提前收。
- **成本/延迟**：3 位专家、36 轮、184s；按 token 估算单场约 ¥0.5（以账单为准）。
- **边界**：只跑了 1 场真实 3 人局；未做 5 议题真实 eval / 5 会话真实并发。

## 历史：第一版 smoke（thinking off，已被上面的结果取代）

- 日期：2026-11-01 12:27
- 模式：`LLM_MODE=real`，`deepseek-flash`，thinking disabled
- 4 位专家，12 轮，27s，6 洞察，总结正常
- 结论：真实链路 / JSON / 流式 / 洞察 / 总结均可用；但专家深度和交锋不足，促成了 v2 深度改版。

## Key 安全

- `.env.local` 在 `.gitignore` 内；`git status` 不显示；
- 前端 bundle 扫描无 Key；
- 日志只输出 `llmMode/model/thinking`，不含 Key；
- 本次 smoke 使用独立 DB，未污染 5 条演示样例。

## 复现

```powershell
cd <repo-root>
$env:LLM_MODE="real"
$env:PORT="3002"
$env:DATABASE_PATH="data/real-smoke.db"
.\scripts\pnpm.ps1 --filter @ai-panel/server dev
# 另一个终端：POST /api/discussions → confirm → 轮询 detail
```
