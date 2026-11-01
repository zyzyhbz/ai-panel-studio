import type { DiscussionStatus } from "@ai-panel/shared";
import { DISCUSSION_STATUSES } from "@ai-panel/shared";
import type { CoreDeps } from "../context";
import { AppError } from "../http/errors";
import {
  expertMap,
  toDiscussionDto,
  toExpertDto,
  toInsightDto,
  toMessageDto,
  toSummaryDto,
  type ActiveTurnDto,
  type DiscussionListItemDto,
  type ExpertDto,
  type InsightDto,
  type MessageDto,
  type SummaryDto,
} from "../http/serializers";
import { prefixedId } from "../lib/ids";
import type { MockScenario } from "../llm/types";
import type { ExpertInput } from "../repositories/experts.repo";
import type { DiscussionRecord, ExpertRecord } from "../types";
import { computeActiveTurn, replayEvents } from "../session/replay";
import type { SessionManager } from "../session/session-manager";
import type { RosterService } from "./roster.service";
import { coverageFloorFor } from "./turn-policy";

export interface DiscussionDetail {
  discussion: ReturnType<typeof toDiscussionDto>;
  experts: ExpertDto[];
  messages: MessageDto[];
  insights: InsightDto[];
  summary: SummaryDto | null;
  activeTurn: ActiveTurnDto | null;
  lastSeq: number;
}

export interface DiscussionState {
  discussionId: string;
  status: DiscussionStatus;
  turnCount: number;
  lastSeq: number;
  experts: ExpertDto[];
  messages: MessageDto[];
  insights: InsightDto[];
  summary: SummaryDto | null;
  activeTurn: ActiveTurnDto | null;
}

export interface DiscussionServiceDeps extends CoreDeps {
  roster: RosterService;
  sessions: SessionManager;
}

export interface CreateDiscussionInput {
  topic: string;
  expertCount: number;
  clientRequestId: string;
  scenario: MockScenario;
}

export interface CreateDiscussionResult {
  created: boolean;
  discussion: DiscussionRecord;
  experts: ExpertRecord[];
}

const ACTIVE_STATUSES: readonly DiscussionStatus[] = [
  "generating",
  "ready",
  "live",
  "summarizing",
];

export function parseStatusFilter(raw: string | undefined): readonly DiscussionStatus[] | undefined {
  if (!raw || raw === "all") return undefined;
  if (raw === "active") return ACTIVE_STATUSES;
  if ((DISCUSSION_STATUSES as readonly string[]).includes(raw)) {
    return [raw as DiscussionStatus];
  }
  throw new AppError("VALIDATION_ERROR", "status 取值不合法", {
    allowed: ["all", "active", "ended", "failed", ...DISCUSSION_STATUSES],
  });
}

export interface DiscussionService {
  create(input: CreateDiscussionInput): Promise<CreateDiscussionResult>;
  get(id: string): DiscussionRecord;
  list(params: {
    status?: string;
    limit: number;
    offset: number;
  }): { items: DiscussionListItemDto[]; total: number };
  detail(id: string): DiscussionDetail;
  state(id: string): DiscussionState;
  regenerate(id: string): Promise<{ discussion: DiscussionRecord; experts: ExpertRecord[] }>;
  confirm(id: string): { discussion: DiscussionRecord; restarted: boolean };
  end(id: string): { discussion: DiscussionRecord; accepted: boolean };
}

export function createDiscussionService(
  deps: DiscussionServiceDeps,
): DiscussionService {
  const { repos, events, clock, sessions } = deps;

  function get(id: string): DiscussionRecord {
    const discussion = repos.discussions.getById(id);
    if (!discussion) throw new AppError("NOT_FOUND", "讨论不存在", { discussionId: id });
    return discussion;
  }

  function scenarioOf(discussion: DiscussionRecord): MockScenario {
    return (discussion.qaScenario as MockScenario | null) ?? "normal";
  }

  function markGenerationFailed(discussion: DiscussionRecord, error: AppError): void {
    const now = clock();
    const code =
      error.code === "LLM_TIMEOUT"
        ? "LLM_TIMEOUT"
        : error.code === "LLM_INVALID_OUTPUT"
          ? "LLM_INVALID_OUTPUT"
          : error.code === "LLM_NOT_CONFIGURED"
            ? "LLM_NOT_CONFIGURED"
            : "ROSTER_GENERATION_FAILED";
    repos.discussions.casStatus(discussion.id, ["generating"], "failed", now, {
      errorCode: code,
      errorMessage: error.message,
      endedAt: now,
    });
    try {
      events.append({
        discussionId: discussion.id,
        type: "discussion.failed",
        allowClosed: true,
        payload: { code, message: error.message, retryable: true, failedAt: now },
      });
    } catch {
      /* the status write above is the source of truth */
    }
  }

  function withDetails(error: unknown, discussion: DiscussionRecord): AppError {
    const appError =
      error instanceof AppError ? error : new AppError("ROSTER_GENERATION_FAILED", "阵容生成失败，请重试");
    return new AppError(appError.code, appError.message, {
      ...(appError.details ?? {}),
      discussionId: discussion.id,
      topic: discussion.topic,
      status: "failed",
      retryable: true,
    });
  }

  function persistRoster(discussionId: string, experts: ExpertInput[]): ExpertRecord[] {
    let saved: ExpertRecord[] = [];
    const now = clock();
    const write = deps.db.transaction(() => {
      saved = repos.experts.replaceAll(discussionId, experts, now);
      events.append({
        discussionId,
        type: "roster.ready",
        payload: { experts: saved.map(toExpertDto) },
      });
      repos.discussions.casStatus(discussionId, ["generating"], "ready", now);
    });
    write();
    return saved;
  }

  return {
    async create(input): Promise<CreateDiscussionResult> {
      const existing = repos.discussions.getByClientRequestId(input.clientRequestId);
      if (existing) {
        return {
          created: false,
          discussion: existing,
          experts: repos.experts.listByDiscussion(existing.id),
        };
      }

      const now = clock();
      const discussion = repos.discussions.insert({
        id: prefixedId("d"),
        clientRequestId: input.clientRequestId,
        topic: input.topic,
        expertCount: input.expertCount,
        plannedTurns: coverageFloorFor(input.expertCount),
        qaScenario: input.scenario === "normal" ? null : input.scenario,
        now,
      });

      try {
        const generated = await deps.roster.generate({
          discussionId: discussion.id,
          topic: discussion.topic,
          expertCount: discussion.expertCount,
          scenario: input.scenario,
        });
        const saved = persistRoster(discussion.id, generated.experts);
        return { created: true, discussion: get(discussion.id), experts: saved };
      } catch (error) {
        const appError = withDetails(error, discussion);
        markGenerationFailed(discussion, appError);
        throw appError;
      }
    },

    get,

    list(params): { items: DiscussionListItemDto[]; total: number } {
      const statuses = parseStatusFilter(params.status);
      const { items, total } = repos.discussions.list({
        statuses,
        limit: params.limit,
        offset: params.offset,
      });
      const ids = items.map((i) => i.id);
      const expertsByDiscussion = repos.experts.listByDiscussionIds(ids);
      const previews = repos.summaries.previewByDiscussionIds(ids);

      return {
        total,
        items: items.map((discussion) => {
          const experts = (expertsByDiscussion.get(discussion.id) ?? []).map(toExpertDto);
          const host = experts.find((e) => e.role === "host") ?? null;
          return {
            ...toDiscussionDto(discussion),
            hostName: host?.name ?? null,
            experts,
            summaryPreview: previews.get(discussion.id) ?? null,
          };
        }),
      };
    },

    detail(id): DiscussionDetail {
      const discussion = get(id);
      const experts = repos.experts.listByDiscussion(id);
      const byId = expertMap(experts);
      const messages = repos.messages.listByDiscussion(id).map((m) => toMessageDto(m, byId));
      const insights = repos.insights.listByDiscussion(id).map(toInsightDto);
      const summary = repos.summaries.get(id);
      const activeTurn = computeActiveTurn(repos.events.listAll(id));

      return {
        discussion: toDiscussionDto(discussion),
        experts: experts.map(toExpertDto),
        messages,
        insights,
        summary: summary ? toSummaryDto(summary) : null,
        activeTurn,
        lastSeq: discussion.lastSeq,
      };
    },

    /**
     * Projection rebuilt from the event log only — the independent side of the
     * "live final state === replay final state" check (docs/06 §1.8).
     */
    state(id): DiscussionState {
      const discussion = get(id);
      const eventsLog = repos.events.listAll(id);
      const hasLifecycle = eventsLog.some((e) =>
        ["discussion.started", "discussion.summarizing", "discussion.ended", "discussion.failed"].includes(
          e.type,
        ),
      );
      const replayed = replayEvents(eventsLog, hasLifecycle ? "generating" : discussion.status);
      return {
        discussionId: id,
        status: replayed.status,
        turnCount: replayed.turnCount,
        lastSeq: replayed.lastSeq,
        experts: replayed.experts,
        messages: replayed.messages,
        insights: replayed.insights,
        summary: replayed.summary,
        activeTurn: replayed.activeTurn,
      };
    },

    async regenerate(id): Promise<{ discussion: DiscussionRecord; experts: ExpertRecord[] }> {
      const discussion = get(id);
      if (discussion.status !== "ready" && discussion.status !== "failed") {
        throw new AppError("INVALID_STATE", "当前状态不允许重新生成阵容", {
          discussionId: id,
          status: discussion.status,
        });
      }
      if (repos.messages.countByDiscussion(id) > 0) {
        throw new AppError("INVALID_STATE", "该讨论已有发言，无法更换阵容", {
          discussionId: id,
          status: discussion.status,
        });
      }
      const hadRoster = repos.experts.countByDiscussion(id) > 0;
      const now = clock();
      const won = repos.discussions.casStatus(id, [discussion.status], "generating", now);
      if (!won) {
        throw new AppError("INVALID_STATE", "阵容正在生成中，请稍后重试", {
          discussionId: id,
        });
      }

      try {
        const generated = await deps.roster.generate({
          discussionId: id,
          topic: discussion.topic,
          expertCount: discussion.expertCount,
          scenario: scenarioOf(discussion),
        });
        const saved = persistRoster(id, generated.experts);
        return { discussion: get(id), experts: saved };
      } catch (error) {
        const appError = withDetails(error, discussion);
        // Roll back to the previous usable state when a roster exists.
        repos.discussions.casStatus(id, ["generating"], hadRoster ? "ready" : "failed", clock(), {
          errorCode: hadRoster ? null : appError.code,
          errorMessage: hadRoster ? null : appError.message,
        });
        if (!hadRoster) {
          try {
            events.append({
              discussionId: id,
              type: "discussion.failed",
              allowClosed: true,
              payload: {
                code: appError.code,
                message: appError.message,
                retryable: true,
                failedAt: clock(),
              },
            });
          } catch {
            /* status is authoritative */
          }
        }
        throw appError;
      }
    },

    confirm(id): { discussion: DiscussionRecord; restarted: boolean } {
      const discussion = get(id);
      if (discussion.status === "live") {
        return { discussion, restarted: false };
      }
      if (discussion.status !== "ready") {
        throw new AppError("INVALID_STATE", "讨论当前状态不允许开始", {
          discussionId: id,
          status: discussion.status,
        });
      }
      const now = clock();
      const won = repos.discussions.casStatus(id, ["ready"], "live", now, {
        startedAt: now,
        endedAt: null,
        errorCode: null,
        errorMessage: null,
      });
      if (!won) {
        const current = get(id);
        if (current.status === "live") return { discussion: current, restarted: false };
        throw new AppError("INVALID_STATE", "讨论当前状态不允许开始", {
          discussionId: id,
          status: current.status,
        });
      }
      events.append({ discussionId: id, type: "discussion.started", payload: { startedAt: now } });
      sessions.start(id);
      return { discussion: get(id), restarted: true };
    },

    end(id): { discussion: DiscussionRecord; accepted: boolean } {
      const discussion = get(id);
      switch (discussion.status) {
        case "ended":
          return { discussion, accepted: false };
        case "live":
        case "summarizing":
          sessions.requestStop(id, "user");
          return { discussion: get(id), accepted: true };
        case "failed": {
          if (repos.messages.countByDiscussion(id) === 0) {
            throw new AppError("INVALID_STATE", "该讨论没有可总结的发言，只能重新生成阵容", {
              discussionId: id,
              status: discussion.status,
            });
          }
          sessions.requestStop(id, "user");
          return { discussion, accepted: true };
        }
        default:
          throw new AppError("INVALID_STATE", "讨论当前状态不允许结束", {
            discussionId: id,
            status: discussion.status,
          });
      }
    },
  };
}
