#!/usr/bin/env node
/**
 * fixtures 校验器（QA-02 交付物）。
 *
 * 目标：把"fixture 是不是合法、字段是否对齐契约 v1.0（docs/06-G1契约决议.md）"
 * 变成可重复执行的检查，而不是靠人眼看 JSON。
 *
 * 用法：
 *   .\scripts\pnpm.ps1 exec node e2e/tools/validate-fixtures.mjs
 *   .\scripts\pnpm.ps1 exec node e2e/tools/validate-fixtures.mjs --json   # 机器可读
 *
 * 退出码：0 = 全绿；1 = 有 error（version/exit 供 CI 用）。
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const FIX = path.join(path.resolve(import.meta.dirname, ".."), "fixtures");
const AS_JSON = process.argv.includes("--json");
const MAX_CHARS = 120;

const errors = [];
const warns = [];
const stats = { files: 0, byKind: {}, bySchema: {} };

const err = (file, msg) => errors.push({ file, msg });
const warn = (file, msg) => warns.push({ file, msg });

const KINDS = new Set(["roster", "decision", "speech", "consensus", "summary"]);
const SCENARIOS = new Set([
  "normal", "slow", "timeout", "invalid-json", "empty", "duplicate", "runaway", "long", "mixed",
]);
const OUTCOMES = new Set(["ok", "retry_then_ok", "degraded", "abort_turn", "fail_session"]);
const POLARITIES = new Set(["strong_oppose", "oppose", "neutral", "support", "strong_support"]);
const INTENTS = new Set([
  "opening", "probe", "rebut", "support", "extend", "clarify", "mediate", "redirect", "summary",
]);
const EXPERT_FIELDS = [
  "id", "role", "name", "profession", "title", "stance",
  "stanceAxis", "polarity", "color", "focusArea", "sortOrder",
];
const CODE_POINTS = (s) => [...s].length;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

function parseJson(text, file) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    err(file, `JSON 解析失败：${e.message}`);
    return { ok: false, value: null };
  }
}

/* ------------------------------------------------------------------ */
/* 通用 LlmFixture                                                      */
/* ------------------------------------------------------------------ */

function validateLlmFixture(file, doc) {
  const need = (cond, msg) => cond || err(file, msg);
  need(doc.$schema === "qa/llm-fixture@1", `$schema 应为 qa/llm-fixture@1，实际 ${doc.$schema}`);
  need(typeof doc.name === "string" && doc.name.length > 0, "缺少 name");
  need(KINDS.has(doc.kind), `kind 非法：${doc.kind}`);
  need(SCENARIOS.has(doc.scenario), `scenario 非法：${doc.scenario}`);
  need(typeof doc.negative === "boolean", "negative 必须是 boolean");
  need(typeof doc.description === "string" && doc.description.length >= 4, "description 太短");
  need(OUTCOMES.has(doc.expectOutcome), `expectOutcome 非法：${doc.expectOutcome}`);
  need(Array.isArray(doc.expectNotes) && doc.expectNotes.length > 0, "expectNotes 不能为空");
  need(["loop", "last", "fail"].includes(doc.onExhausted), `onExhausted 非法：${doc.onExhausted}`);

  if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
    err(file, "steps 必须是非空数组");
    return;
  }
  doc.steps.forEach((s, i) => {
    if (typeof s?.content !== "string") err(file, `steps[${i}].content 必须是字符串`);
    const t = s?.timing;
    if (t) {
      if (t.hang !== undefined && typeof t.hang !== "boolean") err(file, `steps[${i}].timing.hang 必须是 boolean`);
      for (const k of ["firstTokenDelayMs", "interDeltaMs"]) {
        if (t[k] !== undefined && (typeof t[k] !== "number" || t[k] < 0)) {
          err(file, `steps[${i}].timing.${k} 必须是非负数`);
        }
      }
    }
    const meta = s?.meta;
    if (meta) {
      if (meta.model !== undefined && meta.model !== "deepseek-flash" && meta.model !== "deepseek-v4-pro") {
        warn(file, `steps[${i}].meta.model=${meta.model} 不在 P0 允许范围（deepseek-flash）`);
      }
      if (meta.thinking !== undefined && !["enabled", "disabled"].includes(meta.thinking)) {
        err(file, `steps[${i}].meta.thinking 非法：${meta.thinking}`);
      }
    }
  });

  // 负例必须诚实标记（empty 可能是合法空态，不算负例）
  if (/invalid|dup-|unsupported|round-robin|same-speaker|runaway|json-leak/.test(doc.name)) {
    if (doc.negative !== true) warn(file, "文件名像负例但 negative=false");
  }
  if (doc.negative === true && doc.expectOutcome === "ok") {
    warn(file, "negative=true 但 expectOutcome=ok，确认是否漏标降级");
  }
}

/* ------------------------------------------------------------------ */
/* 按 kind 校验 content 语义                                           */
/* ------------------------------------------------------------------ */

function validateRosterContent(file, doc, stepIndex, text) {
  // 故意坏内容的负例：invalid-json / empty / timeout 的首跳就是坏输出
  const intentionalBad = /invalid-json|empty|timeout/.test(file);
  let parsed;
  try {
    parsed = { ok: true, value: JSON.parse(text) };
  } catch (e) {
    if (!intentionalBad) err(file, `steps[${stepIndex}] roster 内容不是合法 JSON：${e.message}`);
    return;
  }
  const experts = parsed.value?.experts;
  if (!Array.isArray(experts) || experts.length === 0) {
    err(file, `steps[${stepIndex}] 缺少 experts[]`);
    return;
  }
  if (experts.length < 4 || experts.length > 7) {
    err(file, `steps[${stepIndex}] 人数 ${experts.length} 超出 1+3..1+6`);
  }
  const hosts = experts.filter((e) => e.role === "host");
  if (hosts.length !== 1) err(file, `steps[${stepIndex}] host 必须恰为 1，实际 ${hosts.length}`);
  if (experts[0]?.role !== "host") warn(file, "roster 第一位不是 host（展示顺序可能不符）");
  experts.forEach((e, i) => {
    for (const f of EXPERT_FIELDS) {
      if (e[f] === undefined || e[f] === null || e[f] === "") {
        err(file, `experts[${i}] 缺字段 ${f}`);
      }
    }
    if (!POLARITIES.has(e.polarity)) err(file, `experts[${i}] polarity 非法：${e.polarity}`);
    if (!/^#[0-9A-Fa-f]{6}$/.test(e.color ?? "")) err(file, `experts[${i}] color 不是 6 位 hex：${e.color}`);
  });
  const colors = experts.map((e) => (e.color ?? "").toLowerCase());
  if (new Set(colors).size !== colors.length) {
    // 负例允许题名里带 dup-color 的重复
    if (!/dup-color/.test(file)) err(file, `颜色重复：${colors.join(",")}`);
  }
  const names = experts.map((e) => e.name);
  if (new Set(names).size !== names.length && !/dup-name/.test(file)) err(file, "姓名重复");
  const polarities = new Set(experts.filter((e) => e.role === "expert").map((e) => e.polarity));
  if (polarities.size < 3 && !/same-stance|boundary-3/.test(file)) {
    err(file, `专家极性只有 ${polarities.size} 种（契约要求 >=3）`);
  }
}

function validateDecisionContent(file, doc, stepIndex, text) {
  const parsed = parseJson(text, file);
  if (!parsed.ok) {
    if (!/invalid/.test(file)) err(file, `steps[${stepIndex}] decision 内容不是合法 JSON`);
    return;
  }
  const d = parsed.value;
  for (const f of ["speakerId", "intent", "turnFocus", "messageId"]) {
    if (typeof d?.[f] !== "string" || d[f].length === 0) err(file, `steps[${stepIndex}] 缺字段 ${f}`);
  }
  if (typeof d?.speakerId === "string" && !/^e_(host|0[1-9])$/.test(d.speakerId)) {
    if (!/invalid-speaker/.test(file)) err(file, `speakerId 形态可疑：${d.speakerId}`);
  }
  if (typeof d?.intent === "string" && !INTENTS.has(d.intent)) {
    if (!/invalid-intent/.test(file)) err(file, `intent 非法：${d.intent}`);
  }
  if (d?.references !== undefined && !Array.isArray(d.references)) err(file, "references 必须是数组");
}

function validateConsensusContent(file, doc, stepIndex, text) {
  const parsed = parseJson(text, file);
  if (!parsed.ok) {
    err(file, `steps[${stepIndex}] consensus 内容不是合法 JSON`);
    return;
  }
  const insights = parsed.value?.insights;
  if (!Array.isArray(insights)) {
    err(file, `steps[${stepIndex}] 缺少 insights[]`);
    return;
  }
  insights.forEach((it, i) => {
    if (!["consensus", "divergence", "open_question"].includes(it.type)) {
      err(file, `insights[${i}] type 非法：${it.type}`);
    }
    if (typeof it.id !== "string" || !it.id) err(file, `insights[${i}] 缺 id`);
    if (typeof it.content !== "string" || !it.content) err(file, `insights[${i}] 缺 content`);
    if (typeof it.firstSeenTurn !== "number") err(file, `insights[${i}] 缺 firstSeenTurn（06 §1.7）`);
    if (it.status !== undefined) err(file, `insights[${i}] 出现已删除的 status 字段（06 §1.7）`);
    const ev = it.evidenceMessageIds;
    if (!Array.isArray(ev)) {
      err(file, `insights[${i}] 缺 evidenceMessageIds`);
      return;
    }
    if (it.type !== "open_question" && ev.length === 0 && !/unsupported/.test(file)) {
      err(file, `insights[${i}] ${it.type} 无依据（AR-07 要求 >=1）`);
    }
  });
}

function validateSummaryContent(file, doc, stepIndex, text) {
  if (text === "" && /empty/.test(file)) return; // 空总结是 06 §1.4 允许的降级
  let parsed;
  try {
    parsed = { ok: true, value: JSON.parse(text) };
  } catch (e) {
    if (!/json-leak|empty/.test(file)) err(file, `steps[${stepIndex}] summary 内容不是合法 JSON：${e.message}`);
    return;
  }
  const s = parsed.value;
  if (typeof s?.content !== "string") {
    // json-leak 负例故意给"别的结构"，用于验证前端不原样展示
    if (!/json-leak/.test(file)) err(file, `steps[${stepIndex}] 缺 summary.content`);
    return;
  }
  if (typeof s.isFallback !== "boolean") err(file, `steps[${stepIndex}] 缺 summary.isFallback（06 §1.4）`);
  if (s.content.length > 0 && s.content.length < 20 && !/json-leak/.test(file)) {
    warn(file, "summary 过短，难以覆盖共识/分歧/未决");
  }
  if (/"(consensus|divergence|evidenceMessageIds)"\s*:/.test(s.content) && !/json-leak/.test(file)) {
    err(file, "summary.content 里出现 JSON 字段名（AR-08 禁止）");
  }
}

function validateSpeechContent(file, doc, stepIndex, text) {
  if (text.trim() === "") return; // empty 负例
  if (CODE_POINTS(text) > MAX_CHARS) {
    if (!/long/.test(file)) err(file, `speech 超过 ${MAX_CHARS} 码点（${CODE_POINTS(text)}）`);
  }
  if (/"(consensus|intent)"\s*:/.test(text)) warn(file, "speech 里出现 JSON 字段名");
}

/* ------------------------------------------------------------------ */
/* topics / events                                                     */
/* ------------------------------------------------------------------ */

function validateTopics(file, doc) {
  if (doc.$schema !== "qa/topics@1") err(file, `$schema 应为 qa/topics@1`);
  const topics = doc.topics;
  if (!Array.isArray(topics) || topics.length < 5) {
    err(file, `议题数 ${topics?.length ?? 0} < 5（QA-PLAN §6.3 要求 >=5）`);
    return;
  }
  const ids = new Set();
  for (const t of topics) {
    const need = (c, m) => c || err(file, m);
    need(typeof t.id === "string" && t.id.length > 0, "topic 缺 id");
    if (ids.has(t.id)) err(file, `topic id 重复：${t.id}`);
    ids.add(t.id);
    need(typeof t.topic === "string" && CODE_POINTS(t.topic) >= 2 && CODE_POINTS(t.topic) <= 200,
      `topic 长度越界：${t.topic}`);
    need(Number.isInteger(t.expertCount) && t.expertCount >= 3 && t.expertCount <= 6,
      `expertCount 越界：${t.expertCount}`);
    const planned = Math.min(12, Math.max(8, 4 + 2 * t.expertCount));
    const max = Math.min(14, planned + 2);
    if (t.plannedTurns !== planned) err(file, `${t.id} plannedTurns=${t.plannedTurns} 应为 ${planned}`);
    if (t.maxTurns !== max) err(file, `${t.id} maxTurns=${t.maxTurns} 应为 ${max}`);
    need(typeof t.marker === "string" && t.marker.length >= 2, `${t.id} 缺 marker（串线检测用）`);
    need(typeof t.rosterFixture === "string" && t.rosterFixture.startsWith("llm/roster/"),
      `${t.id} rosterFixture 路径不合法`);
  }
}

function validateEvents(file, doc) {
  if (doc.$schema !== "qa/events@1") err(file, "events $schema 应为 qa/events@1");
  const events = doc.events;
  if (!Array.isArray(events) || events.length === 0) {
    err(file, "events 为空");
    return;
  }
  const seqs = events.map((e) => e.seq);
  // `with-*` 是"故意损坏"的变体（丢帧/重复投递），用于验证前端的补拉与去重，
  // 因此它们违反不变式是设计意图：降级为 warning，主线 fixture 仍严格校验。
  const isCorruptedVariant = /^with-/.test(path.basename(file));
  const bad = (msg) => (isCorruptedVariant ? warn(file, msg) : err(file, msg));
  for (let i = 1; i < seqs.length; i += 1) {
    if (seqs[i] === seqs[i - 1]) continue; // 重复投递变体
    if (seqs[i] !== seqs[i - 1] + 1) {
      bad(`seq 不连续：${seqs[i - 1]} → ${seqs[i]}`);
      break;
    }
  }
  if (new Set(seqs).size !== seqs.length && !/dup-delivery/.test(file)) {
    err(file, "seq 重复但文件名未标 dup-delivery");
  }
  for (const e of events) {
    for (const f of ["id", "seq", "type", "payload", "createdAt"]) {
      if (e[f] === undefined) err(file, `事件 seq=${e.seq} 缺字段 ${f}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(e.createdAt ?? "")) err(file, `seq=${e.seq} createdAt 不是 ISO 8601`);
  }
  const starts = events.filter((e) => e.type === "turn.started").length;
  const terminals = events.filter((e) => ["message.completed", "turn.aborted"].includes(e.type)).length;
  if (starts !== terminals) bad(`turn.started(${starts}) 与终态(${terminals}) 不等（06 §1.3 硬约束）`);
  const ended = events.filter((e) => e.type === "discussion.ended").length;
  if (ended !== 1) err(file, `discussion.ended 应恰为 1 个，实际 ${ended}`);
  if (events[events.length - 1]?.type !== "discussion.ended") err(file, "最后一个事件必须是 discussion.ended");
  const lastThree = events.slice(-3).map((e) => e.type).join(",");
  if (!lastThree.endsWith("discussion.summarizing,summary.completed,discussion.ended")) {
    err(file, `收尾顺序应为 summarizing→summary→ended，实际 ${lastThree}`);
  }
  // 每条 message.completed 的 message.id 必须被至少一次 turn.started 预分配
  const allocated = new Set(
    events.filter((e) => e.type === "turn.started").map((e) => e.payload?.messageId).filter(Boolean),
  );
  for (const e of events.filter((x) => x.type === "message.completed")) {
    const mid = e.payload?.message?.id;
    if (!allocated.has(mid)) bad(`message.completed 的 ${mid} 未在 turn.started 预分配（06 §1.6）`);
  }
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const files = await walk(FIX);
stats.files = files.length;
const docs = new Map();

for (const file of files) {
  const rel = path.relative(FIX, file).replace(/\\/g, "/");
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    err(rel, `读取失败：${e.message}`);
    continue;
  }
  if (text.charCodeAt(0) === 0xfeff) warn(rel, "文件带 BOM，某些解析器会失败");
  const parsed = parseJson(text, rel);
  if (!parsed.ok) continue;
  docs.set(rel, parsed.value);
  const schema = parsed.value?.$schema ?? "unknown";
  stats.bySchema[schema] = (stats.bySchema[schema] ?? 0) + 1;
}

for (const [rel, doc] of docs) {
  if (doc.$schema === "qa/topics@1") {
    validateTopics(rel, doc);
  } else if (doc.$schema === "qa/events@1") {
    validateEvents(rel, doc);
  } else if (doc.$schema === "qa/mixed-plan@1") {
    if (!Array.isArray(doc.timeline) || doc.timeline.length < 3) err(rel, "mixed 计划 timeline 太短");
    if (!Array.isArray(doc.assertions) || doc.assertions.length < 3) err(rel, "mixed 计划 assertions 太少");
    for (const item of doc.timeline ?? []) {
      if (!KINDS.has(item.kind)) err(rel, `timeline kind 非法：${item.kind}`);
      if (typeof item.fixture !== "string") err(rel, "timeline 缺 fixture 引用");
    }
  } else if (doc.$schema === "qa/llm-fixture@1") {
    stats.byKind[doc.kind] = (stats.byKind[doc.kind] ?? 0) + 1;
    validateLlmFixture(rel, doc);
    for (let i = 0; i < (doc.steps?.length ?? 0); i += 1) {
      const content = doc.steps[i].content;
      if (doc.kind === "roster") validateRosterContent(rel, doc, i, content);
      else if (doc.kind === "decision") validateDecisionContent(rel, doc, i, content);
      else if (doc.kind === "speech") validateSpeechContent(rel, doc, i, content);
      else if (doc.kind === "consensus") validateConsensusContent(rel, doc, i, content);
      else if (doc.kind === "summary") validateSummaryContent(rel, doc, i, content);
    }
  } else {
    err(rel, `未知 $schema：${doc.$schema}`);
  }
}

// 交叉校验：topics 引用的 roster 必须存在，且人数一致
const topicsDoc = docs.get("topics.json");
if (topicsDoc) {
  for (const t of topicsDoc.topics ?? []) {
    const target = docs.get(t.rosterFixture);
    if (!target) {
      err("topics.json", `${t.id} 引用的 ${t.rosterFixture} 不存在`);
      continue;
    }
    const first = target.steps?.[0]?.content ?? "";
    try {
      const n = JSON.parse(first).experts.length;
      if (n !== t.expertCount + 1) err("topics.json", `${t.id} roster 人数 ${n} != 1+${t.expertCount}`);
    } catch {
      err("topics.json", `${t.id} 的 roster 内容无法解析`);
    }
  }
}

// 场景覆盖：9 种 scenario 至少各出现一次（normal 由各 kind 共享；mixed 由 mixed-plan 覆盖）
const seenScenarios = new Set(
  [...docs.values()].filter((d) => d.$schema === "qa/llm-fixture@1").map((d) => d.scenario),
);
if ([...docs.values()].some((d) => d.$schema === "qa/mixed-plan@1")) seenScenarios.add("mixed");
for (const s of SCENARIOS) {
  if (!seenScenarios.has(s)) warn("(coverage)", `scenario "${s}" 没有任何 fixture 覆盖`);
}
// 每个 kind 至少一个非负例
for (const kind of KINDS) {
  const hasOk = [...docs.values()].some(
    (d) => d.$schema === "qa/llm-fixture@1" && d.kind === kind && d.negative === false,
  );
  if (!hasOk) err("(coverage)", `kind "${kind}" 没有正常（非负例）fixture`);
}

const report = {
  checkedAt: new Date().toISOString(),
  files: stats.files,
  bySchema: stats.bySchema,
  byKind: stats.byKind,
  scenarios: [...seenScenarios].sort(),
  errors,
  warnings: warns,
  ok: errors.length === 0,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`fixtures 校验：${stats.files} 个文件`);
  console.log(`  按 schema：${Object.entries(stats.bySchema).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`  按 kind：${Object.entries(stats.byKind).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`  场景覆盖：${[...seenScenarios].sort().join(", ")}`);
  if (warns.length > 0) {
    console.log(`\n警告 ${warns.length} 条：`);
    for (const w of warns) console.log(`  ! ${w.file}: ${w.msg}`);
  }
  if (errors.length > 0) {
    console.log(`\n错误 ${errors.length} 条：`);
    for (const e of errors) console.log(`  x ${e.file}: ${e.msg}`);
    console.log("\n结论：FAIL");
  } else {
    console.log("\n结论：PASS");
  }
}

process.exit(errors.length === 0 ? 0 : 1);
