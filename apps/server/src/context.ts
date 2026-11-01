import type { AppConfig } from "./config/env";
import type { Db } from "./db/connection";
import type { Clock } from "./lib/clock";
import type { LLMClient } from "./llm/types";
import type { Broadcaster } from "./session/broadcaster";
import type { EventService } from "./services/event.service";
import type { InsightService } from "./services/insight.service";
import type { SummaryService } from "./services/summary.service";
import type { RosterService } from "./services/roster.service";
import type { DiscussionService } from "./services/discussion.service";
import type { SessionManager } from "./session/session-manager";
import type { DiscussionsRepo } from "./repositories/discussions.repo";
import type { EventsRepo } from "./repositories/events.repo";
import type { ExpertsRepo } from "./repositories/experts.repo";
import type { InsightsRepo } from "./repositories/insights.repo";
import type { MessagesRepo } from "./repositories/messages.repo";
import type { SummariesRepo } from "./repositories/summaries.repo";

export interface AppRepos {
  discussions: DiscussionsRepo;
  experts: ExpertsRepo;
  messages: MessagesRepo;
  insights: InsightsRepo;
  events: EventsRepo;
  summaries: SummariesRepo;
}

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
}

/** Everything that is built before the services; no service depends on another here. */
export interface CoreDeps {
  config: AppConfig;
  db: Db;
  clock: Clock;
  llm: LLMClient;
  repos: AppRepos;
  events: EventService;
  broadcaster: Broadcaster;
  log: Logger;
}

export interface AppServices {
  roster: RosterService;
  discussions: DiscussionService;
  insights: InsightService;
  summary: SummaryService;
}

export interface AppContext extends CoreDeps {
  sessions: SessionManager;
  services: AppServices;
  startedAt: number;
}
