import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { InsightPanel } from "./InsightPanel";
import { Transcript } from "./Transcript";
import { StreamBuffer } from "../domain/streamBuffer";
import { hydrateFromDetail, emptySession } from "../domain/session";
import type { StickyScroll } from "../lib/useStickyScroll";
import { makeDetail, makeEvents } from "../test/fixtures";
import { reduceEvents } from "../domain/reducer";

function stickyStub(): StickyScroll {
  return {
    ref: { current: null },
    pinned: true,
    unread: 0,
    paused: false,
    jumpToLatest: vi.fn(),
    togglePause: vi.fn(),
    notifyContent: vi.fn(),
  };
}

function view() {
  return hydrateFromDetail(emptySession("d_01"), makeDetail());
}

describe("Transcript", () => {
  it("renders speaker name, title and content for every message", () => {
    const buffer = new StreamBuffer();
    render(
      <Transcript view={view()} buffer={buffer} sticky={stickyStub()} />,
    );

    expect(screen.getByTestId("message-m_01")).toHaveTextContent("林致远");
    expect(screen.getByTestId("message-m_01")).toHaveTextContent("资深圆桌主持");
    expect(screen.getByTestId("message-m_02")).toHaveTextContent("周明");
    expect(screen.getByTestId("message-m_02")).toHaveTextContent(
      "AI 替代的是任务，不是人",
    );
    // internal events ("举手") must never leak into the transcript
    expect(screen.queryByText(/举手/)).not.toBeInTheDocument();
  });

  it("renders a readable line for an aborted turn instead of a hanging bubble", () => {
    const buffer = new StreamBuffer();
    const replayed = reduceEvents(emptySession("d_01"), makeEvents());
    render(
      <Transcript view={replayed} buffer={buffer} sticky={stickyStub()} />,
    );

    const notice = screen.getByTestId("turn-notice");
    expect(notice).toHaveTextContent("这一轮模型超时了");
    expect(notice).toHaveTextContent("周明");
  });
});

describe("InsightPanel", () => {
  it("groups insights by type and shows evidence counts", () => {
    render(<InsightPanel insights={view().insights} />);
    expect(screen.getByText("共识")).toBeInTheDocument();
    expect(screen.getByText("分歧")).toBeInTheDocument();
    expect(screen.getByText("待验证")).toBeInTheDocument();
    expect(
      screen.getByText("双方都认为初级岗位的职责会变化"),
    ).toBeInTheDocument();
    expect(screen.getByText("依据 2 条")).toBeInTheDocument();
  });

  it("explains the empty state in product language, not 'no data'", () => {
    render(<InsightPanel insights={[]} />);
    expect(
      screen.getByText(/讨论进行到第 2 轮后，这里会开始出现/),
    ).toBeInTheDocument();
  });
});
