import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { probeBackend } from "./helpers/capabilities";
import { env } from "./helpers/env";

/**
 * 全局准备：
 * 1. 探测后端能力（不探测 UI——globalSetup 里没有 page）；
 * 2. 把能力矩阵写进 .artifacts/capabilities.json，报告与缺陷单直接引用；
 * 3. E2E_STRICT=1 且应用不可达时立刻失败，避免"全 skip 的绿色"。
 */
export default async function globalSetup(): Promise<void> {
  await mkdir(env.artifactsDir, { recursive: true });
  const backend = await probeBackend(true);

  const file = path.join(env.artifactsDir, "capabilities.json");
  await writeFile(
    file,
    JSON.stringify({ runId: env.runId, strict: env.strict, baseURL: env.baseURL, apiURL: env.apiURL, backend }, null, 2),
    "utf8",
  );

  const status = backend.reachable ? "OK" : "DOWN";
  console.log(
    `[qa] run=${env.runId} strict=${env.strict ? "on" : "off"} api=${env.apiURL} (${status}) web=${env.baseURL}`,
  );
  if (!backend.reachable) {
    console.log(`[qa] 后端不可达：${backend.error}`);
    console.log(`[qa] 启动方式：.\\scripts\\pnpm.ps1 dev   或   .\\scripts\\pnpm.ps1 --filter @ai-panel/server dev`);
  }

  if (env.strict && !backend.reachable) {
    throw new Error(
      `[E2E_STRICT] 后端不可达（${env.apiURL}）：${backend.error}。strict 模式下不允许"全 skip 的绿色"。`,
    );
  }
}
