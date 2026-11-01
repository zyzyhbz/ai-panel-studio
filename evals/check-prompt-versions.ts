import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PROMPT_VERSIONS } from "../packages/agent/src/index.ts";

/**
 * Prompt 版本一致性检查：`PROMPT_VERSIONS` ↔ `docs/prompts/runtime/P-XXX.vX.Y.Z.md`。
 *
 * 跑法：`.\scripts\pnpm.ps1 exec tsx evals/check-prompt-versions.ts`
 * 退出码：0 = 一致；1 = 有缺失或版本号不匹配（交付前必须为 0）。
 *
 * 为什么需要它：Prompt 记录是交付物，代码改了版本号、文档没跟上，
 * 评阅时就是"实现与记录不一致"。这个脚本把这件事变成可机器检查的一条命令。
 */
const runtimeDir = join(import.meta.dirname, "..", "docs", "prompts", "runtime");
const files = new Set(readdirSync(runtimeDir).filter((name) => name.endsWith(".md")));

let failures = 0;
console.log("Prompt\t版本\t期望文件\t状态");
for (const [id, version] of Object.entries(PROMPT_VERSIONS)) {
  const expected = `${id}.v${version}.md`;
  const ok = files.has(expected);
  if (!ok) failures += 1;
  console.log(`${id}\t${version}\t${expected}\t${ok ? "OK" : "MISSING"}`);
}

// 反向检查：runtime 下每个 P-*.md 都应该有对应的版本常量
const known = new Set(
  Object.entries(PROMPT_VERSIONS).map(([id, version]) => `${id}.v${version}.md`),
);
for (const file of files) {
  if (!file.startsWith("P-")) continue;
  if (!known.has(file)) {
    failures += 1;
    console.log(`[orphan]\t${file}\t该文件没有对应的 PROMPT_VERSIONS 版本`);
  }
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 处不一致`);
  process.exit(1);
}
console.log("\n✅ 五份 prompt 的版本号与 runtime 文档一致");
