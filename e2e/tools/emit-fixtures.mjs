#!/usr/bin/env node
/**
 * 生成 E2E fixture（JSON 落盘；测试只读 JSON，不在运行时生成）。
 *
 * 为什么用脚本生成：5 个议题 × (1 主持 + 3~6 专家) 涉及"颜色唯一 / 极性 >=3 类 /
 * 单条 <=120 码点 / messageId 引用一致"等约束，手写必错。生成器在写盘前断言，
 * 输出可读、可 diff，并由 e2e/tools/validate-fixtures.mjs 再校验一遍。
 *
 * 运行：.\scripts\pnpm.ps1 exec node e2e/tools/emit-fixtures.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FIX = path.join(path.resolve(import.meta.dirname, ".."), "fixtures");
const CLOCK = Date.parse("2026-11-01T10:00:00.000Z");
const HOST_COLOR = "#E5E7EB";
const MAX_CHARS = 120;
const SEMANTIC = ["#22c55e", "#ef4444", "#a855f7", "#e8b04b", "#10b981", "#f59e0b"];

const problems = [];
const check = (cond, msg) => !cond && problems.push(msg);
const cps = (t) => [...t].length;
const iso = (s) => new Date(CLOCK + s * 1000).toISOString();
const json = (v) => JSON.stringify(v);

/* ------------------------------------------------------------------ */
/* 议题（>=5 个，每个带独特词用于串线检测）                             */
/* ------------------------------------------------------------------ */

const TOPICS = [
  {
    id: "ai-junior-dev", topic: "AI 会不会让初级开发者失业？", marker: "初级开发者",
    axis: "岗位替代 vs 岗位重构", host: ["林致远", "科技主持人", "资深圆桌主持"],
    experts: [
      ["周明", "软件工程师", "技术负责人", "AI 会重构初级岗位，而不是简单消灭", "oppose", "#3E6FD9", "工程实践与岗位结构"],
      ["许澜", "组织心理学研究者", "副教授", "岗位会被重组，但入行门槛会明显抬高", "neutral", "#2F8F8A", "组织行为与新人成长"],
      ["陈默", "劳动经济学家", "研究员", "AI 先替代任务，再压缩初级岗位数量", "support", "#C2673F", "就业结构与技能溢价"],
      ["苏芮", "创业公司 CTO", "技术合伙人", "两年内初级招聘会明显收缩", "strong_support", "#7A8CA8", "团队成本与招聘节奏"],
    ],
  },
  {
    id: "remote-default", topic: "远程办公应该成为默认工作制吗？", marker: "远程办公",
    axis: "默认远程 vs 默认办公", host: ["何嘉", "商业访谈主持", "制片人"],
    experts: [
      ["沈聿", "分布式团队顾问", "首席顾问", "远程应该是默认选项，办公室是补充", "strong_support", "#3E6FD9", "异步协作与团队节奏"],
      ["罗晴", "人力资源负责人", "人力资源总监", "混合制才是可持续解", "neutral", "#2F8F8A", "用工制度与管理成本"],
      ["韩冬", "房地产分析师", "研究主管", "默认远程会削弱中心城区的协作密度", "oppose", "#C2673F", "办公空间与城市密度"],
      ["白露", "独立设计师", "自由职业者", "远程让协作更贵而不是更便宜", "strong_oppose", "#7A8CA8", "创意协作的隐性成本"],
    ],
  },
  {
    id: "college-major", topic: "读大学选专业还要不要看就业率？", marker: "选专业",
    axis: "就业率导向 vs 产业趋势导向", host: ["顾清", "教育观察主持", "主笔"],
    experts: [
      ["田野", "高校招生办主任", "副研究员", "就业率是滞后指标，但不能不看", "neutral", "#3E6FD9", "招生数据与专业调整"],
      ["易安", "职业规划师", "合伙人", "就业率是普通家庭最现实的风险对冲", "support", "#2F8F8A", "家庭决策与风险偏好"],
      ["郑铎", "产业研究员", "高级分析师", "看就业率不如看产业迁移方向", "oppose", "#C2673F", "产业周期与人才缺口"],
    ],
  },
  {
    id: "city-subsidy", topic: "二线城市靠补贴抢人，能留住人吗？", marker: "二线城市",
    axis: "补贴留人 vs 产业留人", host: ["邵川", "城市观察主持", "主编"],
    experts: [
      ["冯楠", "区域经济学者", "教授", "补贴只能改变短期选择，留人靠产业", "oppose", "#3E6FD9", "区域经济与人口流动"],
      ["于澈", "地方政府招商干部", "副局长", "补贴是启动器，配套才是留存器", "neutral", "#2F8F8A", "招商政策与落地配套"],
      ["蒋禾", "猎头顾问", "城市负责人", "人才跟着岗位走，补贴只是补贴", "oppose", "#C2673F", "岗位供给与薪酬结构"],
      ["温言", "落户青年", "产品经理", "补贴确实让我多留了两年", "support", "#7A8CA8", "个体选择与生活成本"],
      ["段铭", "产业园运营方", "总经理", "没有产业配套的补贴就是一次性红包", "strong_oppose", "#9A6E4F", "园区运营与企业留存"],
    ],
  },
  {
    id: "oss-pricing", topic: "开源作者该不该向商业公司收费？", marker: "开源作者",
    axis: "商业使用应付费 vs 许可证即边界", host: ["岑野", "技术社区主持", "主理人"],
    experts: [
      ["谢临", "开源项目维护者", "核心作者", "商业使用应当付费，否则维护不可持续", "strong_support", "#3E6FD9", "维护成本与项目可持续"],
      ["孟舟", "律所合伙人", "知识产权律师", "许可证已经是收费工具，不必另起炉灶", "oppose", "#2F8F8A", "许可证边界与法律风险"],
      ["江砚", "云厂商开源负责人", "总监", "付费应该买服务，不是买许可", "neutral", "#C2673F", "云服务与商业模型"],
      ["童桦", "独立开发者", "全栈工程师", "小作者收不到钱，大公司也不会付", "oppose", "#7A8CA8", "个体作者的现实处境"],
      ["柏川", "基金会理事", "执行董事", "基金会模式比逐笔收费更可行", "support", "#9A6E4F", "治理结构与资金机制"],
      ["商屿", "企业采购负责人", "技术总监", "付费可以，但要写清 SLA", "neutral", "#5C7CFA", "采购合规与服务保障"],
    ],
  },
];

/**
 * 轮次口径（docs/09 §5 + 2026-11-01 用户纠正：结束由观点/争点决定，轮数只是保底）：
 *   coverageFloor（接口字段仍叫 plannedTurns）= min(12, max(8, 2n + 2))
 *     → 3 人: 8 / 4 人: 10 / 5 人: 12 / 6 人: 12
 *   maxTurns（硬上限）= 36
 * 24–36 是"讨论深度目标"，不是必须跑满的计划轮次。
 */
const plannedTurnsFor = (n) => Math.min(12, Math.max(8, 2 * Math.min(6, Math.max(3, n)) + 2));
const maxTurnsFor = () => 36;

function buildRoster(t) {
  const [hn, hp, ht] = t.host;
  const host = {
    id: "e_host", role: "host", name: hn, profession: hp, title: ht,
    stance: "中立，负责开场、追问、串联与收尾", stanceAxis: t.axis, polarity: "neutral",
    color: HOST_COLOR, focusArea: "节奏与议题边界", sortOrder: 0,
  };
  const experts = t.experts.map((e, i) => ({
    id: `e_0${i + 1}`, role: "expert", name: e[0], profession: e[1], title: e[2],
    stance: e[3], stanceAxis: t.axis, polarity: e[4], color: e[5], focusArea: e[6], sortOrder: i + 1,
  }));
  return [host, ...experts];
}

function validateRoster(t, experts) {
  const colors = experts.map((e) => e.color.toLowerCase());
  check(new Set(colors).size === colors.length, `${t.id}: 颜色不唯一`);
  check(experts.length === t.experts.length + 1, `${t.id}: 人数应为 1+${t.experts.length}`);
  check(experts.filter((e) => e.role === "host").length === 1, `${t.id}: host 必须恰为 1`);
  const pol = new Set(experts.filter((e) => e.role === "expert").map((e) => e.polarity));
  check(pol.size >= 3, `${t.id}: 极性只有 ${pol.size} 种（需 >=3）`);
  check(new Set(experts.map((e) => e.name)).size === experts.length, `${t.id}: 姓名重复`);
  for (const c of colors) check(!SEMANTIC.includes(c), `${t.id}: 专家色 ${c} 撞语义色`);
}

/* ------------------------------------------------------------------ */
/* 发言序列：非轮转 / 无 3 连 / host 参与                                */
/* ------------------------------------------------------------------ */

function buildTurnPlan(expertCount, count) {
  const plan = [];
  const recent = [];
  const tailIsHostTwice = () => plan.length >= 2 && plan.at(-1).speaker === "e_host" && plan.at(-2).speaker === "e_host";
  for (let turn = 1; turn <= count; turn += 1) {
    if (turn === 1) { plan.push({ speaker: "e_host", intent: "opening" }); continue; }
    if (turn === count) { plan.push({ speaker: "e_host", intent: "summary" }); continue; }
    // 主持人插入位：turn%4 或收束前一轮；但绝不允许 host 连续 3 次
    // （小轮次时 turn%4 与 count-1 会相邻，必须让位给专家，否则收尾就成 3 连）
    const prevIsHost = plan.at(-1)?.speaker === "e_host";
    const hostSlot =
      (turn % 4 === 0 && !tailIsHostTwice()) ||
      (turn === count - 1 && !prevIsHost && !tailIsHostTwice());
    if (hostSlot) {
      const intents = ["probe", "mediate", "redirect"];
      plan.push({ speaker: "e_host", intent: intents[Math.floor(turn / 4) % 3] });
      continue;
    }
    let idx = (turn * 3 + Math.floor(turn / 2)) % expertCount;
    for (let g = 0; g < expertCount * 2; g += 1) {
      const id = `e_0${idx + 1}`;
      const tail = recent.slice(-2);
      if (tail.length < 2 || !(tail[0] === id && tail[1] === id)) break;
      idx = (idx + 1) % expertCount;
    }
    const id = `e_0${idx + 1}`;
    const intents = ["rebut", "extend", "support", "clarify"];
    plan.push({ speaker: id, intent: intents[turn % intents.length] });
    recent.push(id);
  }
  return plan;
}

function checkPlan(name, plan, expertCount) {
  for (let i = 2; i < plan.length; i += 1) {
    const [a, b, c] = [plan[i - 2].speaker, plan[i - 1].speaker, plan[i].speaker];
    check(!(a === b && b === c), `${name}: 第 ${i + 1} 位出现同 speaker 连续 3 次（${a}）`);
  }
  const seq = plan.filter((p) => p.speaker !== "e_host").map((p) => p.speaker);
  const rot = Array.from({ length: Math.min(6, expertCount) }, (_, i) => `e_0${i + 1}`);
  for (let i = 0; i + rot.length <= seq.length; i += 1) {
    check(!rot.every((id, k) => seq[i + k] === id), `${name}: 出现整段 sortOrder 轮转`);
  }
}

const SPEECH_BANK = [
  "我不太同意把问题简化成替代。真正发生的是任务被拆开，人还在，但岗位定义变了。",
  "补一个角度：企业愿不愿意为再培训买单，决定了岗位是升级还是压缩。",
  "这件事短期看成本，长期看的是组织能力能不能跟上。",
  "我同意一半。方向没错，但把责任全推给个人，忽略了过去三年的招聘结构变化。",
  "数据上更微妙：招聘量下降和岗位消失不是一回事，前者会先出现。",
  "如果只看大公司样本，结论会系统性偏乐观，中小企业才是多数。",
  "我更关心边界条件：什么情况下这个判断会失效？",
];
const speechFor = (turn) => SPEECH_BANK[turn % SPEECH_BANK.length].slice(0, MAX_CHARS);

/* ------------------------------------------------------------------ */

async function emit(rel, data) {
  const full = path.join(FIX, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(data, null, 2) + "\n", "utf8");
}

const fixture = (o) => ({
  $schema: "qa/llm-fixture@1",
  negative: false,
  expectNotes: [],
  onExhausted: "last",
  ...o,
});
const step = (content, extra = {}) => ({ content, ...extra });

async function main() {
  await emit("topics.json", {
    $schema: "qa/topics@1",
    topics: TOPICS.map((t) => ({
      id: t.id, topic: t.topic, expertCount: t.experts.length,
      plannedTurns: plannedTurnsFor(t.experts.length), maxTurns: maxTurnsFor(t.experts.length),
      rosterFixture: `llm/roster/${t.id}.json`, marker: t.marker,
    })),
  });

  /* ---- 正常 roster ---- */
  const rosters = new Map();
  for (const t of TOPICS) {
    const experts = buildRoster(t);
    validateRoster(t, experts);
    rosters.set(t.id, experts);
    await emit(`llm/roster/${t.id}.json`, fixture({
      name: `roster/${t.id}`, kind: "roster", scenario: "normal",
      description: `议题「${t.topic}」：1 主持 + ${t.experts.length} 专家`,
      expectOutcome: "ok",
      expectNotes: ["颜色唯一", "极性 >=3 类", "姓名不重复", `共 ${t.experts.length + 1} 人`],
      steps: [step(json({ experts }))],
    }));
  }

  /* ---- 人数边界 ---- */
  for (const n of [3, 6]) {
    const t = TOPICS[n === 3 ? 2 : 4];
    const base = buildRoster(t);
    const experts = [base[0], ...base.slice(1, n + 1)];
    await emit(`llm/roster/boundary-${n}.json`, fixture({
      name: `roster/boundary-${n}`, kind: "roster", scenario: "normal",
      description: `专家人数边界 ${n}（共 ${n + 1} 人）`, expectOutcome: "ok",
      expectNotes: [`共 ${n + 1} 人`, "颜色唯一", "极性 >=3 类"],
      steps: [step(json({ experts }))],
    }));
  }

  /* ---- roster 负例 ---- */
  const t1 = TOPICS[0];
  const ok = rosters.get(t1.id);
  const dupColor = structuredClone(ok); dupColor[2].color = dupColor[1].color;
  const dupName = structuredClone(ok); dupName[2].name = dupName[1].name;
  const sameStance = structuredClone(ok).map((e, i) =>
    i === 0 ? e : { ...e, stance: "AI 会让初级开发者失业", polarity: "support" });

  const rosterNegatives = [
    ["invalid-dup-color", "两位专家同色，必须被守卫拒绝", dupColor],
    ["invalid-dup-name", "两位专家同名，必须被拒绝", dupName],
    ["invalid-same-stance", "全部专家同一立场，违反 >=3 类极性", sameStance],
  ];
  for (const [name, desc, bad] of rosterNegatives) {
    await emit(`llm/roster/${name}.json`, fixture({
      name: `roster/${name}`, kind: "roster", scenario: "invalid-json", negative: true,
      description: desc, expectOutcome: "retry_then_ok",
      expectNotes: ["第一次输出必须被拒绝", "重试后成功，不得原样落库"],
      steps: [step(json({ experts: bad })), step(json({ experts: ok }))],
    }));
  }
  await emit("llm/roster/invalid-json-truncated.json", fixture({
    name: "roster/invalid-json-truncated", kind: "roster", scenario: "invalid-json", negative: true,
    description: "缺右括号的 JSON", expectOutcome: "retry_then_ok",
    expectNotes: ["一次修复重试", "两次都坏 → 502 ROSTER_GENERATION_FAILED + details.discussionId"],
    steps: [step('{"experts":[{"id":"e_host","role":"host","name":"林致远"'), step(json({ experts: ok }))],
  }));
  await emit("llm/roster/empty.json", fixture({
    name: "roster/empty", kind: "roster", scenario: "empty", negative: true,
    description: "空输出 / 纯空白（官方文档提到的空白返回）", expectOutcome: "retry_then_ok",
    expectNotes: ["空内容重试一次", "仍空则 502 且保留 failed 讨论"],
    steps: [step(""), step("   "), step(json({ experts: ok }))],
  }));
  await emit("llm/roster/timeout.json", fixture({
    name: "roster/timeout", kind: "roster", scenario: "timeout", negative: true,
    description: "首次调用 hang，第二次正常", expectOutcome: "retry_then_ok",
    expectNotes: ["LLM_TIMEOUT 504", "details 带 discussionId/topic/status"],
    steps: [step("", { timing: { hang: true } }), step(json({ experts: ok }))],
  }));

  /* ---- decision ---- */
  const mainPlan = buildTurnPlan(t1.experts.length, plannedTurnsFor(t1.experts.length));
  checkPlan("decision/normal", mainPlan, t1.experts.length);
  await emit("llm/decision/normal.json", fixture({
    name: "decision/normal", kind: "decision", scenario: "normal",
    description: "12 轮非轮转调度：开场 → 专家抢答/反驳 → 主持追问/串联 → 总结",
    expectOutcome: "ok",
    expectNotes: ["同一 speaker 不连续 3 次", "不等于 sortOrder 轮转", "host 占比约 1/3", "含 references/targetMessageId"],
    steps: mainPlan.map((p, i) => {
      const turn = i + 1;
      const ex = ok.find((e) => e.id === p.speaker);
      return step(json({
        speakerId: p.speaker, intent: p.intent,
        turnFocus: `${ex.focusArea}·第${turn}轮`,
        messageId: `m_${String(turn).padStart(2, "0")}`,
        targetMessageId: turn > 2 ? `m_${String(turn - 1).padStart(2, "0")}` : undefined,
        references: ["mediate", "redirect"].includes(p.intent)
          ? [`m_${String(turn - 2).padStart(2, "0")}`, `m_${String(turn - 1).padStart(2, "0")}`] : undefined,
      }), { meta: { model: "deepseek-flash", thinking: "disabled" } });
    }),
  }));

  const decisionNegatives = {
    "round-robin": {
      desc: "固定轮转 1>2>3>4>1>2>3>4（负例）", scenario: "normal", outcome: "abort_turn",
      notes: ["调度守卫应重选 speaker", "不得原样进入 transcript"],
      steps: Array.from({ length: 8 }, (_, i) => step(json({
        speakerId: `e_0${(i % 4) + 1}`, intent: "rebut", turnFocus: "轮转",
        messageId: `m_${String(i + 2).padStart(2, "0")}`,
      }))),
    },
    "same-speaker-x3": {
      desc: "同一专家连续 3 次（负例，违反 AR-03）", scenario: "normal", outcome: "abort_turn",
      notes: ["第 3 次必须被守卫拒绝并换人"],
      steps: [1, 2, 3].map((i) => step(json({ speakerId: "e_01", intent: "extend", turnFocus: "垄断发言", messageId: `m_0${i}` }))),
    },
    "invalid-speaker": {
      desc: "返回不存在的 expertId", scenario: "invalid-json", outcome: "abort_turn",
      notes: ["丢弃并重选，不得崩溃"],
      steps: [
        step(json({ speakerId: "e_99", intent: "rebut", turnFocus: "幽灵专家", messageId: "m_02" })),
        step(json({ speakerId: "e_01", intent: "rebut", turnFocus: "重选成功", messageId: "m_02" })),
      ],
    },
    "invalid-intent": {
      desc: "intent 不在 9 种枚举内", scenario: "invalid-json", outcome: "abort_turn",
      notes: ["Zod 校验失败 → 兜底 intent"],
      steps: [
        step(json({ speakerId: "e_01", intent: "abc", turnFocus: "非法意图", messageId: "m_02" })),
        step(json({ speakerId: "e_01", intent: "extend", turnFocus: "兜底", messageId: "m_02" })),
      ],
    },
    runaway: {
      desc: "永不收束：40 步都不给 summary，测 maxTurns=36 硬上限", scenario: "runaway",
      outcome: "degraded", onExhausted: "loop",
      notes: ["到 maxTurns=36 自动进入 summarizing", "turnCount 不得 >36"],
      steps: Array.from({ length: 40 }, (_, i) => step(json({
        speakerId: `e_0${(i % 4) + 1}`, intent: "extend", turnFocus: `第 ${i + 1} 次跑题`,
        messageId: `m_${String(i + 2).padStart(3, "0")}`,
      }))),
    },
  };
  for (const [name, cfg] of Object.entries(decisionNegatives)) {
    await emit(`llm/decision/${name}.json`, fixture({
      name: `decision/${name}`, kind: "decision", scenario: cfg.scenario, negative: true,
      description: cfg.desc, expectOutcome: cfg.outcome,
      expectNotes: cfg.notes, onExhausted: cfg.onExhausted ?? "last", steps: cfg.steps,
    }));
  }

  /* ---- speech ---- */
  const longText = "这是一个非常长的小作文式发言，".repeat(12);
  check(cps(longText) > MAX_CHARS, "speech/long 必须超过上限");
  await emit("llm/speech/normal.json", fixture({
    name: "speech/normal", kind: "speech", scenario: "normal",
    description: "每轮 1–2 句、<=120 码点", expectOutcome: "ok",
    expectNotes: ["charCount <=120", "句数 <=2"], onExhausted: "loop",
    steps: TOPICS.map((_, i) => step(speechFor(i))),
  }));
  await emit("llm/speech/long.json", fixture({
    name: "speech/long", kind: "speech", scenario: "long", negative: true,
    description: `约 ${cps(longText)} 码点的超长发言（上限 ${MAX_CHARS}）`, expectOutcome: "degraded",
    expectNotes: ["截断或重试到 <=120", "degraded=true"], steps: [step(longText)],
  }));
  await emit("llm/speech/empty.json", fixture({
    name: "speech/empty", kind: "speech", scenario: "empty", negative: true,
    description: "空串 / 纯空白 / 仅标点", expectOutcome: "abort_turn",
    expectNotes: ["不得产生 charCount=0 的消息", "turn.aborted reason=empty_output"],
    steps: [step(""), step("   "), step("。。。")],
  }));
  await emit("llm/speech/duplicate.json", fixture({
    name: "speech/duplicate", kind: "speech", scenario: "duplicate", negative: true,
    description: "连续 3 条完全相同内容", expectOutcome: "degraded",
    expectNotes: ["内容去重或换人", "不得出现 3 条相同文本"],
    steps: [step("AI 会替代初级岗位。"), step("AI 会替代初级岗位。"), step("AI 会替代初级岗位。")],
  }));
  await emit("llm/speech/slow.json", fixture({
    name: "speech/slow", kind: "speech", scenario: "slow",
    description: "首字 3s、delta 间隔 800ms", expectOutcome: "ok",
    expectNotes: ["首字前有准备态", "不白屏"], onExhausted: "loop",
    steps: [step("我需要先确认一个前提：讨论的是岗位数量，还是岗位内容？", {
      timing: { firstTokenDelayMs: 3000, interDeltaMs: 800 },
    })],
  }));

  /* ---- consensus ---- */
  const consensusNormal = {
    insights: [
      { id: "i_01", type: "consensus", content: "双方都认为初级岗位的职责会变化，而不是原样保留", evidenceMessageIds: ["m_02", "m_03"], firstSeenTurn: 3 },
      { id: "i_02", type: "divergence", content: "变化是升级还是压缩，存在分歧", evidenceMessageIds: ["m_03", "m_05"], firstSeenTurn: 5 },
      { id: "i_03", type: "open_question", content: "企业是否愿意为初级岗位再培训买单？", evidenceMessageIds: ["m_05"], firstSeenTurn: 5 },
    ],
  };
  await emit("llm/consensus/normal.json", fixture({
    name: "consensus/normal", kind: "consensus", scenario: "normal",
    description: "三类洞察，每条 >=1 条依据", expectOutcome: "ok",
    expectNotes: ["三区各 >=1", "evidenceMessageIds 非空且存在于本会话"],
    steps: [step(json(consensusNormal))],
  }));
  await emit("llm/consensus/unsupported.json", fixture({
    name: "consensus/unsupported", kind: "consensus", scenario: "duplicate", negative: true,
    description: "consensus 无 evidenceMessageIds（编造一致）", expectOutcome: "degraded",
    expectNotes: ["必须降级为 open_question 或丢弃", "不得进入共识区"],
    steps: [step(json({ insights: [{ id: "i_09", type: "consensus", content: "大家都认为 AI 没有影响", evidenceMessageIds: [], firstSeenTurn: 4 }] }))],
  }));
  await emit("llm/consensus/dup-stack.json", fixture({
    name: "consensus/dup-stack", kind: "consensus", scenario: "duplicate", negative: true,
    description: "同一结论重复 5 条（测不堆叠）", expectOutcome: "degraded",
    expectNotes: ["相同 content 去重后 <=1 条"],
    steps: [step(json({ insights: Array.from({ length: 5 }, (_, i) => ({
      id: `i_1${i}`, type: "consensus", content: "岗位会变化", evidenceMessageIds: ["m_02"], firstSeenTurn: 4,
    })) }))],
  }));
  await emit("llm/consensus/empty.json", fixture({
    name: "consensus/empty", kind: "consensus", scenario: "empty",
    description: "空数组（空态，不是错误）", expectOutcome: "ok",
    expectNotes: ["三区显示空态文案"], steps: [step(json({ insights: [] }))],
  }));

  /* ---- summary ---- */
  await emit("llm/summary/normal.json", fixture({
    name: "summary/normal", kind: "summary", scenario: "normal",
    description: "自然语言总结，覆盖共识/分歧/未决", expectOutcome: "ok",
    expectNotes: ["不含 JSON 字段名", "长度 >20"],
    steps: [step(json({
      content: "这场讨论的共识是：初级岗位的职责边界会变化，而不是原样保留。主要分歧在于变化是能力升级还是岗位压缩；尚未解决的是企业是否愿意为再培训买单，以及中小企业真实招聘会收缩到什么程度。",
      isFallback: false,
    }))],
  }));
  await emit("llm/summary/json-leak.json", fixture({
    name: "summary/json-leak", kind: "summary", scenario: "invalid-json", negative: true,
    description: "故意返回 JSON 原文，前端不得原样展示", expectOutcome: "degraded",
    expectNotes: ["UI 过 assertNoJsonLeak", "必要时 isFallback=true"],
    steps: [step(json({ consensus: "岗位会变化", divergence: "升级还是压缩", evidenceMessageIds: ["m_02", "m_03"] }))],
  }));
  await emit("llm/summary/empty.json", fixture({
    name: "summary/empty", kind: "summary", scenario: "empty", negative: true,
    description: "总结为空 → 允许 summary=null 的 ended（06 §1.4）", expectOutcome: "degraded",
    expectNotes: ["仍发 discussion.ended", "前端显示总结未生成"], steps: [step("")],
  }));

  /* ---- mixed 编排（不是 LlmFixture） ---- */
  await emit("llm/mixed/resilience.json", {
    $schema: "qa/mixed-plan@1",
    name: "mixed/resilience",
    description: "单场混合故障：仍须走到 ended，且有效发言 >=6 条",
    timeline: [
      { turn: 2, kind: "speech", fixture: "llm/speech/slow.json", expected: "正常但慢" },
      { turn: 3, kind: "speech", fixture: "llm/speech/empty.json", expected: "turn.aborted(empty_output)" },
      { turn: 4, kind: "decision", fixture: "llm/decision/invalid-speaker.json", expected: "重选 speaker" },
      { turn: 5, kind: "speech", fixture: "llm/speech/long.json", expected: "截断 + degraded" },
      { turn: 6, kind: "speech", fixture: "llm/speech/duplicate.json", expected: "去重" },
      { turn: 8, kind: "consensus", fixture: "llm/consensus/unsupported.json", expected: "降级为 open_question" },
      { turn: "end", kind: "summary", fixture: "llm/summary/normal.json", expected: "正常总结" },
    ],
    assertions: [
      "最终 status=ended",
      "message.completed 有效条数 >= 6",
      "每个 turn.started 都有 message.completed 或 turn.aborted",
      "summary 非空",
      "页面无未捕获异常",
    ],
  });

  /* ---- 事件序列 ---- */
  function buildEvents({ abortTurn = null, dropSeq = null, dupSeq = null } = {}) {
    const out = [];
    let seq = 1;
    const push = (type, payload, at) => {
      out.push({ id: `evt_${String(seq).padStart(2, "0")}`, seq, type, payload, createdAt: iso(at) });
      seq += 1;
    };
    push("roster.ready", { discussionId: "d_qa_main", experts: ok }, 1);
    push("discussion.started", { discussionId: "d_qa_main", startedAt: iso(2) }, 2);

    mainPlan.forEach((p, i) => {
      const turn = i + 1;
      const mid = `m_${String(turn).padStart(2, "0")}`;
      const sp = ok.find((e) => e.id === p.speaker) ?? ok[0];
      push("turn.started", {
        discussionId: "d_qa_main", turnIndex: turn, speakerId: p.speaker, speakerName: sp.name,
        intent: p.intent, turnFocus: `${sp.focusArea}·第${turn}轮`, messageId: mid,
        references: turn > 3 ? [`m_${String(turn - 2).padStart(2, "0")}`] : [],
        targetMessageId: turn > 2 ? `m_${String(turn - 1).padStart(2, "0")}` : undefined,
      }, 10 + turn * 10);

      if (abortTurn === turn) {
        push("turn.aborted", {
          discussionId: "d_qa_main", turnIndex: turn, speakerId: p.speaker, messageId: mid,
          reason: "llm_timeout", retryable: true,
        }, 10 + turn * 10 + 3);
        return;
      }

      const content = speechFor(turn);
      push("message.completed", {
        discussionId: "d_qa_main",
        message: {
          id: mid, expertId: p.speaker, speakerName: sp.name, speakerTitle: sp.title,
          speakerColor: sp.color, content, intent: p.intent, turnIndex: turn,
          charCount: cps(content), degraded: false,
          targetMessageId: turn > 2 ? `m_${String(turn - 1).padStart(2, "0")}` : undefined,
          references: turn > 3 ? [`m_${String(turn - 2).padStart(2, "0")}`] : [],
          createdAt: iso(10 + turn * 10 + 4),
        },
      }, 10 + turn * 10 + 4);

      if ([3, 6, 9].includes(turn)) {
        push("insight.updated", {
          discussionId: "d_qa_main",
          insights: consensusNormal.insights.map((x) => ({ ...x, updatedAt: iso(10 + turn * 10 + 5) })),
        }, 10 + turn * 10 + 5);
      }
    });

    push("discussion.summarizing", { discussionId: "d_qa_main", reason: "auto", startedAt: iso(400) }, 400);
    push("summary.completed", {
      discussionId: "d_qa_main",
      summary: {
        content: "这场讨论的共识是：初级岗位的职责边界会变化。主要分歧在于变化是能力升级还是岗位压缩；尚未解决的是企业是否愿意为再培训买单。",
        isFallback: false, createdAt: iso(420),
      },
    }, 420);
    push("discussion.ended", { discussionId: "d_qa_main", endedAt: iso(421) }, 421);

    let result = out;
    if (dropSeq !== null) result = result.filter((e) => e.seq !== dropSeq);
    if (dupSeq !== null) {
      const idx = result.findIndex((e) => e.seq === dupSeq);
      if (idx >= 0) result = [...result.slice(0, idx + 1), { ...result[idx] }, ...result.slice(idx + 1)];
    }
    return result;
  }

  const eventVariants = [
    ["main-flow", "12 轮完整语义事件序列（roster→started→turn/message×12→insight→summarizing→summary→ended）", {}],
    ["with-turn-abort", "第 3 轮 turn.started 后 turn.aborted（无 message.completed）", { abortTurn: 3 }],
    ["with-seq-gap", "缺失 seq=7（模拟丢帧），供补拉逻辑识别", { dropSeq: 7 }],
    ["with-dup-delivery", "seq=12 被重复投递，供去重逻辑识别", { dupSeq: 12 }],
  ];
  for (const [name, desc, opts] of eventVariants) {
    await emit(`events/${name}.json`, {
      $schema: "qa/events@1", name, discussionId: "d_qa_main", description: desc,
      events: buildEvents(opts),
    });
  }

  /* ---- 自检 ---- */
  const ev = buildEvents();
  const starts = ev.filter((e) => e.type === "turn.started").length;
  const terminals = ev.filter((e) => e.type === "message.completed" || e.type === "turn.aborted").length;
  check(starts === terminals, `main-flow: turn.started(${starts}) 与终态(${terminals}) 不等`);
  check(ev.filter((e) => e.type === "discussion.ended").length === 1, "main-flow 必须有且只有 1 个 ended");
  check(
    ev.slice(-3).map((e) => e.type).join(",") === "discussion.summarizing,summary.completed,discussion.ended",
    "main-flow 收尾顺序错误",
  );
  check(ev.every((e, i) => i === 0 || e.seq === ev[i - 1].seq + 1), "main-flow seq 不连续");

  if (problems.length > 0) {
    console.error("fixture 生成自检失败：");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(`fixtures 已生成：${FIX}`);
  console.log("  议题 5；roster 5+2 正常 + 8 负例；decision 6；speech 5；consensus 4；summary 3；mixed 1；events 4");
}

await main();
