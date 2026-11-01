import type {
  DiscussionDetail,
  DiscussionListItem,
  Expert,
  Insight,
  Message,
  PersistedEvent,
} from "../api/types";

const BASE_TIME = Date.parse("2026-11-01T10:00:00.000Z");

function iso(offsetSeconds: number): string {
  return new Date(BASE_TIME + offsetSeconds * 1000).toISOString();
}

export function makeExpert(overrides: Partial<Expert> = {}): Expert {
  return {
    id: "e_host",
    role: "host",
    name: "林致远",
    profession: "科技主持人",
    title: "资深圆桌主持",
    stance: "中立，负责追问与串联",
    stanceAxis: "替代 vs 重构",
    polarity: "neutral",
    color: "#D9D9D9",
    focusArea: "开场与节奏",
    sortOrder: 0,
    ...overrides,
  };
}

export function makeExpertList(): Expert[] {
  return [
    makeExpert(),
    makeExpert({
      id: "e_01",
      role: "expert",
      name: "周明",
      profession: "软件工程师",
      title: "技术负责人",
      stance: "AI 会重构初级岗位，而不是简单消灭",
      stanceAxis: "岗位替代 vs 岗位重构",
      polarity: "support",
      color: "#E8B04B",
      focusArea: "工程实践与岗位结构",
      sortOrder: 1,
    }),
    makeExpert({
      id: "e_02",
      role: "expert",
      name: "许澜",
      profession: "组织心理学研究者",
      title: "副教授",
      stance: "AI 先替代任务，再压缩岗位",
      stanceAxis: "岗位替代 vs 岗位重构",
      polarity: "strong_oppose",
      color: "#4FC3A1",
      focusArea: "组织行为",
      sortOrder: 2,
    }),
  ];
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "m_01",
    expertId: "e_host",
    speakerName: "林致远",
    speakerTitle: "资深圆桌主持",
    speakerColor: "#D9D9D9",
    content: "今天我们不急着下结论，先请各位判断：AI 到底在替代还是重构初级岗位？",
    intent: "opening",
    turnIndex: 1,
    charCount: 40,
    degraded: false,
    createdAt: iso(2),
    ...overrides,
  };
}

export function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "i_01",
    type: "consensus",
    content: "双方都认为初级岗位的职责会变化",
    evidenceMessageIds: ["m_01", "m_02"],
    firstSeenTurn: 2,
    updatedAt: iso(30),
    ...overrides,
  };
}

export function makeDetail(overrides: Partial<DiscussionDetail> = {}): DiscussionDetail {
  const experts = makeExpertList();
  return {
    discussion: {
      id: "d_01",
      topic: "AI 会不会让初级开发者失业？",
      status: "live",
      expertCount: 4,
      turnCount: 2,
      lastSeq: 4,
      plannedTurns: 10,
      maxTurns: 12,
      createdAt: iso(0),
      updatedAt: iso(60),
      startedAt: iso(10),
      endedAt: null,
      errorCode: null,
    },
    experts,
    messages: [
      makeMessage(),
      makeMessage({
        id: "m_02",
        expertId: "e_01",
        speakerName: "周明",
        speakerTitle: "技术负责人",
        speakerColor: "#E8B04B",
        content: "我觉得是重构。AI 替代的是任务，不是人。",
        intent: "rebut",
        turnIndex: 2,
        createdAt: iso(20),
      }),
    ],
    insights: [makeInsight()],
    summary: null,
    activeTurn: null,
    ...overrides,
  };
}

export function makeListItem(
  overrides: Partial<DiscussionListItem> = {},
): DiscussionListItem {
  const detail = makeDetail();
  return {
    ...detail.discussion,
    hostName: "林致远",
    experts: detail.experts,
    summaryPreview: "双方都认为初级岗位会变化，分歧在于是升级还是压缩。",
    errorCode: null,
    ...overrides,
  };
}

/** A compact, replay-able event log: roster → started → 2 turns → ended. */
export function makeEvents(): PersistedEvent[] {
  return [
    {
      seq: 1,
      type: "roster.ready",
      createdAt: iso(0),
      payload: { discussionId: "d_01", experts: makeExpertList() },
    },
    {
      seq: 2,
      type: "discussion.started",
      createdAt: iso(1),
      payload: { discussionId: "d_01", startedAt: iso(1) },
    },
    {
      seq: 3,
      type: "turn.started",
      createdAt: iso(2),
      payload: {
        discussionId: "d_01",
        turnIndex: 1,
        speakerId: "e_host",
        messageId: "m_01",
        intent: "opening",
        turnFocus: "开场点题",
      },
    },
    {
      seq: 4,
      type: "message.completed",
      createdAt: iso(3),
      payload: { discussionId: "d_01", message: makeMessage() },
    },
    {
      seq: 5,
      type: "turn.started",
      createdAt: iso(12),
      payload: {
        discussionId: "d_01",
        turnIndex: 2,
        speakerId: "e_01",
        messageId: "m_02",
        intent: "rebut",
        turnFocus: "反驳替代论",
      },
    },
    {
      seq: 6,
      type: "turn.aborted",
      createdAt: iso(13),
      payload: {
        discussionId: "d_01",
        turnIndex: 2,
        speakerId: "e_01",
        messageId: "m_02",
        reason: "llm_timeout",
        retryable: true,
      },
    },
    {
      seq: 7,
      type: "insight.updated",
      createdAt: iso(14),
      payload: { discussionId: "d_01", insights: [makeInsight()] },
    },
    {
      seq: 8,
      type: "discussion.summarizing",
      createdAt: iso(40),
      payload: { discussionId: "d_01", reason: "auto", startedAt: iso(40) },
    },
    {
      seq: 9,
      type: "summary.completed",
      createdAt: iso(45),
      payload: {
        discussionId: "d_01",
        summary: {
          content: "这场讨论的共识是……主要分歧在……",
          createdAt: iso(45),
          isFallback: false,
        },
      },
    },
    {
      seq: 10,
      type: "discussion.ended",
      createdAt: iso(46),
      payload: { discussionId: "d_01", endedAt: iso(46) },
    },
  ];
}
