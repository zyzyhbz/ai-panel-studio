#!/usr/bin/env node
/**
 * 页面诊断工具：打开一个路由，打印 testid 清单、关键区块文本与 console 错误。
 *
 * 用途：E2E 失败时快速判断"是选择器错、是页面没渲染、还是后端没数据"，
 * 比反复加 console.log 再跑整套用例快得多。
 *
 * 用法：
 *   .\scripts\pnpm.ps1 exec node e2e/tools/inspect-page.mjs /d/<id>
 *   .\scripts\pnpm.ps1 exec node e2e/tools/inspect-page.mjs / --wait=2000
 */

import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const route = args.find((a) => !a.startsWith("--")) ?? "/";
const waitArg = args.find((a) => a.startsWith("--wait="));
const waitMs = waitArg ? Number(waitArg.split("=")[1]) : 1500;
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const res = await page.goto(new URL(route, base).toString(), { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitMs);

const info = await page.evaluate(() => {
  const ids = Array.from(document.querySelectorAll("[data-testid]")).map(
    (el) => el.getAttribute("data-testid") ?? "",
  );
  const counts = {};
  for (const id of ids) {
    const key = id.replace(/-[0-9a-f-]{8,}$/i, "-<id>").replace(/-\d+$/, "-<n>");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const dataAttrs = {};
  for (const attr of ["data-status", "data-panel", "data-conn-state", "data-turn-count", "data-intent", "data-role"]) {
    dataAttrs[attr] = document.querySelectorAll(`[${attr}]`).length;
  }
  return {
    title: document.title,
    url: location.href,
    rootText: (document.querySelector("#root")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
    testidCounts: counts,
    dataAttrs,
    bodyScroll: {
      scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
      clientHeight: document.scrollingElement?.clientHeight ?? 0,
    },
  };
});

console.log(JSON.stringify({ status: res?.status() ?? null, ...info, errors }, null, 2));
await browser.close();
