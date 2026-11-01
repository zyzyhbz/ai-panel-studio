import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context";
import { toDiscussionDto, toExpertDto } from "../http/serializers";
import {
  archiveDiscussionSchema,
  createDiscussionSchema,
  eventsQuerySchema,
  idParamSchema,
  listDiscussionsSchema,
  parseInput,
} from "../http/validation";
import { resolveScenario } from "../llm/factory";

export function registerDiscussionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/discussions", async (request) => {
    const query = parseInput(listDiscussionsSchema, request.query ?? {});
    const result = ctx.services.discussions.list(query);
    return {
      items: result.items,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
    };
  });

  app.post("/api/discussions", async (request, reply) => {
    const body = parseInput(createDiscussionSchema, request.body ?? {});
    const scenario =
      ctx.config.llm.mode === "mock"
        ? resolveScenario(request.headers["x-qa-scenario"])
        : "normal";

    const result = await ctx.services.discussions.create({
      topic: body.topic,
      expertCount: body.expertCount,
      clientRequestId: body.clientRequestId,
      scenario,
    });

    reply.code(result.created ? 201 : 200);
    return {
      discussion: toDiscussionDto(result.discussion),
      experts: result.experts.map(toExpertDto),
    };
  });

  app.get("/api/discussions/:id", async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return ctx.services.discussions.detail(id);
  });

  app.get("/api/discussions/:id/state", async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    return ctx.services.discussions.state(id);
  });

  app.get("/api/discussions/:id/events", async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    const query = parseInput(eventsQuerySchema, request.query ?? {});
    const discussion = ctx.services.discussions.get(id);
    const { items, hasMore } = ctx.repos.events.listAfter(id, query.after, query.limit);
    return {
      items: items.map((event) => ({
        id: event.id,
        seq: event.seq,
        type: event.type,
        payload: JSON.parse(event.payloadJson) as unknown,
        createdAt: event.createdAt,
      })),
      lastSeq: discussion.lastSeq,
      hasMore,
    };
  });

  app.post("/api/discussions/:id/roster/regenerate", async (request) => {
    const { id } = parseInput(idParamSchema, request.params);
    const result = await ctx.services.discussions.regenerate(id);
    return {
      discussion: toDiscussionDto(result.discussion),
      experts: result.experts.map(toExpertDto),
    };
  });

  app.post("/api/discussions/:id/confirm", async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    const result = ctx.services.discussions.confirm(id);
    reply.code(result.restarted ? 202 : 200);
    return {
      discussion: toDiscussionDto(result.discussion),
      restarted: result.restarted,
    };
  });

  app.post("/api/discussions/:id/end", async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    const result = ctx.services.discussions.end(id);
    reply.code(result.accepted ? 202 : 200);
    return {
      discussion: toDiscussionDto(result.discussion),
      accepted: result.accepted,
    };
  });

  app.post("/api/discussions/:id/archive", async (request, reply) => {
    const { id } = parseInput(idParamSchema, request.params);
    const body = parseInput(archiveDiscussionSchema, request.body ?? {});
    const discussion = ctx.services.discussions.archive(id, body.archived);
    reply.code(200);
    return { discussion: toDiscussionDto(discussion) };
  });
}
