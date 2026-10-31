import { request } from "./client";
import type {
  ConfirmResponse,
  CreateResponse,
  DiscussionDetail,
  DiscussionState,
  EndResponse,
  EventsResponse,
  ListResponse,
  PersistedEvent,
} from "./types";

export type ListStatusFilter =
  | "all"
  | "active"
  | "ended"
  | "failed"
  | "generating"
  | "ready"
  | "live"
  | "summarizing";

export interface ListParams {
  status?: ListStatusFilter;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}

export function listDiscussions(params: ListParams = {}): Promise<ListResponse> {
  const { status = "all", limit = 50, offset = 0, signal } = params;
  const query = new URLSearchParams({
    status,
    limit: String(limit),
    offset: String(offset),
  });
  return request<ListResponse>(`/discussions?${query.toString()}`, { signal });
}

export interface CreateInput {
  topic: string;
  expertCount: number;
  clientRequestId: string;
}

export function createDiscussion(input: CreateInput): Promise<CreateResponse> {
  return request<CreateResponse>("/discussions", {
    method: "POST",
    body: {
      topic: input.topic,
      expertCount: input.expertCount,
      clientRequestId: input.clientRequestId,
    },
  });
}

export function getDiscussion(
  id: string,
  signal?: AbortSignal,
): Promise<DiscussionDetail> {
  return request<DiscussionDetail>(`/discussions/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function getDiscussionState(
  id: string,
  signal?: AbortSignal,
): Promise<DiscussionState> {
  return request<DiscussionState>(
    `/discussions/${encodeURIComponent(id)}/state`,
    { signal },
  );
}

export function regenerateRoster(id: string): Promise<CreateResponse> {
  return request<CreateResponse>(
    `/discussions/${encodeURIComponent(id)}/roster/regenerate`,
    { method: "POST" },
  );
}

export function confirmDiscussion(id: string): Promise<ConfirmResponse> {
  return request<ConfirmResponse>(
    `/discussions/${encodeURIComponent(id)}/confirm`,
    { method: "POST" },
  );
}

export function endDiscussion(id: string): Promise<EndResponse> {
  return request<EndResponse>(`/discussions/${encodeURIComponent(id)}/end`, {
    method: "POST",
  });
}

export interface EventsParams {
  after?: number;
  limit?: number;
  signal?: AbortSignal;
}

export function getEvents(
  id: string,
  params: EventsParams = {},
): Promise<EventsResponse> {
  const { after = 0, limit = 500, signal } = params;
  const query = new URLSearchParams({
    after: String(after),
    limit: String(limit),
  });
  return request<EventsResponse>(
    `/discussions/${encodeURIComponent(id)}/events?${query.toString()}`,
    { signal },
  );
}

/** Drain every page of the event log — the replay timeline needs all of it. */
export async function getAllEvents(
  id: string,
  signal?: AbortSignal,
): Promise<PersistedEvent[]> {
  const collected: PersistedEvent[] = [];
  let after = 0;
  let guard = 0;

  for (;;) {
    const page = await getEvents(id, { after, limit: 1000, signal });
    collected.push(...page.items);
    const last = page.items.at(-1);
    if (!page.hasMore || !last) break;
    after = last.seq;
    guard += 1;
    if (guard > 20) break;
  }

  return collected;
}
