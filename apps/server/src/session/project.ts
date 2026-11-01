import type {
  DiscussionSnapshot,
  ExpertPersona,
  InsightItem,
  TranscriptMessage,
} from "@ai-panel/agent";
import { maxTurnsFor } from "@ai-panel/shared";
import type { AppRepos } from "../context";
import type { ExpertRecord, InsightRecord, MessageRecord } from "../types";

/**
 * DB projection → the single read-only snapshot the agent package consumes
 * (docs/AGENT-API §4). This is the only place where storage shapes and agent
 * shapes are allowed to meet.
 */
export function projectSnapshot(
  repos: AppRepos,
  discussionId: string,
): DiscussionSnapshot | null {
  const discussion = repos.discussions.getById(discussionId);
  if (!discussion) return null;

  const experts = repos.experts.listByDiscussion(discussionId);
  const messages = repos.messages.listByDiscussion(discussionId);
  const insights = repos.insights.listByDiscussion(discussionId);
  const summary = repos.summaries.get(discussionId);
  const nameById = new Map(experts.map((e) => [e.id, e.name]));

  return {
    discussionId,
    topic: discussion.topic,
    expertCount:
      experts.filter((e) => e.role === "expert").length || discussion.expertCount,
    status: discussion.status,
    turnCount: discussion.turnCount,
    plannedTurns: discussion.plannedTurns,
    maxTurns: maxTurnsFor(discussion.expertCount),
    experts: experts.map(toPersona),
    messages: messages.map((m) => toTranscriptMessage(m, nameById)),
    insights: insights.map(toInsightItem),
    summary: summary?.content ?? null,
  };
}

export function toPersona(expert: ExpertRecord): ExpertPersona {
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
  };
}

export function toTranscriptMessage(
  message: MessageRecord,
  nameById: ReadonlyMap<string, string>,
): TranscriptMessage {
  const dto: TranscriptMessage = {
    id: message.id,
    expertId: message.expertId,
    speakerName: nameById.get(message.expertId) ?? "未知发言人",
    turnIndex: message.turnIndex,
    intent: message.intent,
    content: message.content,
    charCount: message.charCount,
    degraded: message.degraded,
  };
  if (message.targetMessageId) dto.targetMessageId = message.targetMessageId;
  if (message.references.length > 0) dto.references = message.references;
  return dto;
}

export function toInsightItem(insight: InsightRecord): InsightItem {
  return {
    id: insight.id,
    type: insight.type,
    content: insight.content,
    evidenceMessageIds: insight.evidenceMessageIds,
    firstSeenTurn: insight.firstSeenTurn,
  };
}
