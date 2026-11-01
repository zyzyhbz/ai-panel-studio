import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { installMockServer } from "./mockServer";
import type { CreateResponse, ListResponse } from "../api/types";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  installMockServer();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("dev mock server", () => {
  it("serves the seeded discussions to the home page", async () => {
    const response = await fetch("/api/discussions?status=all&limit=50&offset=0");
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListResponse;

    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(body.items.some((item) => item.status === "ended")).toBe(true);
    expect(body.items[0].experts?.length).toBeGreaterThan(1);
  });

  it("creates a discussion and replays the same one for a repeated clientRequestId", async () => {
    const payload = {
      topic: "远程办公会削弱团队创造力吗？",
      expertCount: 4,
      clientRequestId: "11111111-1111-4111-8111-111111111111",
    };

    const first = await fetch("/api/discussions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as CreateResponse;
    expect(created.discussion.status).toBe("ready");
    expect(created.experts).toHaveLength(5);

    const second = await fetch("/api/discussions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const replayed = (await second.json()) as CreateResponse;
    expect(replayed.discussion.id).toBe(created.discussion.id);
  }, 20_000);

  it("exposes a detail payload with the v1.0 expert fields", async () => {
    const list = (await (
      await fetch("/api/discussions?status=all")
    ).json()) as ListResponse;
    const id = list.items[0].id;

    const detail = await (await fetch(`/api/discussions/${id}`)).json();
    expect(detail.discussion.id).toBe(id);
    expect(detail.experts[0]).toHaveProperty("stanceAxis");
    expect(detail.experts[0]).toHaveProperty("polarity");
    expect(detail.experts[0]).toHaveProperty("focusArea");
  });
});
