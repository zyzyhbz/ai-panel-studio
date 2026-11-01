import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { confirmDiscussion, getDiscussion } from "../../api/discussions";
import { makeDetail, makeMessage } from "../../test/fixtures";
import { StudioPage } from "./StudioPage";

vi.mock("../../api/discussions", () => ({
  getDiscussion: vi.fn(),
  confirmDiscussion: vi.fn(),
  endDiscussion: vi.fn(),
  regenerateRoster: vi.fn(),
  listDiscussions: vi.fn(),
  getEvents: vi.fn(),
  getAllEvents: vi.fn(),
  getDiscussionState: vi.fn(),
}));

const mockedGet = vi.mocked(getDiscussion);
const mockedConfirm = vi.mocked(confirmDiscussion);

type Listener = (event: MessageEvent<string>) => void;

/** Minimal EventSource stand-in: lets a test push frames by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readyState = 0;
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 2;
  }

  emit(type: string, data: unknown, id?: number): void {
    const event = new MessageEvent(type, {
      data: JSON.stringify(data),
      lastEventId: id === undefined ? "" : String(id),
    });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  get urlUsed(): string {
    return this.url;
  }
}

const ID = "d_bug01";

function readyDetail() {
  return makeDetail({
    discussion: {
      ...makeDetail().discussion,
      id: ID,
      status: "ready",
      turnCount: 0,
      lastSeq: 1,
      startedAt: null,
    },
    messages: [],
    insights: [],
    summary: null,
    activeTurn: null,
  });
}

function liveDetail() {
  return makeDetail({
    discussion: {
      ...makeDetail().discussion,
      id: ID,
      status: "live",
      turnCount: 0,
      lastSeq: 2,
      startedAt: "2026-11-01T10:00:01.000Z",
    },
    messages: [],
    insights: [],
    summary: null,
    activeTurn: null,
  });
}

function endedDetail() {
  const message = makeMessage({ id: "m_first", content: "第一句发言，应该出现在直播页。" });
  return makeDetail({
    discussion: {
      ...makeDetail().discussion,
      id: ID,
      status: "ended",
      turnCount: 1,
      lastSeq: 4,
      endedAt: "2026-11-01T10:00:10.000Z",
    },
    messages: [message],
    insights: [],
    summary: {
      content: "这场讨论结束了。",
      createdAt: "2026-11-01T10:00:09.000Z",
      isFallback: false,
    },
    activeTurn: null,
  });
}

function renderStudio() {
  return render(
    <MemoryRouter initialEntries={[`/d/${ID}`]}>
      <Routes>
        <Route path="/d/:id" element={<StudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("StudioPage after confirm (BUG-01)", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    mockedGet.mockReset();
    mockedConfirm.mockReset();
  });

  afterEach(() => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
  });

  it("renders the first message even when the run finishes before the stream opens", async () => {
    const user = userEvent.setup();
    const sequence = [readyDetail(), liveDetail(), endedDetail()];
    let call = 0;
    mockedGet.mockImplementation(async () => {
      const next = sequence[Math.min(call, sequence.length - 1)];
      call += 1;
      return next;
    });
    mockedConfirm.mockResolvedValue({
      discussion: { ...liveDetail().discussion, status: "live" },
    });

    renderStudio();

    // Lobby is shown for a `ready` discussion.
    const confirmButton = await screen.findByTestId("confirm-roster");
    await user.click(confirmButton);

    // The stream opens only after the run already ended on the server; the
    // client must rehydrate instead of closing into an empty shell.
    await waitFor(() => expect(FakeEventSource.instances.length).toBeGreaterThan(0));
    FakeEventSource.instances.at(-1)?.emit("stream.ready", {
      discussionId: ID,
      status: "ended",
      fromSeq: 2,
      lastSeq: 4,
    });

    expect(await screen.findByTestId("message-m_first")).toHaveTextContent(
      "第一句发言，应该出现在直播页。",
    );
    expect(screen.getByTestId("summary-card")).toBeInTheDocument();
    expect(screen.getByTestId("stage-header")).toBeInTheDocument();
  });

  it("shows the live stage with an opening hint before the first message arrives", async () => {
    const user = userEvent.setup();
    let call = 0;
    mockedGet.mockImplementation(async () => {
      call += 1;
      return call === 1 ? readyDetail() : liveDetail();
    });
    mockedConfirm.mockResolvedValue({
      discussion: { ...liveDetail().discussion, status: "live" },
    });

    renderStudio();
    await user.click(await screen.findByTestId("confirm-roster"));

    expect(await screen.findByText("主持人即将开场…")).toBeInTheDocument();
    expect(screen.getByTestId("expert-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-roster")).not.toBeInTheDocument();
  });
});
