import type { Intent } from "@ai-panel/shared";
import type {
  DiscussionSnapshot,
  ExpertPersona,
  InsightItem,
  TranscriptMessage,
} from "../core/types";

/**
 * 测试用工厂：不进入公共 API，仅用于单测把"一场讨论"拼出来。
 */

const HOST: ExpertPersona = {
  id: "e_host",
  role: "host",
  name: "林致远",
  profession: "科技主持人",
  title: "资深圆桌主持",
  stance: "中立，负责追问、串联与收尾",
  stanceAxis: "节奏与交锋",
  polarity: "neutral",
  focusArea: "开场与节奏",
  color: "#D9D9D9",
};

const EXPERTS: ExpertPersona[] = [
  {
    id: "e_1",
    role: "expert",
    name: "周明",
    profession: "软件工程师",
    title: "技术负责人",
    stance: "AI 重构初级岗位，而不是消灭它",
    stanceAxis: "岗位替代 vs 岗位重构",
    polarity: "support",
    focusArea: "工程实践",
    color: "#3E7CB1",
  },
  {
    id: "e_2",
    role: "expert",
    name: "许澜",
    profession: "组织心理学研究者",
    title: "副教授",
    stance: "人的适应速度被高估了",
    stanceAxis: "岗位替代 vs 岗位重构",
    polarity: "oppose",
    focusArea: "人的适应",
    color: "#2F92B0",
  },
  {
    id: "e_3",
    role: "expert",
    name: "陈默",
    profession: "劳动经济学研究者",
    title: "研究员",
    stance: "先看供需曲线再谈失业",
    stanceAxis: "效率优先 vs 分配优先",
    polarity: "neutral",
    focusArea: "再培训成本",
    color: "#6E86B8",
  },
  {
    id: "e_4",
    role: "expert",
    name: "顾行舟",
    profession: "创业者",
    title: "创始人",
    stance: "小团队加 AI 会替代一整个初级层级",
    stanceAxis: "效率优先 vs 分配优先",
    polarity: "strong_support",
    focusArea: "组织成本",
    color: "#A9795A",
  },
];

export function makeSnapshot(overrides: Partial<DiscussionSnapshot> = {}): DiscussionSnapshot {
  return {
    discussionId: "d_test",
    topic: "AI 会不会让初级开发者失业？",
    expertCount: 4,
    status: "live",
    turnCount: 0,
    plannedTurns: 12,
    maxTurns: 14,
    experts: [HOST, ...EXPERTS],
    messages: [],
    insights: [],
    summary: null,
    ...overrides,
  };
}

export function makeMessage(
  id: string,
  expertId: string,
  turnIndex: number,
  intent: Intent,
  content: string,
): TranscriptMessage {
  const snapshot = makeSnapshot();
  const speaker = snapshot.experts.find((e) => e.id === expertId);
  return {
    id,
    expertId,
    speakerName: speaker?.name ?? expertId,
    turnIndex,
    intent,
    content,
    charCount: Array.from(content).length,
    degraded: false,
  };
}

/** 造一串已经发生的发言，turnIndex 从 1 开始连续。 */
export function makeHistory(
  entries: Array<[expertId: string, intent: Intent, content: string]>,
  startTurn = 1,
): TranscriptMessage[] {
  return entries.map(([expertId, intent, content], index) =>
    makeMessage(`m_${startTurn + index}`, expertId, startTurn + index, intent, content),
  );
}

export function makeInsight(
  id: string,
  type: InsightItem["type"],
  content: string,
  evidence: string[],
  firstSeenTurn = 2,
): InsightItem {
  return { id, type, content, evidenceMessageIds: evidence, firstSeenTurn };
}

export { EXPERTS, HOST };
