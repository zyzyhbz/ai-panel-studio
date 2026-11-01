import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOPIC_FIXTURES, char3GramJaccard, countSentences } from "../packages/agent/src/index.ts";
import { simulateSession, type SimulationResult } from "./simulate";

/**
 * 行为基线（mock 模式）。
 *
 * 跑法：`.\scripts\pnpm.ps1 exec tsx evals/run.ts`
 * 产出：evals/report/baseline.mock.json + .md
 *
 * 注意：mock 模式验证的是**链路与守卫**（schema、预算、降级、分布、覆盖），
 * 不是模型质量。真实模型的质量基线要等后端在 `LLM_MODE=real` 下跑同一套指标。
 */

const PRICE_INPUT_USD_PER_M = 0.3;
const PRICE_OUTPUT_USD_PER_M = 1.2;
const USD_TO_RMB = 7.1;

interface Thresholds {
  jsonLegalRate: number;
  sentenceCompliance: number;
  lengthCompliance: number;
  coverageRate: number;
  maxExpertShare: number;
  hostShareMax: number;
  rotationViolations: number;
  repetitionRate: number;
  polarityKinds: number;
  evidenceRate: number;
  summaryParagraphs: number;
  costRmbMax: number;
  referenceRate: number;
  hostProbeRate: number;
  turnsMin: number;
  turnsMax: number;
}

export interface Metrics {
  fixture: string;
  topic: string;
  expertCount: number;
  turns: number;
  jsonLegalRate: number;
  sentenceCompliance: number;
  lengthCompliance: number;
  coverageRate: number;
  maxExpertShare: number;
  hostShare: number;
  rotationViolations: number;
  repetitionRate: number;
  referenceRate: number;
  rebutSupportRatio: number;
  noveltyRate: number;
  hostProbeRate: number;
  selfRepeatRate: number;
  polarityKinds: number;
  hasOppose: boolean;
  evidenceRate: number;
  twoSpeakerRate: number;
  insightCount: number;
  summaryParagraphs: number;
  summaryIsFallback: boolean;
  summaryJsonLeak: boolean;
  decisionRepairs: number;
  rejectedInsights: number;
  speechIssues: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costRmb: number;
  decisionP95Ms: number;
  speechP95Ms: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function maxConsecutive(messages: { expertId: string }[]): number {
  let max = 0;
  let current = 0;
  let last = "";
  for (const message of messages) {
    current = message.expertId === last ? current + 1 : 1;
    last = message.expertId;
    if (current > max) max = current;
  }
  return max;
}

/**
 * 是否出现周期 2–4、**连续**重复 ≥3 轮的"机械轮转"序列。
 * 只统计连续重复（一旦断掉就停），否则 36 轮里偶然撞上一对分片就会被误判。
 */
function rotationViolations(messages: { expertId: string }[]): number {
  const ids = messages.map((m) => m.expertId);
  let violations = 0;
  for (const period of [2, 3, 4]) {
    if (ids.length < period * 3) continue;
    for (let start = 0; start + period * 3 <= ids.length; start += 1) {
      let repeats = 0;
      for (let i = start + period; i + period <= ids.length; i += period) {
        const same = ids.slice(i, i + period).every((id, k) => id === ids[start + k]);
        if (!same) break;
        repeats += 1;
      }
      if (repeats >= 2) {
        violations += 1;
        break;
      }
    }
  }
  return violations;
}

function adjacentRepetitionRate(messages: { content: string }[]): number {
  if (messages.length < 2) return 0;
  let high = 0;
  for (let i = 1; i < messages.length; i += 1) {
    if (char3GramJaccard(messages[i]!.content, messages[i - 1]!.content) > 0.5) high += 1;
  }
  return high / (messages.length - 1);
}

function computeMetrics(result: SimulationResult): Metrics {
  const { messages, snapshot } = result;
  const host = snapshot.experts.find((e) => e.role === "host");
  const experts = snapshot.experts.filter((e) => e.role === "expert");
  const expertMessages = messages.filter((m) => m.expertId !== host?.id);
  const hostMessages = messages.filter((m) => m.expertId === host?.id);

  const counts = new Map<string, number>();
  for (const message of expertMessages) {
    counts.set(message.expertId, (counts.get(message.expertId) ?? 0) + 1);
  }
  const covered = experts.filter((e) => (counts.get(e.id) ?? 0) > 0).length;
  const maxCount = Math.max(1, ...[...counts.values()]);

  const sentenceOk = messages.filter((m) => {
    const count = countSentences(m.content);
    return count >= 1 && count <= 2;
  }).length;
  const lengthOk = messages.filter((m) => {
    const isHost = m.expertId === host?.id;
    return m.charCount <= (isHost ? 60 : 120) && m.charCount > 0;
  }).length;

  const withEvidence = result.insights.filter((i) => i.evidenceMessageIds.length > 0).length;
  const divergence = result.insights.filter((i) => i.type === "divergence");
  const twoSpeaker = divergence.filter((i) => {
    const speakers = new Set(
      i.evidenceMessageIds
        .map((id) => messages.find((m) => m.id === id)?.expertId)
        .filter(Boolean),
    );
    return speakers.size >= 2;
  }).length;

  const costUsd =
    (result.inputTokens / 1_000_000) * PRICE_INPUT_USD_PER_M +
    (result.outputTokens / 1_000_000) * PRICE_OUTPUT_USD_PER_M;

  // ── 改版新增指标（引用率 / 反驳支持比 / 新论点率 / 主持人追问率 / 自我重复率）──
  const debatable = messages.filter((m) => m.intent !== "opening");
  const referenced = debatable.filter(
    (m) => Boolean(m.targetMessageId) || (m.references?.length ?? 0) > 0,
  ).length;
  const referenceRate = debatable.length === 0 ? 1 : referenced / debatable.length;

  const rebutCount = messages.filter((m) => m.intent === "rebut").length;
  const supportCount = messages.filter((m) => m.intent === "support").length;
  const rebutSupportRatio = rebutCount / Math.max(1, supportCount);

  // 新论点率：与之前所有发言的 3-gram 相似度都 < 0.5 才算"新东西"
  const novel = messages.filter((message, index) =>
    messages
      .slice(0, index)
      .every((previous) => char3GramJaccard(message.content, previous.content) < 0.5),
  ).length;
  const noveltyRate = messages.length === 0 ? 0 : novel / messages.length;

  const hostProbeRate =
    hostMessages.length === 0
      ? 1
      : hostMessages.filter((m) => m.intent === "probe" || m.intent === "mediate").length /
        hostMessages.length;

  // 自我重复率：同一人后一次发言与他自己之前某次高度相似
  let selfRepeats = 0;
  for (const [index, message] of messages.entries()) {
    const ownEarlier = messages.slice(0, index).filter((m) => m.expertId === message.expertId);
    if (ownEarlier.some((m) => char3GramJaccard(m.content, message.content) > 0.6)) {
      selfRepeats += 1;
    }
  }
  const selfRepeatRate = messages.length === 0 ? 0 : selfRepeats / messages.length;

  return {
    fixture: result.fixture.id,
    topic: result.fixture.topic,
    expertCount: snapshot.expertCount,
    turns: messages.length,
    jsonLegalRate:
      result.jsonCallCount === 0 ? 1 : result.jsonOkCount / result.jsonCallCount,
    sentenceCompliance: messages.length === 0 ? 0 : sentenceOk / messages.length,
    lengthCompliance: messages.length === 0 ? 0 : lengthOk / messages.length,
    coverageRate: experts.length === 0 ? 1 : covered / experts.length,
    maxExpertShare: expertMessages.length === 0 ? 0 : maxCount / expertMessages.length,
    hostShare: messages.length === 0 ? 0 : hostMessages.length / messages.length,
    rotationViolations: rotationViolations(messages),
    repetitionRate: adjacentRepetitionRate(messages),
    referenceRate,
    rebutSupportRatio,
    noveltyRate,
    hostProbeRate,
    selfRepeatRate,
    polarityKinds: new Set(experts.map((e) => e.polarity)).size,
    hasOppose: experts.some((e) => e.polarity === "oppose" || e.polarity === "strong_oppose"),
    evidenceRate: result.insights.length === 0 ? 1 : withEvidence / result.insights.length,
    twoSpeakerRate: divergence.length === 0 ? 1 : twoSpeaker / divergence.length,
    insightCount: result.insights.length,
    summaryParagraphs: result.summary.paragraphs.length,
    summaryIsFallback: result.summary.isFallback,
    summaryJsonLeak: result.summary.hasJsonLeak,
    decisionRepairs: result.decisionRepairs,
    rejectedInsights: result.rejectedInsights,
    speechIssues: result.speechIssues.length,
    calls: result.calls,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costRmb: costUsd * USD_TO_RMB,
    decisionP95Ms: percentile(result.timings.decisionMs, 95),
    speechP95Ms: percentile(result.timings.speechMs, 95),
  };
}

interface Check {
  name: string;
  value: number | string;
  threshold: number | string;
  ok: boolean;
}

function evaluate(metrics: Metrics[], thresholds: Thresholds): Check[] {
  const avg = (pick: (m: Metrics) => number): number =>
    metrics.reduce((sum, m) => sum + pick(m), 0) / Math.max(1, metrics.length);
  const min = (pick: (m: Metrics) => number): number =>
    Math.min(...metrics.map(pick));
  const sum = (pick: (m: Metrics) => number): number =>
    metrics.reduce((acc, m) => acc + pick(m), 0);

  return [
    { name: "JSON 合法率", value: avg((m) => m.jsonLegalRate), threshold: thresholds.jsonLegalRate, ok: avg((m) => m.jsonLegalRate) >= thresholds.jsonLegalRate },
    { name: "1–2 句合规率", value: avg((m) => m.sentenceCompliance), threshold: thresholds.sentenceCompliance, ok: min((m) => m.sentenceCompliance) >= thresholds.sentenceCompliance },
    { name: "字数合规率", value: avg((m) => m.lengthCompliance), threshold: thresholds.lengthCompliance, ok: min((m) => m.lengthCompliance) >= thresholds.lengthCompliance },
    { name: "专家覆盖率", value: avg((m) => m.coverageRate), threshold: thresholds.coverageRate, ok: min((m) => m.coverageRate) >= thresholds.coverageRate },
    { name: "单人最大占比", value: Math.max(...metrics.map((m) => m.maxExpertShare)), threshold: thresholds.maxExpertShare, ok: Math.max(...metrics.map((m) => m.maxExpertShare)) <= thresholds.maxExpertShare },
    { name: "主持占比", value: Math.max(...metrics.map((m) => m.hostShare)), threshold: thresholds.hostShareMax, ok: Math.max(...metrics.map((m) => m.hostShare)) <= thresholds.hostShareMax },
    { name: "机械轮转违规", value: sum((m) => m.rotationViolations), threshold: thresholds.rotationViolations, ok: sum((m) => m.rotationViolations) <= thresholds.rotationViolations },
    { name: "相邻重复率", value: Math.max(...metrics.map((m) => m.repetitionRate)), threshold: thresholds.repetitionRate, ok: Math.max(...metrics.map((m) => m.repetitionRate)) <= thresholds.repetitionRate },
    { name: "极性种类（最少）", value: min((m) => m.polarityKinds), threshold: thresholds.polarityKinds, ok: min((m) => m.polarityKinds) >= thresholds.polarityKinds },
    { name: "存在反对侧", value: metrics.every((m) => m.hasOppose) ? "全部" : "有缺失", threshold: "全部", ok: metrics.every((m) => m.hasOppose) },
    { name: "共识证据合法率", value: avg((m) => m.evidenceRate), threshold: thresholds.evidenceRate, ok: min((m) => m.evidenceRate) >= thresholds.evidenceRate },
    { name: "分歧双人证据率", value: avg((m) => m.twoSpeakerRate), threshold: thresholds.evidenceRate, ok: min((m) => m.twoSpeakerRate) >= thresholds.evidenceRate },
    { name: "总结段数", value: min((m) => m.summaryParagraphs), threshold: thresholds.summaryParagraphs, ok: metrics.every((m) => m.summaryParagraphs === thresholds.summaryParagraphs) },
    { name: "总结无 JSON 痕迹", value: metrics.every((m) => !m.summaryJsonLeak) ? "全部" : "有泄漏", threshold: "全部", ok: metrics.every((m) => !m.summaryJsonLeak) },
    { name: "单场成本（¥，最大）", value: Math.max(...metrics.map((m) => m.costRmb)), threshold: thresholds.costRmbMax, ok: Math.max(...metrics.map((m) => m.costRmb)) <= thresholds.costRmbMax },
    { name: "引用率（回应具体发言）", value: avg((m) => m.referenceRate), threshold: thresholds.referenceRate, ok: min((m) => m.referenceRate) >= thresholds.referenceRate },
    { name: "主持人追问率", value: avg((m) => m.hostProbeRate), threshold: thresholds.hostProbeRate, ok: min((m) => m.hostProbeRate) >= thresholds.hostProbeRate },
    { name: "平均轮次下限", value: min((m) => m.turns), threshold: thresholds.turnsMin, ok: min((m) => m.turns) >= thresholds.turnsMin },
    { name: "轮次不超上限", value: Math.max(...metrics.map((m) => m.turns)), threshold: thresholds.turnsMax, ok: Math.max(...metrics.map((m) => m.turns)) <= thresholds.turnsMax },
  ];
}

/** 参考指标：mock 的固定台词决定了它们不可作门禁，只用于观察趋势。 */
function infoMetrics(metrics: Metrics[]): Array<{ name: string; value: string }> {
  const avg = (pick: (m: Metrics) => number): number =>
    metrics.reduce((sum, m) => sum + pick(m), 0) / Math.max(1, metrics.length);
  return [
    { name: "反驳:支持比", value: avg((m) => m.rebutSupportRatio).toFixed(2) },
    { name: "新论点率（mock 参考）", value: pct(avg((m) => m.noveltyRate)) },
    { name: "自我重复率（mock 参考）", value: pct(avg((m) => m.selfRepeatRate)) },
    { name: "平均轮次", value: avg((m) => m.turns).toFixed(1) },
    { name: "平均洞察条数", value: avg((m) => m.insightCount).toFixed(1) },
  ];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCheck(check: Check): string {
  const value = typeof check.value === "number" ? check.value.toFixed(3) : check.value;
  const threshold = typeof check.threshold === "number" ? check.threshold.toFixed(3) : check.threshold;
  return `| ${check.ok ? "✅" : "❌"} | ${check.name} | ${value} | ${threshold} |`;
}

function toMarkdown(metrics: Metrics[], checks: Check[], latencyMs: number): string {
  const lines: string[] = [];
  lines.push("# 行为基线报告（mock 模式）");
  lines.push("");
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 议题数：${metrics.length}；mock 调用延迟：${latencyMs}ms/次`);
  lines.push("- 说明：mock 模式验证**链路与守卫**（schema/预算/降级/分布/覆盖），不代表真实模型质量。");
  lines.push("");
  lines.push("## 逐场指标");
  lines.push("");
  lines.push("| 议题 | 轮次 | JSON | 1–2句 | 字数 | 覆盖 | 最大占比 | 主持占比 | 引用率 | 追问率 | 轮转 | 重复 | 极性 | 洞察 | 总结段 | 成本(¥) |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const m of metrics) {
    lines.push(
      `| ${m.fixture}（${m.expertCount}人） | ${m.turns} | ${pct(m.jsonLegalRate)} | ${pct(
        m.sentenceCompliance,
      )} | ${pct(m.lengthCompliance)} | ${pct(m.coverageRate)} | ${pct(m.maxExpertShare)} | ${pct(
        m.hostShare,
      )} | ${pct(m.referenceRate)} | ${pct(m.hostProbeRate)} | ${m.rotationViolations} | ${pct(
        m.repetitionRate,
      )} | ${m.polarityKinds} | ${m.insightCount} | ${m.summaryParagraphs} | ${m.costRmb.toFixed(3)} |`,
    );
  }
  lines.push("");
  lines.push("## 参考指标（不设门禁）");
  lines.push("");
  for (const item of infoMetrics(metrics)) lines.push(`- ${item.name}：${item.value}`);
  lines.push("");
  lines.push("## 门禁判定");
  lines.push("");
  lines.push("| 结果 | 指标 | 实测 | 阈值 |");
  lines.push("| --- | --- | --- | --- |");
  for (const check of checks) lines.push(formatCheck(check));
  lines.push("");
  const failed = checks.filter((c) => !c.ok);
  lines.push(
    failed.length === 0
      ? "**结论：全部通过。**"
      : `**结论：${failed.length} 项未通过 → ${failed.map((f) => f.name).join("、")}**`,
  );
  lines.push("");
  lines.push("## 明细");
  lines.push("");
  for (const m of metrics) {
    lines.push(
      `- ${m.fixture}：决策修复 ${m.decisionRepairs} 次，被拒洞察 ${m.rejectedInsights} 条，发言问题 ${
        m.speechIssues
      } 个，调用 ${m.calls} 次，输入 ${m.inputTokens} tokens，输出 ${m.outputTokens} tokens，决策 p95 ${
        m.decisionP95Ms
      }ms，发言 p95 ${m.speechP95Ms}ms`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const latencyArg = process.argv.find((arg) => arg.startsWith("--latency="));
  const latencyMs = latencyArg ? Number(latencyArg.split("=")[1]) : 15;
  const thresholdsPath = join(import.meta.dirname, "thresholds.json");
  const thresholds = JSON.parse(readFileSync(thresholdsPath, "utf8")) as Thresholds;

  const results: SimulationResult[] = [];
  for (const fixture of TOPIC_FIXTURES) {
    results.push(await simulateSession({ fixture, latencyMs }));
  }

  const metrics = results.map(computeMetrics);
  const checks = evaluate(metrics, thresholds);
  const failed = checks.filter((check) => !check.ok);

  const reportDir = join(import.meta.dirname, "report");
  mkdirSync(reportDir, { recursive: true });
  const jsonPath = join(reportDir, "baseline.mock.json");
  const mdPath = join(reportDir, "baseline.mock.md");
  writeFileSync(
    jsonPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), latencyMs, thresholds, metrics, checks }, null, 2),
    "utf8",
  );
  writeFileSync(mdPath, toMarkdown(metrics, checks, latencyMs), "utf8");

  console.log("\n议题   轮次  JSON    覆盖   最大占比  轮转  成本(¥)");
  for (const m of metrics) {
    console.log(
      `${m.fixture.padEnd(5)} ${String(m.turns).padStart(4)}  ${pct(m.jsonLegalRate).padEnd(6)} ${pct(
        m.coverageRate,
      ).padEnd(6)} ${pct(m.maxExpertShare).padEnd(8)} ${String(m.rotationViolations).padEnd(4)} ${m.costRmb.toFixed(3)}`,
    );
  }
  console.log(`\n门禁：${checks.length - failed.length}/${checks.length} 通过`);
  for (const check of failed) console.log(`  ❌ ${check.name}: ${check.value}（阈值 ${check.threshold}）`);
  console.log(`\n报告：${mdPath}`);

  if (failed.length > 0) process.exitCode = 1;
}

await main();
