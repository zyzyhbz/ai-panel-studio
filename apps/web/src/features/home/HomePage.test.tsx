import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { ApiError } from "../../api/client";
import { listDiscussions } from "../../api/discussions";
import { makeListItem } from "../../test/fixtures";
import { HomePage } from "./HomePage";

vi.mock("../../api/discussions", () => ({
  listDiscussions: vi.fn(),
}));

const mockedList = vi.mocked(listDiscussions);

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  beforeEach(() => {
    mockedList.mockReset();
  });

  it("shows the empty state with sample topics when there is no discussion", async () => {
    mockedList.mockResolvedValue({ items: [], total: 0 });
    renderHome();

    expect(await screen.findByTestId("home-empty")).toBeInTheDocument();
    expect(screen.getByText("发起第一场讨论")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "AI 会不会让初级开发者失业？" }),
    ).toBeInTheDocument();
  });

  it("groups active and ended discussions into their sections", async () => {
    mockedList.mockResolvedValue({
      total: 2,
      items: [
        makeListItem({ id: "d_live", topic: "进行中的议题", status: "live" }),
        makeListItem({
          id: "d_done",
          topic: "已结束的议题",
          status: "ended",
          summaryPreview: "双方都同意岗位会变化。",
        }),
      ],
    });
    renderHome();

    const cards = await screen.findAllByTestId("discussion-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(screen.getByText("最近结束")).toBeInTheDocument();
    expect(screen.getByText("进行中的议题")).toBeInTheDocument();
    // ended cards link straight to the replay route
    const endedCard = screen.getByText("已结束的议题").closest("a");
    expect(endedCard).toHaveAttribute("href", "/d/d_done/replay");
  });

  it("renders a readable error state with a retry action", async () => {
    mockedList.mockRejectedValue(
      new ApiError({ code: "NETWORK", message: "连接不上服务", status: 0 }),
    );
    renderHome();

    expect(await screen.findByTestId("error-state")).toBeInTheDocument();
    expect(screen.getByText("首页加载失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
