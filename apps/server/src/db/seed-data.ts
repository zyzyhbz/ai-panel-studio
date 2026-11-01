import type { DiscussionStatus, InsightType, Intent, Polarity } from "@ai-panel/shared";
import { plannedTurnsFor } from "@ai-panel/shared";
import type { Db } from "./connection";
import { createDiscussionsRepo } from "../repositories/discussions.repo";
import { createEventsRepo } from "../repositories/events.repo";
import { createExpertsRepo, type ExpertInput } from "../repositories/experts.repo";
import { createInsightsRepo } from "../repositories/insights.repo";
import { createMessagesRepo } from "../repositories/messages.repo";
import { createSummariesRepo } from "../repositories/summaries.repo";
import { createEventService } from "../services/event.service";
import { toMessageDto } from "../http/serializers";
import type { ExpertRecord } from "../types";

/* ------------------------------------------------------------------ helpers */

/** Deterministic UUID-shaped id: valid v4 format, readable in URLs. */
export function seedId(prefix: string, n: number): string {
  const head = n.toString(16).padStart(7, "0").slice(-7);
  const tail = n.toString(16).padStart(12, "0").slice(-12);
  return `${prefix}${head}-0000-4000-8000-${tail}`;
}

function makeClock(start: string, stepMs = 9_000): () => string {
  let t = Date.parse(start);
  return () => {
    const value = new Date(t).toISOString();
    t += stepMs;
    return value;
  };
}

interface Persona {
  key: "host" | "e1" | "e2" | "e3" | "e4";
  role: "host" | "expert";
  name: string;
  profession: string;
  title: string;
  stance: string;
  stanceAxis: string;
  polarity: Polarity;
  focusArea: string;
  color: string;
}

interface TurnSeed {
  speaker: Persona["key"];
  intent: Intent;
  turnFocus: string;
  content: string;
  degraded?: boolean;
}

interface InsightSeed {
  type: InsightType;
  content: string;
  evidence: number[]; // 1-based turn numbers
}

export interface FixtureSeed {
  n: number;
  topic: string;
  expertCount: number;
  status: DiscussionStatus;
  createdAt: string;
  personas: Persona[];
  turns?: TurnSeed[];
  insights?: InsightSeed[];
  summary?: string;
  summaryFallback?: boolean;
  errorCode?: string;
}

/* ----------------------------------------------------------------- fixtures */

const BASE_PERSONAS: Persona[] = [
  {
    key: "host",
    role: "host",
    name: "林致远",
    profession: "科技主持人",
    title: "资深圆桌主持",
    stance: "中立，负责追问与串联",
    stanceAxis: "中立主持",
    polarity: "neutral",
    focusArea: "节奏与追问",
    color: "#D9D9D9",
  },
  {
    key: "e1",
    role: "expert",
    name: "周明",
    profession: "软件工程师",
    title: "技术负责人",
    stance: "AI 会重构初级岗位的职责，而不是简单消灭它",
    stanceAxis: "岗位替代 vs 岗位重构",
    polarity: "support",
    focusArea: "工程实践与岗位结构",
    color: "#3E7CB1",
  },
  {
    key: "e2",
    role: "expert",
    name: "许澜",
    profession: "组织心理学研究者",
    title: "副教授",
    stance: "被替代的是任务，不是人；但人的适应速度被高估了",
    stanceAxis: "岗位替代 vs 岗位重构",
    polarity: "oppose",
    focusArea: "人的适应与职业认同",
    color: "#2F92B0",
  },
  {
    key: "e3",
    role: "expert",
    name: "陈默",
    profession: "劳动经济学家",
    title: "研究员",
    stance: "企业是否愿意为再培训买单，决定了岗位是升级还是压缩",
    stanceAxis: "效率优先 vs 分配优先",
    polarity: "neutral",
    focusArea: "再培训成本与劳动力供给",
    color: "#A9795A",
  },
  {
    key: "e4",
    role: "expert",
    name: "陆嘉",
    profession: "创业者",
    title: "CEO",
    stance: "小团队加 AI 会替代一整个初级层级",
    stanceAxis: "效率优先 vs 分配优先",
    polarity: "strong_support",
    focusArea: "组织成本与人效",
    color: "#5A63A8",
  },
];

const REMOTE_PERSONAS: Persona[] = [
  BASE_PERSONAS[0]!,
  {
    key: "e1",
    role: "expert",
    name: "沈知远",
    profession: "企业管理研究者",
    title: "教授",
    stance: "远程办公的损耗被低估了，信任成本才是关键",
    stanceAxis: "效率 vs 信任",
    polarity: "oppose",
    focusArea: "组织信任与协作成本",
    color: "#3E7CB1",
  },
  {
    key: "e2",
    role: "expert",
    name: "顾清",
    profession: "人力资源总监",
    title: "HRD",
    stance: "混合办公已经是默认解，争的是节奏不是要不要",
    stanceAxis: "效率 vs 信任",
    polarity: "support",
    focusArea: "招聘半径与留存",
    color: "#2F92B0",
  },
  {
    key: "e3",
    role: "expert",
    name: "唐棠",
    profession: "城市研究者",
    title: "副研究员",
    stance: "办公室的价值会转移到少数高密度协作场景",
    stanceAxis: "集中 vs 分布",
    polarity: "neutral",
    focusArea: "空间与通勤结构",
    color: "#6E86B8",
  },
  {
    key: "e4",
    role: "expert",
    name: "罗一鸣",
    profession: "远程团队教练",
    title: "创始人",
    stance: "绝大多数团队失败在管理习惯，不是工具",
    stanceAxis: "集中 vs 分布",
    polarity: "strong_support",
    focusArea: "异步协作方法",
    color: "#A9795A",
  },
];

const FIXTURES: FixtureSeed[] = [
  {
    n: 1,
    topic: "AI 会不会让初级开发者失业？",
    expertCount: 4,
    status: "ended",
    createdAt: "2026-10-30T09:00:00.000Z",
    personas: BASE_PERSONAS,
    turns: [
      {
        speaker: "host",
        intent: "opening",
        turnFocus: "开场点题",
        content:
          "今天不急着下结论，先请各位判断：AI 到底在替代初级岗位，还是在改写初级岗位的职责边界？",
      },
      {
        speaker: "e1",
        intent: "extend",
        turnFocus: "任务的拆解",
        content:
          "我的判断是重构。被自动化的是任务清单，不是人；初级岗位会变成审校和编排 AI 的角色。",
      },
      {
        speaker: "e2",
        intent: "rebut",
        turnFocus: "适应速度被高估",
        content:
          "我不太同意这么乐观。被替代的确实不是人，但人的适应速度被严重高估了，尤其是三十岁以后的转岗。",
      },
      {
        speaker: "host",
        intent: "probe",
        turnFocus: "追问适应成本",
        content: "那我想追问一句：如果真的只是任务被替代，为什么初级岗位的招聘数量会先掉？",
      },
      {
        speaker: "e3",
        intent: "clarify",
        turnFocus: "再培训成本",
        content:
          "先把成本说清楚。企业愿不愿意为再培训买单，决定了岗位是升级还是压缩，这跟技术无关。",
      },
      {
        speaker: "e4",
        intent: "support",
        turnFocus: "组织人效",
        content:
          "从用人角度看，小团队加 AI 确实能顶掉一整个初级层级，这不是预测，是我这两年的实际做法。",
      },
      {
        speaker: "e2",
        intent: "rebut",
        turnFocus: "分配而非效率",
        content:
          "那你省下来的成本有没有回到人身上？如果没有，这就不是效率问题，是分配问题。",
      },
      {
        speaker: "host",
        intent: "mediate",
        turnFocus: "串联两种立场",
        content:
          "两位其实说的是不同层面：一个在说岗位结构，一个在说成本归属。先把这两个层面分开，分歧会清楚很多。",
      },
      {
        speaker: "e1",
        intent: "extend",
        turnFocus: "培养路径",
        content:
          "补一句：真正的风险不是现有初级失业，而是培养路径断了，三年后没人能长成中级。",
      },
      {
        speaker: "host",
        intent: "summary",
        turnFocus: "收尾与共识",
        content:
          "收个尾。共识是职责一定会变，分歧在于变化的代价由谁承担，还没解决的是培养路径怎么接。",
      },
    ],
    insights: [
      {
        type: "consensus",
        content: "各方都认为被替代的是任务而不是人，初级岗位的职责边界会变化",
        evidence: [2, 3],
      },
      {
        type: "divergence",
        content: "变化是岗位升级还是成本压缩，双方没有达成一致",
        evidence: [5, 6],
      },
      {
        type: "open_question",
        content: "培养路径断裂之后，三年后谁来接中级岗位，目前没有答案",
        evidence: [9],
      },
    ],
    summary:
      "这场讨论的共识比较清楚：各位都同意被自动化的是任务清单，不是人本身，初级岗位的职责边界一定会变。分歧主要在两处：一是这种变化算岗位升级还是成本压缩，二是代价由谁承担。技术派认为企业会顺势把初级培养成编排者，组织派则担心再培训投入根本没有发生。还没有解决的问题是培养路径：如果初级岗位不再承担训练新人的功能，三年后中级人才的来源会断档，这一点目前没有可行的解法。",
  },
  {
    n: 2,
    topic: "远程办公应该成为默认选项吗？",
    expertCount: 4,
    status: "live",
    createdAt: "2026-10-30T14:00:00.000Z",
    personas: REMOTE_PERSONAS,
    turns: [
      {
        speaker: "host",
        intent: "opening",
        turnFocus: "开场点题",
        content: "先把问题收敛一下：远程办公该不该成为默认选项，而不是只在特殊时期启用？",
      },
      {
        speaker: "e2",
        intent: "support",
        turnFocus: "招聘半径",
        content: "我支持默认。默认远程之后招聘半径直接翻倍，这对中小公司是决定性的。",
      },
      {
        speaker: "e1",
        intent: "rebut",
        turnFocus: "信任成本",
        content:
          "招聘半径是收益，但信任成本被低估了。没有日常碰面，跨部门协作会退化成流程对抗。",
      },
      {
        speaker: "e4",
        intent: "extend",
        turnFocus: "管理习惯",
        content: "问题不在远程本身，在管理习惯。绝大多数团队失败是因为还在用线下的方式管线上的人。",
      },
      {
        speaker: "host",
        intent: "probe",
        turnFocus: "追问失败证据",
        content: "那有没有反例？什么情况下默认远程一定不成立？",
      },
    ],
    insights: [
      {
        type: "consensus",
        content: "各方都同意远程本身不是问题，管理方式才是决定因素",
        evidence: [2, 4],
      },
      {
        type: "divergence",
        content: "远程收益是否足以抵消信任成本，双方判断不同",
        evidence: [3, 4],
      },
    ],
  },
  {
    n: 3,
    topic: "年轻人还应该把买房当作人生目标吗？",
    expertCount: 4,
    status: "ready",
    createdAt: "2026-10-30T18:00:00.000Z",
    personas: BASE_PERSONAS.map((p) =>
      p.key === "e1"
        ? {
            ...p,
            name: "叶秋",
            profession: "城市经济研究者",
            title: "副研究员",
            stance: "房子正在从资产变回居住品，目标本身要重写",
            stanceAxis: "资产 vs 居住",
            polarity: "oppose" as Polarity,
            focusArea: "租售比与流动性",
          }
        : p.key === "e2"
          ? {
              ...p,
              name: "苏牧",
              profession: "理财顾问",
              title: "合伙人",
              stance: "在核心城市，房产仍然是家庭资产表的压舱石",
              stanceAxis: "资产 vs 居住",
              polarity: "support" as Polarity,
              focusArea: "家庭资产配置",
            }
          : p,
    ),
  },
  {
    n: 4,
    topic: "开源模型会终结闭源大模型的商业模式吗？",
    expertCount: 4,
    status: "failed",
    createdAt: "2026-10-30T20:00:00.000Z",
    personas: BASE_PERSONAS,
    errorCode: "ROSTER_GENERATION_FAILED",
  },
  {
    n: 5,
    topic: "公司应该禁止员工用 AI 写代码吗？",
    expertCount: 4,
    status: "ended",
    createdAt: "2026-10-31T08:00:00.000Z",
    personas: BASE_PERSONAS.map((p) =>
      p.key === "e3"
        ? {
            ...p,
            name: "程静",
            profession: "工程效能负责人",
            title: "总监",
            stance: "禁不掉，不如把评审标准提上来",
            stanceAxis: "禁止 vs 规范",
            polarity: "strong_oppose" as Polarity,
            focusArea: "代码评审与质量门禁",
          }
        : p,
    ),
    turns: [
      {
        speaker: "host",
        intent: "opening",
        turnFocus: "开场点题",
        content: "先分清两件事：禁止 AI 写代码，和规范 AI 写代码，哪一个真的可执行？",
      },
      {
        speaker: "e1",
        intent: "rebut",
        turnFocus: "不可执行",
        content: "禁止不可执行。工具已经在编辑器里了，禁止只会让使用转入地下，风险更大。",
      },
      {
        speaker: "e3",
        intent: "extend",
        turnFocus: "评审标准",
        content: "同意。真正要做的是把评审标准提上来，让人对结果负责，而不是对过程设卡。",
      },
      {
        speaker: "e2",
        intent: "clarify",
        turnFocus: "责任归属",
        content: "那责任怎么算？如果一段代码是 AI 写的，出了事故，写的人和批的人谁承担？",
      },
      {
        speaker: "host",
        intent: "mediate",
        turnFocus: "串联责任与流程",
        content: "这其实是两个问题：谁写的不重要，谁签字才重要。流程上要固定住签字的人。",
      },
      {
        speaker: "e4",
        intent: "support",
        turnFocus: "成本",
        content: "从成本看，禁用的代价最高，因为你会同时失去效率和透明度。",
      },
      {
        speaker: "host",
        intent: "summary",
        turnFocus: "收尾与共识",
        content: "收尾：共识是禁不掉，分歧在责任怎么落，未决的是评审标准由谁来定。",
      },
    ],
    insights: [
      {
        type: "consensus",
        content: "各方都认为一刀切禁止不可执行，规范比禁止更现实",
        evidence: [2, 3],
      },
      { type: "divergence", content: "AI 生成代码的责任主体如何界定，仍有分歧", evidence: [4, 5] },
      { type: "open_question", content: "评审标准应该由工程效能团队还是业务团队制定，尚未确定", evidence: [7] },
    ],
    summary:
      "这场讨论很快就收敛了：各位都认为一刀切禁止不可执行，工具已经在编辑器里，禁掉只会让使用转入地下。分歧集中在责任界定上——AI 生成的代码出问题，写的人、批的人、以及引入工具的组织该各自承担多少，目前没有共识。还没有解决的是评审标准由谁制定：工程效能团队更懂工具边界，业务团队更懂风险场景，两者如何分工仍待确定。",
  },
];

/* ------------------------------------------------------------------ writer */

type SeedCtx = {
  db: Db;
  repos: {
    discussions: ReturnType<typeof createDiscussionsRepo>;
    experts: ReturnType<typeof createExpertsRepo>;
    messages: ReturnType<typeof createMessagesRepo>;
    insights: ReturnType<typeof createInsightsRepo>;
    events: ReturnType<typeof createEventsRepo>;
    summaries: ReturnType<typeof createSummariesRepo>;
  };
  events: ReturnType<typeof createEventService>;
  clock: () => string;
};

function buildCtx(db: Db): SeedCtx {
  const repos = {
    discussions: createDiscussionsRepo(db),
    experts: createExpertsRepo(db),
    messages: createMessagesRepo(db),
    insights: createInsightsRepo(db),
    events: createEventsRepo(db),
    summaries: createSummariesRepo(db),
  };
  const clock = () => new Date().toISOString();
  const events = createEventService({
    clock,
    events: repos.events,
    discussions: repos.discussions,
  });
  return { db, repos, events, clock };
}

function insertFixture(ctx: SeedCtx, fixture: FixtureSeed): void {
  const discussionId = seedId("d", fixture.n);
  const metaClock = makeClock(fixture.createdAt);

  ctx.repos.discussions.insert({
    id: discussionId,
    clientRequestId: seedId("c", fixture.n),
    topic: fixture.topic,
    expertCount: fixture.expertCount,
    plannedTurns: plannedTurnsFor(fixture.expertCount),
    qaScenario: null,
    now: metaClock(),
  });

  const idFor = (key: Persona["key"]): string => {
    const index = fixture.personas.findIndex((p) => p.key === key);
    return seedId("e", fixture.n * 10 + Math.max(0, index));
  };

  const expertInputs: ExpertInput[] = fixture.personas.map((persona, index) => ({
    id: idFor(persona.key),
    role: persona.role,
    name: persona.name,
    profession: persona.profession,
    title: persona.title,
    stance: persona.stance,
    stanceAxis: persona.stanceAxis,
    polarity: persona.polarity,
    focusArea: persona.focusArea,
    color: persona.color,
    sortOrder: index,
  }));

  const savedExperts = ctx.repos.experts.replaceAll(discussionId, expertInputs, metaClock());
  const expertById = new Map(savedExperts.map((e) => [e.id, e]));
  const personaByKey = new Map(fixture.personas.map((p) => [p.key, p]));

  ctx.events.append({
    discussionId,
    type: "roster.ready",
    payload: { experts: savedExperts.map(toExpertDtoSafe) },
  });

  if (fixture.status === "ready") {
    ctx.repos.discussions.casStatus(discussionId, ["generating"], "ready", metaClock());
    return;
  }

  if (fixture.status === "failed") {
    const now = metaClock();
    const code = fixture.errorCode ?? "ROSTER_GENERATION_FAILED";
    ctx.repos.discussions.casStatus(discussionId, ["generating"], "failed", now, {
      errorCode: code,
      errorMessage: "阵容生成失败，请重试",
      endedAt: now,
    });
    ctx.events.append({
      discussionId,
      type: "discussion.failed",
      allowClosed: true,
      payload: { code, message: "阵容生成失败，请重试", retryable: true, failedAt: now },
    });
    return;
  }

  const startedAt = metaClock();
  ctx.repos.discussions.casStatus(discussionId, ["generating"], "ready", startedAt);
  ctx.repos.discussions.casStatus(discussionId, ["ready"], "live", startedAt, { startedAt });
  ctx.events.append({ discussionId, type: "discussion.started", payload: { startedAt } });

  const turns = fixture.turns ?? [];
  const messageIdsByTurn = new Map<number, string>();

  turns.forEach((turn, index) => {
    const turnIndex = index + 1;
    const expertId = idFor(turn.speaker);
    const messageId = seedId("b", fixture.n * 100 + turnIndex);
    const now = metaClock();
    ctx.events.append({
      discussionId,
      type: "turn.started",
      payload: {
        turnIndex,
        speakerId: expertId,
        speakerName: personaByKey.get(turn.speaker)?.name ?? "未知",
        intent: turn.intent,
        turnFocus: turn.turnFocus,
        messageId,
      },
    });
    const message = ctx.repos.messages.insert({
      id: messageId,
      discussionId,
      expertId,
      turnIndex,
      intent: turn.intent,
      content: turn.content,
      charCount: [...turn.content].length,
      degraded: turn.degraded ?? false,
      targetMessageId: null,
      references: [],
      createdAt: now,
    });
    ctx.events.append({
      discussionId,
      type: "message.completed",
      payload: { message: toMessageDto(message, expertById as Map<string, ExpertRecord>) },
    });
    ctx.repos.discussions.setTurnCount(discussionId, turnIndex, now);
    messageIdsByTurn.set(turnIndex, messageId);
  });

  if (fixture.insights && fixture.insights.length > 0) {
    const drafts = fixture.insights
      .map((insight, index) => ({
        id: seedId("a", fixture.n * 10 + index),
        type: insight.type,
        content: insight.content,
        evidenceMessageIds: insight.evidence
          .map((turnNo) => messageIdsByTurn.get(turnNo))
          .filter((id): id is string => Boolean(id)),
        firstSeenTurn: Math.max(1, Math.min(...insight.evidence)),
      }))
      .filter((draft) => draft.evidenceMessageIds.length > 0);
    const saved = ctx.repos.insights.replaceSnapshot(
      discussionId,
      drafts,
      Math.max(1, turns.length),
      metaClock(),
      new Set(messageIdsByTurn.values()),
    );
    ctx.events.append({
      discussionId,
      type: "insight.updated",
      payload: {
        insights: saved.map((i) => ({
          id: i.id,
          type: i.type,
          content: i.content,
          evidenceMessageIds: i.evidenceMessageIds,
          firstSeenTurn: i.firstSeenTurn,
          updatedAt: i.updatedAt,
        })),
      },
    });
  }

  if (fixture.status === "live") return;

  const summarizingAt = metaClock();
  ctx.repos.discussions.casStatus(discussionId, ["live"], "summarizing", summarizingAt);
  ctx.events.append({
    discussionId,
    type: "discussion.summarizing",
    payload: { reason: "auto", startedAt: summarizingAt },
  });

  if (fixture.summary) {
    const createdAt = metaClock();
    ctx.repos.summaries.upsert(
      discussionId,
      fixture.summary,
      fixture.summaryFallback ?? false,
      createdAt,
    );
    ctx.events.append({
      discussionId,
      type: "summary.completed",
      payload: {
        summary: {
          content: fixture.summary,
          createdAt,
          isFallback: fixture.summaryFallback ?? false,
        },
      },
    });
  }

  const endedAt = metaClock();
  ctx.events.append({ discussionId, type: "discussion.ended", payload: { endedAt } });
  ctx.repos.discussions.casStatus(discussionId, ["summarizing"], "ended", endedAt, { endedAt });
}

function toExpertDtoSafe(expert: ExpertRecord): Record<string, unknown> {
  return {
    id: expert.id,
    role: expert.role,
    name: expert.name,
    profession: expert.profession,
    title: expert.title,
    stance: expert.stance,
    stanceAxis: expert.stanceAxis,
    polarity: expert.polarity,
    focusArea: expert.focusArea,
    color: expert.color,
    sortOrder: expert.sortOrder,
  };
}

/* --------------------------------------------------------------------- api */

export interface SeedReport {
  inserted: number;
  skipped: number;
  discussions: string[];
}

/**
 * Idempotent seed: existing seed discussions (same id) are left untouched.
 * All rows are written through the event log first, so `/state` and `/detail`
 * agree by construction for every sample.
 */
export function seed(db: Db, options: { force?: boolean } = {}): SeedReport {
  const ctx = buildCtx(db);
  const report: SeedReport = { inserted: 0, skipped: 0, discussions: [] };

  const run = db.transaction(() => {
    for (const fixture of FIXTURES) {
      const id = seedId("d", fixture.n);
      if (!options.force && ctx.repos.discussions.exists(id)) {
        report.skipped += 1;
        continue;
      }
      if (options.force) {
        db.prepare("DELETE FROM discussions WHERE id = ?").run(id);
      }
      insertFixture(ctx, fixture);
      report.inserted += 1;
      report.discussions.push(id);
    }
  });
  run();
  return report;
}

export const SEED_FIXTURE_COUNT = FIXTURES.length;
export { FIXTURES as SEED_FIXTURES };
