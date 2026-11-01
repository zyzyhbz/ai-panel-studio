import type { DiscussionStatus, InsightType, Intent } from "@ai-panel/shared";
import { maxTurnsFor } from "@ai-panel/shared";
import type {
  DiscussionRecord,
  ExpertRecord,
  InsightRecord,
  MessageRecord,
  SummaryRecord,
} from "../types";

export interface ExpertDto {
  id: string;
  role: "host" | "expert";
  name: string;
  profession: string;
  title: string;
  stance: string;
  stanceAxis: string;
  polarity: ExpertRecord["polarity"];
  focusArea: string;
  color: string;
  sortOrder: number;
}

export interface MessageDto {
  id: string;
  expertId: string;
  speakerName: string;
  speakerTitle: string;
  speakerColor: string;
  content: string;
  intent: Intent;
  turnIndex: number;
  charCount: number;
  degraded: boolean;
  targetMessageId?: string;
  references?: string[];
  createdAt: string;
}

export interface InsightDto {
  id: string;
  type: InsightType;
  content: string;
  evidenceMessageIds: string[];
  firstSeenTurn: number;
  updatedAt: string;
}

export interface SummaryDto {
  content: string;
  createdAt: string;
  isFallback: boolean;
}

export interface DiscussionDto {
  id: string;
  topic: string;
  status: DiscussionStatus;
  expertCount: number;
  plannedTurns: number;
  maxTurns: number;
  turnCount: number;
  lastSeq: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  archivedAt: string | null;
  errorCode: string | null;
}

export interface DiscussionListItemDto extends DiscussionDto {
  hostName: string | null;
  experts: ExpertDto[];
  summaryPreview: string | null;
}

export interface ActiveTurnDto {
  turnIndex: number;
  speakerId: string;
  messageId: string;
  intent: Intent;
  turnFocus: string;
  references: string[];
}

export function toExpertDto(expert: ExpertRecord): ExpertDto {
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

export function toDiscussionDto(discussion: DiscussionRecord): DiscussionDto {
  return {
    id: discussion.id,
    topic: discussion.topic,
    status: discussion.status,
    expertCount: discussion.expertCount,
    plannedTurns: discussion.plannedTurns,
    maxTurns: maxTurnsFor(discussion.expertCount),
    turnCount: discussion.turnCount,
    lastSeq: discussion.lastSeq,
    createdAt: discussion.createdAt,
    updatedAt: discussion.updatedAt,
    startedAt: discussion.startedAt,
    endedAt: discussion.endedAt,
    archivedAt: discussion.archivedAt,
    errorCode: discussion.errorCode,
  };
}

export function toMessageDto(
  message: MessageRecord,
  experts: ReadonlyMap<string, ExpertRecord>,
): MessageDto {
  const speaker = experts.get(message.expertId);
  const dto: MessageDto = {
    id: message.id,
    expertId: message.expertId,
    speakerName: speaker?.name ?? "未知发言人",
    speakerTitle: speaker?.title ?? "",
    speakerColor: speaker?.color ?? "#9CA3AF",
    content: message.content,
    intent: message.intent,
    turnIndex: message.turnIndex,
    charCount: message.charCount,
    degraded: message.degraded,
    createdAt: message.createdAt,
  };
  if (message.targetMessageId) dto.targetMessageId = message.targetMessageId;
  if (message.references.length > 0) dto.references = message.references;
  return dto;
}

export function toInsightDto(insight: InsightRecord): InsightDto {
  return {
    id: insight.id,
    type: insight.type,
    content: insight.content,
    evidenceMessageIds: insight.evidenceMessageIds,
    firstSeenTurn: insight.firstSeenTurn,
    updatedAt: insight.updatedAt,
  };
}

export function toSummaryDto(summary: SummaryRecord): SummaryDto {
  return {
    content: summary.content,
    createdAt: summary.createdAt,
    isFallback: summary.isFallback,
  };
}

export function expertMap(experts: readonly ExpertRecord[]): Map<string, ExpertRecord> {
  return new Map(experts.map((e) => [e.id, e]));
}
