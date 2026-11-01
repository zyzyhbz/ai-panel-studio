import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "apps/web/dist");

if (!existsSync(dist)) {
  console.log("[check:key] apps/web/dist not found; run pnpm build first.");
  process.exit(0);
}

const suspicious = /sk-[A-Za-z0-9]{24,}|DEEPSEEK_API_KEY|reasoning_content/;
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
}

walk(dist);

const hits = files.filter((file) => {
  if (!/\.(js|css|html|json|map)$/.test(file)) return false;
  return suspicious.test(readFileSync(file, "utf8"));
});

if (hits.length > 0) {
  console.error("[check:key] suspicious content found:");
  for (const hit of hits) console.error(`  - ${hit}`);
  process.exit(1);
}

console.log(`[check:key] scanned ${files.length} files; no key material found.`);
