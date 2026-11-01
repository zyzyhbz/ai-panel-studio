#!/usr/bin/env node
/**
 * 汇总 Playwright JSON 报告：只打印失败用例的标题 + 前几行错误，
 * 避免在控制台里翻几万行 JSON。
 *
 * 用法：
 *   .\scripts\pnpm.ps1 exec node e2e/tools/summarize-results.mjs
 *   .\scripts\pnpm.ps1 exec node e2e/tools/summarize-results.mjs --all
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const file =
  process.env.E2E_RESULTS ??
  path.join(process.env.E2E_ARTIFACTS_DIR ?? path.join(os.tmpdir(), "ai-panel-e2e"), "results.json");

const onlyFailures = !process.argv.includes("--all");
const report = JSON.parse(readFileSync(file, "utf8"));

const rows = [];
function walk(suite) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = (t.results ?? []).at(-1);
      if (!last) continue;
      const failed = ["failed", "timedOut", "interrupted"].includes(last.status);
      const skipped = last.status === "skipped";
      if (onlyFailures && !failed) continue;
      const skipNote = (last.annotations ?? [])
        .filter((a) => a.type === "skip")
        .map((a) => a.description ?? "")
        .join(" ");
      const msg = (last.errors ?? []).map((e) => e.message ?? "").join("\n");
      rows.push({
        title: spec.title,
        file: spec.file,
        status: failed ? "FAIL" : skipped ? "SKIP" : "PASS",
        msg: failed
          ? msg.split("\n").filter(Boolean).slice(0, 6).join("\n      ")
          : skipped
            ? skipNote || "（无 skip 原因）"
            : "",
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child);
}
// 只从根开始走一次：spec 已经挂在 suites 下面，重复走会重复统计
for (const s of report.suites ?? []) walk(s);

const st = report.stats ?? {};
console.log(`报告：${file}`);
console.log(`统计：expected=${st.expected ?? "?"} unexpected=${st.unexpected ?? "?"} skipped=${st.skipped ?? "?"} flaky=${st.flaky ?? "?"}`);
console.log("");

if (rows.length === 0) {
  console.log("没有失败用例。");
} else {
  for (const r of rows) {
    console.log(`[${r.status}] ${r.title}`);
    console.log(`      ${path.basename(r.file ?? "")}`);
    if (r.msg) console.log(`      ${r.msg}`);
    console.log("");
  }
}
