import type {
  DiscussionStatus,
  ExpertRole,
  InsightType,
  Intent,
  Polarity,
} from "@ai-panel/shared";

export interface DiscussionRecord {
  id: string;
  clientRequestId: string;
  topic: string;
  status: DiscussionStatus;
  expertCount: number;
  plannedTurns: number;
  turnCount: number;
  lastSeq: number;
  qaScenario: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ExpertRecord {
  id: string;
  discussionId: string;
  role: ExpertRole;
  name: string;
  profession: string;
  title: string;
  stance: string;
  stanceAxis: string;
  polarity: Polarity;
  focusArea: string;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  discussionId: string;
  expertId: string;
  turnIndex: number;
  intent: Intent;
  content: string;
  charCount: number;
  degraded: boolean;
  targetMessageId: string | null;
  references: string[];
  createdAt: string;
}

export interface InsightRecord {
  id: string;
  discussionId: string;
  type: InsightType;
  content: string;
  evidenceMessageIds: string[];
  firstSeenTurn: number;
  createdAt: string;
  updatedAt: string;
}

export interface SummaryRecord {
  discussionId: string;
  content: string;
  isFallback: boolean;
  createdAt: string;
}

export interface StoredEventRecord {
  id: string;
  discussionId: string;
  seq: number;
  type: string;
  /** The exact JSON string that was (and will be) sent as the SSE `data` field. */
  payloadJson: string;
  createdAt: string;
}

export interface ActiveTurn {
  turnIndex: number;
  speakerId: string;
  messageId: string;
  intent: Intent;
  turnFocus: string;
  references: string[];
}
