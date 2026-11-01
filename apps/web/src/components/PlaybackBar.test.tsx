import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LiveBar, ReplayBar } from "./PlaybackBar";
import type { StickyScroll } from "../lib/useStickyScroll";

const sticky: StickyScroll = {
  ref: { current: null },
  pinned: false,
  unread: 3,
  paused: false,
  jumpToLatest: vi.fn(),
  togglePause: vi.fn(),
  notifyContent: vi.fn(),
};

function renderReplay(overrides: Partial<Parameters<typeof ReplayBar>[0]> = {}) {
  const props = {
    playing: false,
    ended: false,
    step: 2,
    totalSteps: 10,
    speed: 1 as const,
    chapterLabel: "第 2 / 8 轮",
    onToggle: vi.fn(),
    onSpeed: vi.fn(),
    onSeek: vi.fn(),
    onRestart: vi.fn(),
    ...overrides,
  };
  const utils = render(<ReplayBar {...props} />);
  return { ...utils, props };
}

describe("ReplayBar", () => {
  it("plays, pauses and exposes the current chapter", async () => {
    const user = userEvent.setup();
    const { props } = renderReplay();

    expect(screen.getByText("第 2 / 8 轮")).toBeInTheDocument();
    await user.click(screen.getByTestId("replay-toggle"));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  it("switches speed without seeking", async () => {
    const user = userEvent.setup();
    const { props } = renderReplay();

    await user.click(screen.getByTestId("replay-speed-2"));
    expect(props.onSpeed).toHaveBeenCalledWith(2);
    expect(props.onSeek).not.toHaveBeenCalled();
    expect(screen.getByTestId("replay-speed-2")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("seeks to the requested step from the slider", async () => {
    const { props } = renderReplay();
    const slider = screen.getByTestId("replay-slider");
    expect(slider).toHaveAttribute("max", "9");

    // fireEvent is enough for range inputs; userEvent does not drag them.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(slider, { target: { value: "5" } });
    expect(props.onSeek).toHaveBeenCalledWith(5);
  });

  it("offers restart instead of pause once the replay reached the end", async () => {
    const user = userEvent.setup();
    const { props } = renderReplay({ ended: true });

    expect(screen.getByTestId("replay-toggle")).toHaveTextContent("重播");
    await user.click(screen.getByTestId("replay-toggle"));
    expect(props.onRestart).toHaveBeenCalledTimes(1);
    expect(props.onToggle).not.toHaveBeenCalled();
  });
});

describe("LiveBar", () => {
  it("surfaces the unread count and pauses auto scroll", async () => {
    const user = userEvent.setup();
    render(
      <LiveBar
        turnCount={6}
        insightCount={5}
        sticky={sticky}
        visible
        onReplay={vi.fn()}
      />,
    );

    expect(screen.getByTestId("playback-bar")).toHaveTextContent("第 6 轮");
    expect(screen.getByText("跳到最新")).toBeInTheDocument();

    await user.click(screen.getByTestId("toggle-autoscroll"));
    expect(sticky.togglePause).toHaveBeenCalled();
  });
});
